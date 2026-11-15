import type { ImapConfig, ImapMessage, DeltaCheckRequest, DeltaCheckResult } from "./tauriCommands";
import {
  imapListFolders,
  imapGetFolderStatus,
  imapFetchMessages,
  imapFetchNewUids,
  imapDeltaCheck,
  imapSyncFolder,
} from "./tauriCommands";
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
// Circuit breaker for connection storms
// ---------------------------------------------------------------------------

/** After this many consecutive connection failures, add a cooldown delay. */
const CIRCUIT_BREAKER_THRESHOLD = 3;
/** Delay (ms) to wait after hitting the circuit breaker threshold. */
const CIRCUIT_BREAKER_DELAY_MS = 15_000;
/** After this many consecutive failures, skip remaining folders entirely. */
const CIRCUIT_BREAKER_MAX_FAILURES = 5;
/** Delay (ms) between folder syncs during initial sync to avoid connection bursts. */
const INTER_FOLDER_DELAY_MS = 1_000;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
// Fetch messages from a folder in batches
// ---------------------------------------------------------------------------

/**
 * Fetch messages from a folder in a single IMAP connection.
 * All UIDs are fetched in one call to avoid the connection-per-batch overhead.
 */
async function fetchMessagesInBatches(
  config: ImapConfig,
  folder: string,
  uids: number[],
  _onBatch?: (fetched: number, total: number) => void,
): Promise<{ messages: ImapMessage[]; lastUid: number; uidvalidity: number }> {
  // Fetch all UIDs in a single connection instead of batching.
  // The Rust backend handles the UID FETCH in batches internally on the same session.
  const result = await imapFetchMessages(config, folder, uids);
  _onBatch?.(uids.length, uids.length);

  let lastUid = 0;
  for (const msg of result.messages) {
    if (msg.uid > lastUid) lastUid = msg.uid;
  }

  return { messages: result.messages, lastUid, uidvalidity: result.folder_status.uidvalidity };
}

// ---------------------------------------------------------------------------
// Initial sync
// ---------------------------------------------------------------------------

/**
 * Perform initial sync for an IMAP account.
 * Fetches messages from all folders for the past N days.
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

  // Phase 1: List and sync folders
  onProgress?.({ phase: "folders", current: 0, total: 1 });
  const allFolders = await imapListFolders(config);
  const syncableFolders = getSyncableFolders(allFolders);
  await syncFoldersToLabels(accountId, syncableFolders);
  console.log(`[imapSync] Initial sync for account ${accountId}: ${syncableFolders.length} syncable folders`);
  onProgress?.({ phase: "folders", current: 1, total: 1 });

  // ---------------------------------------------------------------------------
  // Phase 2: Streaming fetch & store
  // ---------------------------------------------------------------------------
  // For each folder, for each batch: fetch → parse → store to DB immediately
  // (with placeholder threadId = messageId). Only lightweight metadata is kept
  // in memory for the subsequent threading pass.
  // This avoids accumulating all message bodies in memory (OOM on large mailboxes).

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

  // Track RFC Message-ID → all label IDs from every folder copy.
  // This ensures labels aren't lost when the threading algorithm deduplicates
  // messages that exist in multiple IMAP folders (e.g., INBOX + Sent).
  const labelsByRfcId = new Map<string, Set<string>>();

  // Estimate total messages for progress
  let totalEstimate = 0;
  for (const folder of syncableFolders) {
    totalEstimate += folder.exists;
  }

  let fetchedTotal = 0;
  let totalMessagesFound = 0;
  let storedCount = 0;
  let consecutiveFailures = 0;
  const folderErrors: string[] = [];

  for (let folderIdx = 0; folderIdx < syncableFolders.length; folderIdx++) {
    const folder = syncableFolders[folderIdx]!;
    if (folder.exists === 0) continue;

    // Circuit breaker: skip remaining folders after too many consecutive failures
    if (consecutiveFailures >= CIRCUIT_BREAKER_MAX_FAILURES) {
      console.warn(
        `[imapSync] Circuit breaker: ${consecutiveFailures} consecutive connection failures, ` +
        `skipping remaining ${syncableFolders.length - folderIdx} folders`,
      );
      break;
    }

    // Circuit breaker: add cooldown delay after threshold failures
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      console.warn(
        `[imapSync] Circuit breaker: ${consecutiveFailures} consecutive failures, ` +
        `waiting ${CIRCUIT_BREAKER_DELAY_MS / 1000}s before next folder`,
      );
      await delay(CIRCUIT_BREAKER_DELAY_MS);
    }

    // Inter-folder delay to avoid connection bursts (skip before first folder)
    if (folderIdx > 0) {
      await delay(INTER_FOLDER_DELAY_MS);
    }

    const folderMapping = mapFolderToLabel(folder);

    try {
      // Use single-connection sync: SELECT → SEARCH → batched FETCH in one IMAP session.
      // This replaces the old pattern of imapSearchFolder (1 connection) +
      // imapFetchMessages per chunk (1 connection per chunk) which caused connection storms.
      const sinceDate = computeSinceDate(daysBack);
      const syncResult = await imapSyncFolder(config, folder.raw_path, SYNC_BATCH_SIZE, sinceDate);

      // Reset circuit breaker on success
      consecutiveFailures = 0;

      const uidsToFetch = syncResult.uids;
      if (uidsToFetch.length === 0) continue;

      // Date filter config
      const cutoffDate = Math.floor(Date.now() / 1000) - daysBack * 86400;
      const nowSeconds = Math.floor(Date.now() / 1000);
      let dateFallbackCount = 0;
      let folderFetchedCount = 0;
      let folderStoredCount = 0;
      let lastUid = 0;
      const uidvalidity = syncResult.folder_status.uidvalidity;

      // Process all messages from the single-connection sync result
      const chunkParsed: { parsed: ParsedMessage; msg: ImapMessage; threadable: ThreadableMessage }[] = [];

      for (const msg of syncResult.messages) {
        if (msg.uid > lastUid) lastUid = msg.uid;
        folderFetchedCount++;

        // Date filter
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

        parsed.threadId = parsed.id; // placeholder — updated after threading
        chunkParsed.push({ parsed, msg, threadable });
      }

      // Write all messages to DB using batch inserts (3 calls instead of N*3)
      if (chunkParsed.length > 0) {
        // Batch insert placeholder threads first (to satisfy FK constraint)
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

        // Batch insert messages
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

        // Batch insert attachments
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

      // Keep only lightweight data in memory for threading
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

        // Build cross-folder label map
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
      fetchedTotal += uidsToFetch.length;

      if (dateFallbackCount > 0) {
        console.warn(
          `[imapSync] Folder ${folder.path}: ${dateFallbackCount}/${folderFetchedCount} messages had unparseable dates, using current time as fallback`,
        );
      }

      console.log(
        `[imapSync] Folder ${folder.path}: ${uidsToFetch.length} UIDs, ${folderFetchedCount} fetched, ${folderStoredCount} stored after date filter`,
      );

      // Report progress after each folder
      onProgress?.({
        phase: "messages",
        current: fetchedTotal,
        total: totalEstimate,
        folder: folder.path,
      });

      // Only update folder sync state if we actually stored messages for this folder.
      // If lastUid is 0, no messages were successfully fetched — saving sync state
      // would prevent future syncs from retrying this folder.
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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err ?? "Unknown error");
      console.error(`[imapSync] Failed to sync folder ${folder.path}:`, err);
      folderErrors.push(`${folder.path}: ${errMsg}`);
      if (isConnectionError(err)) {
        consecutiveFailures++;
      }
      // Continue with next folder
    }
  }

  // If no messages were stored and every folder failed, propagate the error
  if (storedCount === 0 && folderErrors.length > 0) {
    throw new Error(`All folders failed to sync: ${folderErrors[0]}`);
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Thread messages (lightweight — only IDs + headers in memory)
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

  // Pre-check pending ops for all threads
  const skippedThreadIds = new Set<string>();
  for (const group of threadGroups) {
    const pendingOps = await getPendingOpsForResource(accountId, group.threadId);
    if (pendingOps.length > 0) {
      console.log(`[imapSync] Skipping thread ${group.threadId}: has ${pendingOps.length} pending local ops`);
      skippedThreadIds.add(group.threadId);
    }
  }

  // Process all threads: build thread records, labels, and message ID updates
  const threadInputs: UpsertThreadInput[] = [];
  const labelUpdates: { threadId: string; labelIds: string[] }[] = [];
  const messageIdUpdates: { messageIds: string[]; threadId: string }[] = [];

  for (const group of threadGroups) {
    if (skippedThreadIds.has(group.threadId)) continue;

    const messages = group.messageIds
      .map((id) => allMeta.get(id))
      .filter((m): m is MessageMeta => m !== undefined);

    if (messages.length === 0) continue;

    // Sort by date ascending
    messages.sort((a, b) => a.date - b.date);

    const firstMessage = messages[0]!;
    const lastMessage = messages[messages.length - 1]!;

    // Collect all label IDs including cross-folder copies
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

  // Batch upsert all threads in a single call
  if (threadInputs.length > 0) {
    await batchUpsertThreads(threadInputs);
  }

  // Set labels and update message thread IDs (these are per-thread operations)
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
  // Phase 2 created a placeholder thread per message (threadId = messageId).
  // Phase 4 merged messages into real threads and updated message thread IDs.
  // Placeholder threads that are no longer referenced by any final thread group
  // should be deleted to avoid ghost threads in the UI.
  const finalThreadIds = new Set(threadGroups.map((g) => g.threadId));
  const allMessageIds = new Set(allMeta.keys());
  let orphanCount = 0;
  for (const msgId of allMessageIds) {
    // If this message's placeholder ID isn't a final thread ID, it's orphaned
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

  // Only mark sync as complete if messages were stored OR no messages exist on server.
  if (storedCount > 0 || totalMessagesFound === 0) {
    await updateAccountSyncState(accountId, `imap-synced-${Date.now()}`);
  } else {
    console.warn(
      `[imapSync] Found ${totalMessagesFound} messages on server but stored 0 — NOT marking sync as complete so it will be retried`,
    );
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
 */
export async function imapDeltaSync(accountId: string, daysBack = 365): Promise<SyncResult> {
  const account = await getAccount(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const config = buildImapConfig(account);

  // Get all folders we've synced before
  const syncStates = await getAllFolderSyncStates(accountId);

  // Also check for any new folders
  const allFolders = await imapListFolders(config);
  const syncableFolders = getSyncableFolders(allFolders);
  await syncFoldersToLabels(accountId, syncableFolders);

  const syncStateMap = new Map(syncStates.map((s) => [s.folder_path, s]));

  const allParsed = new Map<string, ParsedMessage>();
  const allThreadable: ThreadableMessage[] = [];
  const allImapMsgs = new Map<string, ImapMessage>();

  // Separate folders into new (no saved state) vs existing (have saved state)
  const newFolders = syncableFolders.filter((f) => !syncStateMap.has(f.raw_path));
  const existingFolders = syncableFolders.filter((f) => syncStateMap.has(f.raw_path));

  // Track how many folders were checked and how many had new UIDs (for recovery logic)
  let foldersChecked = 0;
  let foldersWithNewUids = 0;

  // Handle new folders: search for UIDs then fetch in chunks
  let consecutiveFailures = 0;
  const deltaFolderErrors: string[] = [];
  for (const folder of newFolders) {
    // Circuit breaker: skip remaining new folders after too many failures
    if (consecutiveFailures >= CIRCUIT_BREAKER_MAX_FAILURES) {
      console.warn(
        `[imapSync] Delta sync circuit breaker: ${consecutiveFailures} consecutive failures, skipping remaining new folders`,
      );
      break;
    }
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      await delay(CIRCUIT_BREAKER_DELAY_MS);
    }

    const folderMapping = mapFolderToLabel(folder);
    try {
      // Use single-connection sync instead of search + fetch-in-batches
      const sinceDate = computeSinceDate(daysBack);
      const syncResult = await imapSyncFolder(config, folder.raw_path, SYNC_BATCH_SIZE, sinceDate);
      consecutiveFailures = 0;
      foldersChecked++;

      if (syncResult.uids.length === 0) continue;
      foldersWithNewUids++;

      let lastUid = 0;
      for (const msg of syncResult.messages) {
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

      // Only save sync state if we actually fetched messages
      if (lastUid > 0) {
        await upsertFolderSyncState({
          account_id: accountId,
          folder_path: folder.raw_path,
          uidvalidity: syncResult.folder_status.uidvalidity,
          last_uid: lastUid,
          modseq: null,
          last_sync_at: Math.floor(Date.now() / 1000),
        });
      } else if (syncResult.uids.length > 0) {
        console.warn(
          `[imapSync] Delta sync folder ${folder.path}: ${syncResult.uids.length} UIDs found but 0 messages stored — NOT updating sync state`,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err ?? "Unknown error");
      console.error(`Delta sync failed for new folder ${folder.path}:`, err);
      deltaFolderErrors.push(`${folder.path}: ${errMsg}`);
      if (isConnectionError(err)) {
        consecutiveFailures++;
      }
    }
  }

  // Batch-check existing folders in a single IMAP connection.
  // Falls back to per-folder checks if the batch command fails.
  if (existingFolders.length > 0) {
    const deltaRequests: DeltaCheckRequest[] = existingFolders.map((folder) => {
      const savedState = syncStateMap.get(folder.raw_path)!;
      return {
        folder: folder.raw_path,
        last_uid: savedState.last_uid,
        uidvalidity: savedState.uidvalidity ?? 0,
      };
    });

    let deltaResultMap: Map<string, DeltaCheckResult>;
    try {
      const deltaResults = await imapDeltaCheck(config, deltaRequests);
      deltaResultMap = new Map(deltaResults.map((r) => [r.folder, r]));
      console.log(`[imapSync] Batch delta check: ${deltaResults.length}/${existingFolders.length} folders checked`);
    } catch (err) {
      // Batch check failed — fall back to per-folder checks
      console.warn(`[imapSync] Batch delta check failed, falling back to per-folder:`, err);
      deltaResultMap = new Map();
      for (const folder of existingFolders) {
        const savedState = syncStateMap.get(folder.raw_path)!;
        try {
          const currentStatus = await imapGetFolderStatus(config, folder.raw_path);
          const uidvalidityChanged =
            savedState.uidvalidity !== null &&
            currentStatus.uidvalidity !== savedState.uidvalidity;

          if (uidvalidityChanged) {
            deltaResultMap.set(folder.raw_path, {
              folder: folder.raw_path,
              uidvalidity: currentStatus.uidvalidity,
              new_uids: [],
              uidvalidity_changed: true,
            });
          } else {
            const newUids = await imapFetchNewUids(config, folder.raw_path, savedState.last_uid);
            deltaResultMap.set(folder.raw_path, {
              folder: folder.raw_path,
              uidvalidity: currentStatus.uidvalidity,
              new_uids: newUids,
              uidvalidity_changed: false,
            });
          }
        } catch (folderErr) {
          console.error(`[imapSync] Per-folder check failed for ${folder.path}:`, folderErr);
        }
      }
    }

    for (const folder of existingFolders) {
      const folderMapping = mapFolderToLabel(folder);
      const savedState = syncStateMap.get(folder.raw_path)!;
      const deltaResult = deltaResultMap.get(folder.raw_path);

      if (!deltaResult) continue;
      foldersChecked++;

      try {
        if (deltaResult.uidvalidity_changed) {
          // UIDVALIDITY changed — full resync of this folder using single connection
          console.warn(
            `UIDVALIDITY changed for folder ${folder.path} ` +
              `(was ${savedState.uidvalidity}, now ${deltaResult.uidvalidity}). ` +
              `Doing full resync of this folder.`,
          );
          foldersWithNewUids++;
          const sinceDate = computeSinceDate(daysBack);
          const syncResult = await imapSyncFolder(config, folder.raw_path, SYNC_BATCH_SIZE, sinceDate);
          if (syncResult.uids.length === 0) continue;

          let lastUid = 0;
          for (const msg of syncResult.messages) {
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

          await upsertFolderSyncState({
            account_id: accountId,
            folder_path: folder.raw_path,
            uidvalidity: syncResult.folder_status.uidvalidity,
            last_uid: lastUid,
            modseq: null,
            last_sync_at: Math.floor(Date.now() / 1000),
          });
          continue;
        }

        // Normal delta: fetch the new UIDs returned by delta check
        if (deltaResult.new_uids.length === 0) continue;
        foldersWithNewUids++;

        const { messages, lastUid, uidvalidity } = await fetchMessagesInBatches(
          config,
          folder.raw_path,
          deltaResult.new_uids,
        );

        for (const msg of messages) {
          const { parsed, threadable } = imapMessageToParsedMessage(
            msg,
            accountId,
            folderMapping.labelId,
          );
          allParsed.set(parsed.id, parsed);
          allThreadable.push(threadable);
          allImapMsgs.set(parsed.id, msg);
        }

        await upsertFolderSyncState({
          account_id: accountId,
          folder_path: folder.raw_path,
          uidvalidity,
          last_uid: Math.max(savedState.last_uid, lastUid),
          modseq: null,
          last_sync_at: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err ?? "Unknown error");
        console.error(`Delta sync failed for folder ${folder.path}:`, err);
        deltaFolderErrors.push(`${folder.path}: ${errMsg}`);
      }
    }
  }

  // If no new messages found and every folder errored, propagate the error
  if (allThreadable.length === 0 && deltaFolderErrors.length > 0) {
    throw new Error(`All folders failed to sync: ${deltaFolderErrors[0]}`);
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
