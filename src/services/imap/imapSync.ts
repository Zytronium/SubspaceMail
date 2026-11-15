import type { ImapMessage, DeltaCheckRequest } from "./tauriCommands";
import { imapFullSync } from "./tauriCommands";
import { buildImapConfig } from "./imapConfigBuilder";
import {
  mapFolderToLabel,
  getLabelsForMessage,
  syncFoldersToLabels,
  getSyncableFolders,
} from "./folderMapper";
import type { ParsedMessage, ParsedAttachment } from "../gmail/messageParser";
import type { SyncResult } from "../email/types";
import { batchUpsertMessages, updateMessageThreadIds, getThreadIdsByMessageIds, type UpsertMessageInput } from "../db/messages";
import { batchUpsertThreads, setThreadLabels, addThreadLabels, getThreadsByIds, deleteThread, type UpsertThreadInput } from "../db/threads";
import { batchUpsertAttachments, type UpsertAttachmentInput } from "../db/attachments";
import { getAccount, updateAccountSyncState } from "../db/accounts";
import {
  upsertFolderSyncState,
  getAllFolderSyncStates,
} from "../db/folderSyncState";
import {
  buildThreads,
  type ThreadableMessage,
  type ThreadGroup,
} from "../threading/threadBuilder";
import { getPendingOpsForResource } from "../db/pendingOperations";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Batch size passed to the Rust backend for single-connection folder sync. */
const SYNC_BATCH_SIZE = 200;

// ---------------------------------------------------------------------------
// Error detection
// ---------------------------------------------------------------------------

export function isConnectionError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("connection") ||
    msg.includes("tcp") ||
    msg.includes("tls") ||
    msg.includes("dns") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("socket")
  );
}

// ---------------------------------------------------------------------------
// IMAP SINCE date helpers
// ---------------------------------------------------------------------------

const IMAP_MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Format a Date as `DD-Mon-YYYY` for the IMAP SINCE search criterion (RFC 3501 §6.4.4).
 */
export function formatImapDate(date: Date): string {
  const day = date.getUTCDate();
  const month = IMAP_MONTH_NAMES[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Compute a `DD-Mon-YYYY` SINCE date string for the given `daysBack` value.
 * Subtracts an extra day as a safety margin for timezone differences
 * (IMAP SINCE has date-only granularity, no time component).
 */
export function computeSinceDate(daysBack: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysBack - 1);
  return formatImapDate(date);
}

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

export interface ImapSyncProgress {
  phase: "folders" | "messages" | "threading" | "storing_threads" | "done";
  current: number;
  total: number;
  folder?: string;
}

export type ImapSyncProgressCallback = (progress: ImapSyncProgress) => void;

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

/**
 * Generate a synthetic Message-ID for messages that lack one.
 */
function syntheticMessageId(accountId: string, folder: string, uid: number): string {
  return `synthetic-${accountId}-${folder}-${uid}@subspacemail.local`;
}

/**
 * Convert an ImapMessage (from Tauri backend) to the ParsedMessage format
 * used throughout the app.
 */
export function imapMessageToParsedMessage(
  msg: ImapMessage,
  accountId: string,
  folderLabelId: string,
): { parsed: ParsedMessage; threadable: ThreadableMessage } {
  const messageId = `imap-${accountId}-${msg.folder}-${msg.uid}`;
  const rfc2822MessageId =
    msg.message_id ?? syntheticMessageId(accountId, msg.folder, msg.uid);

  const folderMapping = { labelId: folderLabelId, labelName: "", type: "" };
  const labelIds = getLabelsForMessage(
    folderMapping,
    msg.is_read,
    msg.is_starred,
    msg.is_draft,
  );

  const snippet = msg.snippet ?? (msg.body_text ? msg.body_text.slice(0, 200) : "");

  const attachments: ParsedAttachment[] = msg.attachments.map((att) => ({
    filename: att.filename,
    mimeType: att.mime_type,
    size: att.size,
    gmailAttachmentId: att.part_id, // reuse field for IMAP part ID
    contentId: att.content_id,
    isInline: att.is_inline,
  }));

  const parsed: ParsedMessage = {
    id: messageId,
    threadId: "", // will be assigned after threading
    fromAddress: msg.from_address,
    fromName: msg.from_name,
    toAddresses: msg.to_addresses,
    ccAddresses: msg.cc_addresses,
    bccAddresses: msg.bcc_addresses,
    replyTo: msg.reply_to,
    subject: msg.subject,
    snippet,
    date: msg.date * 1000,
    isRead: msg.is_read,
    isStarred: msg.is_starred,
    bodyHtml: msg.body_html,
    bodyText: msg.body_text,
    rawSize: msg.raw_size,
    internalDate: msg.date * 1000,
    labelIds,
    hasAttachments: attachments.length > 0,
    attachments,
    listUnsubscribe: msg.list_unsubscribe,
    listUnsubscribePost: msg.list_unsubscribe_post,
    authResults: msg.auth_results,
  };

  const threadable: ThreadableMessage = {
    id: messageId,
    messageId: rfc2822MessageId,
    inReplyTo: msg.in_reply_to,
    references: msg.references,
    subject: msg.subject,
    date: msg.date * 1000,
  };

  return { parsed, threadable };
}

// ---------------------------------------------------------------------------
// Thread storage
// ---------------------------------------------------------------------------

/**
 * Store threads and their messages into the local DB.
 *
 * When `isDeltaSync` is true, the function checks which threads already exist
 * and merges their labels instead of replacing them, preventing threads from
 * disappearing from folders when a new message arrives in only one folder.
 */
async function storeThreadsAndMessages(
  accountId: string,
  threadGroups: ThreadGroup[],
  parsedByLocalId: Map<string, ParsedMessage>,
  imapMsgByLocalId: Map<string, ImapMessage>,
  labelsByRfcId?: Map<string, Set<string>>,
  isDeltaSync = false,
): Promise<ParsedMessage[]> {
  const storedMessages: ParsedMessage[] = [];

  // Pre-check pending ops OUTSIDE any transaction
  const skippedThreadIds = new Set<string>();
  for (const group of threadGroups) {
    const pendingOps = await getPendingOpsForResource(accountId, group.threadId);
    if (pendingOps.length > 0) {
      console.log(`[imapSync] Skipping thread ${group.threadId}: has ${pendingOps.length} pending local ops`);
      skippedThreadIds.add(group.threadId);
    }
  }

  // For delta sync, the threading algorithm runs on only the new messages, so the
  // generated thread IDs may differ from existing threads (because the root of the
  // reference chain may be a different phantom container). Fix this by looking up
  // which existing threads contain messages referenced by the new messages, and
  // remap the thread groups to use the existing thread IDs.
  let remappedGroups = threadGroups;
  if (isDeltaSync) {
    // Collect all RFC Message-IDs referenced by new messages (In-Reply-To + References)
    const referencedRfcIds = new Set<string>();
    for (const group of threadGroups) {
      for (const localId of group.messageIds) {
        const imapMsg = imapMsgByLocalId.get(localId);
        if (imapMsg?.in_reply_to) {
          const id = imapMsg.in_reply_to.trim().replace(/^<|>$/g, '');
          if (id) referencedRfcIds.add(id);
        }
        if (imapMsg?.references) {
          for (const token of imapMsg.references.split(/\s+/)) {
            const id = token.trim().replace(/^<|>$/g, '');
            if (id) referencedRfcIds.add(id);
          }
        }
      }
    }

    if (referencedRfcIds.size > 0) {
      // Look up which existing threads contain the referenced messages
      const rfcIdToArray = [...referencedRfcIds];
      const threadIdsByRfcId = await getThreadIdsByMessageIds(accountId, rfcIdToArray);

      // Build a map: new thread group ID → existing thread ID
      const groupToExistingThread = new Map<string, string>();
      for (const group of threadGroups) {
        for (const localId of group.messageIds) {
          const imapMsg = imapMsgByLocalId.get(localId);
          if (!imapMsg) continue;

          // Check In-Reply-To
          if (imapMsg.in_reply_to) {
            const id = imapMsg.in_reply_to.trim().replace(/^<|>$/g, '');
            const existingThreadId = threadIdsByRfcId.get(id);
            if (existingThreadId && existingThreadId !== group.threadId) {
              groupToExistingThread.set(group.threadId, existingThreadId);
              break;
            }
          }

          // Check References
          if (imapMsg.references) {
            for (const token of imapMsg.references.split(/\s+/)) {
              const id = token.trim().replace(/^<|>$/g, '');
              const existingThreadId = threadIdsByRfcId.get(id);
              if (existingThreadId && existingThreadId !== group.threadId) {
                groupToExistingThread.set(group.threadId, existingThreadId);
                break;
              }
            }
            if (groupToExistingThread.has(group.threadId)) break;
          }
        }
      }

      // Remap thread groups to use existing thread IDs
      if (groupToExistingThread.size > 0) {
        remappedGroups = threadGroups.map((group) => {
          const existingThreadId = groupToExistingThread.get(group.threadId);
          if (existingThreadId) {
            console.log(
              `[imapSync] Remapped thread ${group.threadId} → ${existingThreadId} ` +
              `(new message references existing thread)`,
            );
            return { ...group, threadId: existingThreadId };
          }
          return group;
        });
      }
    }
  }

  // Use remapped groups for the rest of the function
  threadGroups = remappedGroups;

  // For delta sync, check which threads already exist so we can merge labels
  // instead of replacing them (which would cause threads to disappear from folders).
  // Additionally, we need to check if any NEW thread group ID (generated by buildThreads)
  // might actually correspond to an existing thread that wasn't found by remapping.
  // To be safe, we also look up existing threads by checking if any message in the
  // new thread group has the same RFC Message-ID as a message already in the DB.
  const existingThreads = isDeltaSync
    ? await getThreadsByIds(accountId, threadGroups.map((g) => g.threadId))
    : new Map();

  // Additional safety: for delta sync, check if any new thread group contains messages
  // whose RFC Message-IDs already exist in the DB under a different thread.
  // This catches cases where buildThreads generates a different thread ID than the
  // initial sync, and the In-Reply-To/References remapping didn't find the match.
  if (isDeltaSync) {
    const allNewRfcIds = new Set<string>();
    for (const group of threadGroups) {
      for (const localId of group.messageIds) {
        const imapMsg = imapMsgByLocalId.get(localId);
        if (imapMsg?.message_id) {
          allNewRfcIds.add(imapMsg.message_id);
        }
      }
    }

    if (allNewRfcIds.size > 0) {
      const existingThreadByRfcId = await getThreadIdsByMessageIds(accountId, [...allNewRfcIds]);
      for (const group of threadGroups) {
        const existingThreadId = existingThreads.get(group.threadId);
        if (existingThreadId) continue; // already found as existing

        // Check if any message in this group already exists in the DB under a different thread
        for (const localId of group.messageIds) {
          const imapMsg = imapMsgByLocalId.get(localId);
          if (!imapMsg?.message_id) continue;
          const rfcExistingThreadId = existingThreadByRfcId.get(imapMsg.message_id);
          if (rfcExistingThreadId && rfcExistingThreadId !== group.threadId) {
            // This message already exists in the DB under a different thread — remap
            console.log(
              `[imapSync] Remapped thread ${group.threadId} → ${rfcExistingThreadId} ` +
              `(new message RFC-ID already exists in DB under different thread)`,
            );
            group.threadId = rfcExistingThreadId;
            break;
          }
        }
      }

      // Re-check existing threads after additional remapping
      for (const group of threadGroups) {
        if (!existingThreads.has(group.threadId)) {
          const found = await getThreadsByIds(accountId, [group.threadId]);
          for (const [id, t] of found) {
            existingThreads.set(id, t);
          }
        }
      }
    }
  }

  // Build all thread, message, and attachment inputs
  const threadInputs: UpsertThreadInput[] = [];
  const labelUpdates: { threadId: string; labelIds: string[]; merge: boolean }[] = [];
  const msgInputs: UpsertMessageInput[] = [];
  const attInputs: UpsertAttachmentInput[] = [];

  for (const group of threadGroups) {
    if (skippedThreadIds.has(group.threadId)) continue;

    const messages = group.messageIds
      .map((id) => parsedByLocalId.get(id))
      .filter((m): m is ParsedMessage => m !== undefined);

    if (messages.length === 0) continue;

    // Assign threadId to each message
    for (const msg of messages) {
      msg.threadId = group.threadId;
    }

    // Sort by date ascending
    messages.sort((a, b) => a.date - b.date);

    const firstMessage = messages[0]!;
    const lastMessage = messages[messages.length - 1]!;

    // Collect all label IDs across messages in this thread.
    const allLabelIds = new Set<string>();
    for (const msg of messages) {
      for (const lid of msg.labelIds) {
        allLabelIds.add(lid);
      }
      const imapMsg = imapMsgByLocalId.get(msg.id);
      const rfcId = imapMsg?.message_id;
      if (rfcId && labelsByRfcId) {
        const extraLabels = labelsByRfcId.get(rfcId);
        if (extraLabels) {
          for (const lid of extraLabels) {
            allLabelIds.add(lid);
          }
        }
      }
    }

    const isRead = messages.every((m) => m.isRead);
    const isStarred = messages.some((m) => m.isStarred);
    const hasAttachments = messages.some((m) => m.hasAttachments);

    const existingThread = existingThreads.get(group.threadId);
    if (existingThread) {
      // Thread already exists — update metadata but preserve message_count
      // by adding the new message count to the existing count.
      threadInputs.push({
        id: group.threadId,
        accountId,
        subject: firstMessage.subject,
        snippet: lastMessage.snippet,
        lastMessageAt: lastMessage.date,
        messageCount: existingThread.message_count + messages.length,
        isRead,
        isStarred,
        isImportant: false,
        hasAttachments,
      });
      // Merge labels instead of replacing — prevents threads from disappearing
      // when a new message arrives in only one folder of a cross-folder thread.
      labelUpdates.push({ threadId: group.threadId, labelIds: [...allLabelIds], merge: true });
    } else {
      threadInputs.push({
        id: group.threadId,
        accountId,
        subject: firstMessage.subject,
        snippet: lastMessage.snippet,
        lastMessageAt: lastMessage.date,
        messageCount: messages.length,
        isRead,
        isStarred,
        isImportant: false,
        hasAttachments,
      });
      labelUpdates.push({ threadId: group.threadId, labelIds: [...allLabelIds], merge: false });
    }

    for (const parsed of messages) {
      const imapMsg = imapMsgByLocalId.get(parsed.id);
      msgInputs.push({
        id: parsed.id,
        accountId,
        threadId: parsed.threadId,
        fromAddress: parsed.fromAddress,
        fromName: parsed.fromName,
        toAddresses: parsed.toAddresses,
        ccAddresses: parsed.ccAddresses,
        bccAddresses: parsed.bccAddresses,
        replyTo: parsed.replyTo,
        subject: parsed.subject,
        snippet: parsed.snippet,
        date: parsed.date,
        isRead: parsed.isRead,
        isStarred: parsed.isStarred,
        bodyHtml: parsed.bodyHtml,
        bodyText: parsed.bodyText,
        rawSize: parsed.rawSize,
        internalDate: parsed.internalDate,
        listUnsubscribe: parsed.listUnsubscribe,
        listUnsubscribePost: parsed.listUnsubscribePost,
        authResults: parsed.authResults,
        messageIdHeader: imapMsg?.message_id ?? null,
        referencesHeader: imapMsg?.references ?? null,
        inReplyToHeader: imapMsg?.in_reply_to ?? null,
        imapUid: imapMsg?.uid ?? null,
        imapFolder: imapMsg?.folder ?? null,
      });

      for (const att of parsed.attachments) {
        attInputs.push({
          id: `${parsed.id}_${att.gmailAttachmentId}`,
          messageId: parsed.id,
          accountId,
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          gmailAttachmentId: att.gmailAttachmentId,
          contentId: att.contentId,
          isInline: att.isInline,
        });
      }

      storedMessages.push(parsed);
    }
  }

  // Batch upsert all threads
  if (threadInputs.length > 0) {
    await batchUpsertThreads(threadInputs);
  }

  // Batch upsert all messages
  if (msgInputs.length > 0) {
    await batchUpsertMessages(msgInputs);
  }

  // Batch upsert all attachments
  if (attInputs.length > 0) {
    await batchUpsertAttachments(attInputs);
  }

  // Set labels (per-thread operation)
  // For existing threads during delta sync, merge labels instead of replacing them.
  for (const lu of labelUpdates) {
    if (lu.merge) {
      await addThreadLabels(accountId, lu.threadId, lu.labelIds);
    } else {
      await setThreadLabels(accountId, lu.threadId, lu.labelIds);
    }
  }

  return storedMessages;
}

// ---------------------------------------------------------------------------
// Initial sync
// ---------------------------------------------------------------------------

/**
 * Perform initial sync for an IMAP account.
 * Fetches messages from all folders for the past N days.
 *
 * Uses imapFullSync to do everything in a single IMAP connection:
 * LIST → for each folder: SELECT → SEARCH SINCE → batched FETCH.
 */
export async function imapInitialSync(
  accountId: string,
  daysBack = 365,
  onProgress?: ImapSyncProgressCallback,
): Promise<SyncResult> {
  const account = await getAccount(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const config = buildImapConfig(account);
  const sinceDate = computeSinceDate(daysBack);

  // Phase 1: Single-connection full sync
  onProgress?.({ phase: "folders", current: 0, total: 1 });
  const fullResult = await imapFullSync(config, {
    since_date: sinceDate,
    batch_size: SYNC_BATCH_SIZE,
    delta_folders: [],
  });
  const allFolders = fullResult.folders;
  const syncableFolders = getSyncableFolders(allFolders);
  await syncFoldersToLabels(accountId, syncableFolders);
  console.log(`[imapSync] Initial sync for account ${accountId}: ${syncableFolders.length} syncable folders`);
  onProgress?.({ phase: "folders", current: 1, total: 1 });

  // Build a map from raw_path → folder info for label mapping
  const folderMap = new Map(syncableFolders.map(f => [f.raw_path, f]));

  // ---------------------------------------------------------------------------
  // Phase 2: Streaming fetch & store
  // ---------------------------------------------------------------------------
  interface MessageMeta {
    id: string;
    rfcMessageId: string;
    labelIds: string[];
    isRead: boolean;
    isStarred: boolean;
    hasAttachments: boolean;
    subject: string | null;
    snippet: string;
    date: number;
  }

  const allThreadable: ThreadableMessage[] = [];
  const allMeta = new Map<string, MessageMeta>();
  const labelsByRfcId = new Map<string, Set<string>>();

  let totalMessagesFound = 0;
  let storedCount = 0;
  const cutoffDate = Math.floor(Date.now() / 1000) - daysBack * 86400;
  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const folderResult of fullResult.folder_results) {
    const folder = folderMap.get(folderResult.folder);
    if (!folder) continue;

    const folderMapping = mapFolderToLabel(folder);
    const uidsToFetch = folderResult.uids;
    if (uidsToFetch.length === 0) continue;

    let dateFallbackCount = 0;
    let folderFetchedCount = 0;
    let folderStoredCount = 0;
    let lastUid = 0;
    const uidvalidity = folderResult.folder_status.uidvalidity;

    const chunkParsed: { parsed: ParsedMessage; msg: ImapMessage; threadable: ThreadableMessage }[] = [];

    for (const msg of folderResult.messages) {
      if (msg.uid > lastUid) lastUid = msg.uid;
      folderFetchedCount++;

      if (msg.date === 0) {
        dateFallbackCount++;
        msg.date = nowSeconds;
      }
      if (msg.date < cutoffDate) continue;

      const { parsed, threadable } = imapMessageToParsedMessage(
        msg,
        accountId,
        folderMapping.labelId,
      );

      parsed.threadId = parsed.id;
      chunkParsed.push({ parsed, msg, threadable });
    }

    if (chunkParsed.length > 0) {
      const threadInputs = chunkParsed.map(({ parsed }) => ({
        id: parsed.id,
        accountId,
        subject: parsed.subject,
        snippet: parsed.snippet,
        lastMessageAt: parsed.date,
        messageCount: 1,
        isRead: parsed.isRead,
        isStarred: parsed.isStarred,
        isImportant: false,
        hasAttachments: parsed.hasAttachments,
      }));
      await batchUpsertThreads(threadInputs);

      const msgInputs = chunkParsed.map(({ parsed, msg }) => ({
        id: parsed.id,
        accountId,
        threadId: parsed.id,
        fromAddress: parsed.fromAddress,
        fromName: parsed.fromName,
        toAddresses: parsed.toAddresses,
        ccAddresses: parsed.ccAddresses,
        bccAddresses: parsed.bccAddresses,
        replyTo: parsed.replyTo,
        subject: parsed.subject,
        snippet: parsed.snippet,
        date: parsed.date,
        isRead: parsed.isRead,
        isStarred: parsed.isStarred,
        bodyHtml: parsed.bodyHtml,
        bodyText: parsed.bodyText,
        rawSize: parsed.rawSize,
        internalDate: parsed.internalDate,
        listUnsubscribe: parsed.listUnsubscribe,
        listUnsubscribePost: parsed.listUnsubscribePost,
        authResults: parsed.authResults,
        messageIdHeader: msg.message_id ?? null,
        referencesHeader: msg.references ?? null,
        inReplyToHeader: msg.in_reply_to ?? null,
        imapUid: msg.uid ?? null,
        imapFolder: msg.folder ?? null,
      }));
      await batchUpsertMessages(msgInputs);

      const allAttachments: UpsertAttachmentInput[] = [];
      for (const { parsed } of chunkParsed) {
        for (const att of parsed.attachments) {
          allAttachments.push({
            id: `${parsed.id}_${att.gmailAttachmentId}`,
            messageId: parsed.id,
            accountId,
            filename: att.filename,
            mimeType: att.mimeType,
            size: att.size,
            gmailAttachmentId: att.gmailAttachmentId,
            contentId: att.contentId,
            isInline: att.isInline,
          });
        }
      }
      if (allAttachments.length > 0) {
        await batchUpsertAttachments(allAttachments);
      }
    }

    for (const { parsed, threadable } of chunkParsed) {
      const meta: MessageMeta = {
        id: parsed.id,
        rfcMessageId: threadable.messageId,
        labelIds: parsed.labelIds,
        isRead: parsed.isRead,
        isStarred: parsed.isStarred,
        hasAttachments: parsed.hasAttachments,
        subject: parsed.subject,
        snippet: parsed.snippet,
        date: parsed.date,
      };
      allMeta.set(parsed.id, meta);
      allThreadable.push(threadable);

      let labels = labelsByRfcId.get(threadable.messageId);
      if (!labels) {
        labels = new Set();
        labelsByRfcId.set(threadable.messageId, labels);
      }
      for (const lid of parsed.labelIds) {
        labels.add(lid);
      }
    }

    folderStoredCount += chunkParsed.length;
    storedCount += chunkParsed.length;
    totalMessagesFound += folderFetchedCount;

    if (dateFallbackCount > 0) {
      console.warn(
        `[imapSync] Folder ${folder.path}: ${dateFallbackCount}/${folderFetchedCount} messages had unparseable dates, using current time as fallback`,
      );
    }

    console.log(
      `[imapSync] Folder ${folder.path}: ${uidsToFetch.length} UIDs, ${folderFetchedCount} fetched, ${folderStoredCount} stored after date filter`,
    );

    onProgress?.({
      phase: "messages",
      current: storedCount,
      total: totalMessagesFound,
      folder: folder.path,
    });

    if (lastUid > 0) {
      await upsertFolderSyncState({
        account_id: accountId,
        folder_path: folder.raw_path,
        uidvalidity,
        last_uid: lastUid,
        modseq: null,
        last_sync_at: Math.floor(Date.now() / 1000),
      });
    } else if (uidsToFetch.length > 0) {
      console.warn(
        `[imapSync] Folder ${folder.path}: ${uidsToFetch.length} UIDs found but 0 messages stored — NOT updating sync state so it will be retried`,
      );
    }
  }

  if (storedCount === 0 && totalMessagesFound > 0) {
    console.warn(
      `[imapSync] Found ${totalMessagesFound} messages on server but stored 0 — NOT marking sync as complete so it will be retried`,
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Thread messages
  // ---------------------------------------------------------------------------
  onProgress?.({ phase: "threading", current: 0, total: allThreadable.length });
  const threadGroups = buildThreads(allThreadable);
  console.log(
    `[imapSync] Threading: ${allThreadable.length} messages → ${threadGroups.length} thread groups`,
  );

  // ---------------------------------------------------------------------------
  // Phase 4: Create thread records + batch-update message thread IDs
  // ---------------------------------------------------------------------------
  onProgress?.({ phase: "storing_threads", current: 0, total: threadGroups.length });

  const skippedThreadIds = new Set<string>();
  for (const group of threadGroups) {
    const pendingOps = await getPendingOpsForResource(accountId, group.threadId);
    if (pendingOps.length > 0) {
      console.log(`[imapSync] Skipping thread ${group.threadId}: has ${pendingOps.length} pending local ops`);
      skippedThreadIds.add(group.threadId);
    }
  }

  const threadInputs: UpsertThreadInput[] = [];
  const labelUpdates: { threadId: string; labelIds: string[] }[] = [];
  const messageIdUpdates: { messageIds: string[]; threadId: string }[] = [];

  for (const group of threadGroups) {
    if (skippedThreadIds.has(group.threadId)) continue;

    const messages = group.messageIds
      .map((id) => allMeta.get(id))
      .filter((m): m is MessageMeta => m !== undefined);

    if (messages.length === 0) continue;

    messages.sort((a, b) => a.date - b.date);

    const firstMessage = messages[0]!;
    const lastMessage = messages[messages.length - 1]!;

    const allLabelIds = new Set<string>();
    for (const msg of messages) {
      for (const lid of msg.labelIds) {
        allLabelIds.add(lid);
      }
      const extraLabels = labelsByRfcId.get(msg.rfcMessageId);
      if (extraLabels) {
        for (const lid of extraLabels) {
          allLabelIds.add(lid);
        }
      }
    }

    const isRead = messages.every((m) => m.isRead);
    const isStarred = messages.some((m) => m.isStarred);
    const hasAttachments = messages.some((m) => m.hasAttachments);

    threadInputs.push({
      id: group.threadId,
      accountId,
      subject: firstMessage.subject,
      snippet: lastMessage.snippet,
      lastMessageAt: lastMessage.date,
      messageCount: messages.length,
      isRead,
      isStarred,
      isImportant: false,
      hasAttachments,
    });

    labelUpdates.push({ threadId: group.threadId, labelIds: [...allLabelIds] });
    messageIdUpdates.push({ messageIds: messages.map((m) => m.id), threadId: group.threadId });
  }

  if (threadInputs.length > 0) {
    await batchUpsertThreads(threadInputs);
  }

  for (const lu of labelUpdates) {
    await setThreadLabels(accountId, lu.threadId, lu.labelIds);
  }
  for (const mu of messageIdUpdates) {
    await updateMessageThreadIds(accountId, mu.messageIds, mu.threadId);
  }

  onProgress?.({
    phase: "storing_threads",
    current: threadGroups.length,
    total: threadGroups.length,
  });

  // ---------------------------------------------------------------------------
  // Phase 5: Clean up orphaned placeholder threads
  // ---------------------------------------------------------------------------
  const finalThreadIds = new Set(threadGroups.map((g) => g.threadId));
  const allMessageIds = new Set(allMeta.keys());
  let orphanCount = 0;
  for (const msgId of allMessageIds) {
    if (!finalThreadIds.has(msgId)) {
      await deleteThread(accountId, msgId);
      orphanCount++;
    }
  }
  if (orphanCount > 0) {
    console.log(`[imapSync] Cleaned up ${orphanCount} orphaned placeholder threads`);
  }

  console.log(
    `[imapSync] Stored ${storedCount} messages in ${threadGroups.length} threads (found ${totalMessagesFound} on server)`,
  );

  if (storedCount > 0 || totalMessagesFound === 0) {
    await updateAccountSyncState(accountId, `imap-synced-${Date.now()}`);
  }

  onProgress?.({
    phase: "done",
    current: storedCount,
    total: storedCount,
  });

  return { messages: [] };
}

// ---------------------------------------------------------------------------
// Delta sync
// ---------------------------------------------------------------------------

/**
 * Perform delta sync for an IMAP account.
 * Fetches only new messages since the last sync using stored UID state.
 *
 * Uses imapFullSync to do everything in a single IMAP connection:
 * LIST → delta_check → for each folder with new UIDs: SELECT → FETCH.
 */
export async function imapDeltaSync(accountId: string): Promise<SyncResult> {
  const account = await getAccount(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const config = buildImapConfig(account);

  // Get all folders we've synced before
  const syncStates = await getAllFolderSyncStates(accountId);
  const syncStateMap = new Map(syncStates.map((s) => [s.folder_path, s]));

  // Build delta check requests for existing folders
  const deltaRequests: DeltaCheckRequest[] = syncStates.map((s) => ({
    folder: s.folder_path,
    last_uid: s.last_uid,
    uidvalidity: s.uidvalidity ?? 0,
  }));

  // Single-connection full delta sync
  const fullResult = await imapFullSync(config, {
    since_date: null,
    batch_size: SYNC_BATCH_SIZE,
    delta_folders: deltaRequests,
  });

  const allFolders = fullResult.folders;
  const syncableFolders = getSyncableFolders(allFolders);
  await syncFoldersToLabels(accountId, syncableFolders);

  // Build a map from raw_path → folder info for label mapping
  const folderMap = new Map(syncableFolders.map(f => [f.raw_path, f]));

  const allParsed = new Map<string, ParsedMessage>();
  const allThreadable: ThreadableMessage[] = [];
  const allImapMsgs = new Map<string, ImapMessage>();

  let foldersChecked = 0;
  let foldersWithNewUids = 0;

  for (const folderResult of fullResult.folder_results) {
    const folder = folderMap.get(folderResult.folder);
    if (!folder) continue;

    const folderMapping = mapFolderToLabel(folder);
    const savedState = syncStateMap.get(folder.raw_path);
    foldersChecked++;

    if (folderResult.uids.length === 0) continue;
    foldersWithNewUids++;

    if (folderResult.uidvalidity_changed) {
      console.warn(
        `UIDVALIDITY changed for folder ${folder.path} ` +
          `(was ${savedState?.uidvalidity}, now ${folderResult.folder_status.uidvalidity}). ` +
          `Doing full resync of this folder.`,
      );
    }

    let lastUid = 0;
    for (const msg of folderResult.messages) {
      if (msg.uid > lastUid) lastUid = msg.uid;
      const { parsed, threadable } = imapMessageToParsedMessage(
        msg,
        accountId,
        folderMapping.labelId,
      );
      allParsed.set(parsed.id, parsed);
      allThreadable.push(threadable);
      allImapMsgs.set(parsed.id, msg);
    }

    // Update sync state
    if (lastUid > 0) {
      await upsertFolderSyncState({
        account_id: accountId,
        folder_path: folder.raw_path,
        uidvalidity: folderResult.folder_status.uidvalidity,
        last_uid: savedState ? Math.max(savedState.last_uid, lastUid) : lastUid,
        modseq: null,
        last_sync_at: Math.floor(Date.now() / 1000),
      });
    }
  }

  if (allThreadable.length === 0) {
    return { messages: [], foldersChecked, foldersWithNewUids };
  }

  // Build RFC Message-ID → labels map for cross-folder label merging
  const labelsByRfcId = new Map<string, Set<string>>();
  for (const threadable of allThreadable) {
    const parsed = allParsed.get(threadable.id);
    if (!parsed) continue;
    let labels = labelsByRfcId.get(threadable.messageId);
    if (!labels) {
      labels = new Set();
      labelsByRfcId.set(threadable.messageId, labels);
    }
    for (const lid of parsed.labelIds) {
      labels.add(lid);
    }
  }

  // Thread the new messages
  const threadGroups = buildThreads(allThreadable);

  // Store in DB — pass isDeltaSync=true so existing threads have their
  // labels merged instead of replaced, preventing threads from disappearing.
  const storedMessages = await storeThreadsAndMessages(
    accountId,
    threadGroups,
    allParsed,
    allImapMsgs,
    labelsByRfcId,
    true,
  );

  // Update sync state timestamp
  await updateAccountSyncState(accountId, `imap-synced-${Date.now()}`);

  return { messages: storedMessages, foldersChecked, foldersWithNewUids };
}
