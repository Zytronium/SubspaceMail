import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock() calls are hoisted — must use inline factories, not external references
vi.mock("./tauriCommands", () => ({
  imapListFolders: vi.fn(),
  imapGetFolderStatus: vi.fn(),
  imapFetchMessages: vi.fn(),
  imapFetchNewUids: vi.fn(),
  imapSearchAllUids: vi.fn(),
  imapSearchFolder: vi.fn(),
  imapDeltaCheck: vi.fn(),
  imapSyncFolder: vi.fn(),
}));
vi.mock("./imapConfigBuilder", () => ({
  buildImapConfig: vi.fn(() => ({
    host: "imap.example.com",
    port: 993,
    security: "ssl",
    username: "user@example.com",
    password: "secret",
    auth_method: "password",
  })),
}));
vi.mock("./folderMapper", () => ({
  mapFolderToLabel: vi.fn((folder: { path: string }) => ({
    labelId: folder.path,
    labelName: folder.path,
    type: "user",
  })),
  getLabelsForMessage: vi.fn(
    (mapping: { labelId: string }, isRead: boolean, isStarred: boolean) => {
      const labels = [mapping.labelId];
      if (!isRead) labels.push("UNREAD");
      if (isStarred) labels.push("STARRED");
      return labels;
    },
  ),
  syncFoldersToLabels: vi.fn(),
  getSyncableFolders: vi.fn((folders: unknown[]) => folders),
}));
vi.mock("../db/messages", () => ({
  upsertMessage: vi.fn(),
  batchUpsertMessages: vi.fn(),
  updateMessageThreadIds: vi.fn(),
  getThreadIdsByMessageIds: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock("../db/threads", () => ({
  upsertThread: vi.fn(),
  batchUpsertThreads: vi.fn(),
  setThreadLabels: vi.fn(),
  addThreadLabels: vi.fn(),
  getThreadsByIds: vi.fn(),
  deleteThread: vi.fn(),
}));
vi.mock("../db/attachments", () => ({
  upsertAttachment: vi.fn(),
  batchUpsertAttachments: vi.fn(),
}));
vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(),
  updateAccountSyncState: vi.fn(),
}));
vi.mock("../db/connection", () => ({
  getDb: vi.fn(),
  buildDynamicUpdate: vi.fn(),
  selectFirstBy: vi.fn(),
}));
vi.mock("../db/folderSyncState", () => ({
  upsertFolderSyncState: vi.fn(),
  getAllFolderSyncStates: vi.fn(),
}));
vi.mock("../db/pendingOperations", () => ({
  getPendingOpsForResource: vi.fn(() => []),
}));

import { imapMessageToParsedMessage, imapInitialSync, imapDeltaSync, formatImapDate, computeSinceDate, isConnectionError } from "./imapSync";
import {
  createMockImapMessage,
  createMockImapAccount,
  createMockImapFolder,
  createMockImapFolderStatus,
  createMockImapFetchResult,
} from "@/test/mocks";
import { imapListFolders, imapSyncFolder, imapFetchMessages, imapDeltaCheck } from "./tauriCommands";
import { getAccount } from "../db/accounts";
import { upsertMessage, batchUpsertMessages, updateMessageThreadIds, getThreadIdsByMessageIds } from "../db/messages";
import { upsertThread, batchUpsertThreads, deleteThread, setThreadLabels, addThreadLabels, getThreadsByIds } from "../db/threads";
import { upsertAttachment, batchUpsertAttachments } from "../db/attachments";
import { getPendingOpsForResource } from "../db/pendingOperations";
import { getAllFolderSyncStates } from "../db/folderSyncState";

describe("imapMessageToParsedMessage", () => {
  it("converts basic IMAP message to ParsedMessage format", () => {
    const msg = createMockImapMessage();
    const { parsed, threadable } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");

    expect(parsed.id).toBe("imap-acc-1-INBOX-42");
    expect(parsed.fromAddress).toBe("sender@example.com");
    expect(parsed.fromName).toBe("Sender Name");
    expect(parsed.toAddresses).toBe("recipient@example.com");
    expect(parsed.subject).toBe("Test Subject");
    expect(parsed.date).toBe(1700000000000);
    expect(parsed.isRead).toBe(false);
    expect(parsed.isStarred).toBe(false);
    expect(parsed.bodyHtml).toBe("<p>Hello</p>");
    expect(parsed.bodyText).toBe("Hello");
    expect(parsed.snippet).toBe("Hello");
    expect(parsed.rawSize).toBe(1024);
    expect(parsed.hasAttachments).toBe(false);
    expect(parsed.attachments).toEqual([]);
  });

  it("generates stable message ID from account, folder, and uid", () => {
    const msg = createMockImapMessage({ uid: 99, folder: "Sent" });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-2", "SENT");
    expect(parsed.id).toBe("imap-acc-2-Sent-99");
  });

  it("includes UNREAD label for unread messages", () => {
    const msg = createMockImapMessage({ is_read: false });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.labelIds).toContain("UNREAD");
    expect(parsed.labelIds).toContain("INBOX");
  });

  it("does not include UNREAD label for read messages", () => {
    const msg = createMockImapMessage({ is_read: true });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.labelIds).not.toContain("UNREAD");
    expect(parsed.labelIds).toContain("INBOX");
  });

  it("includes STARRED label for flagged messages", () => {
    const msg = createMockImapMessage({ is_starred: true, is_read: true });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.labelIds).toContain("STARRED");
  });

  it("creates threadable message with correct fields", () => {
    const msg = createMockImapMessage({
      message_id: "<msg-abc@host.com>",
      in_reply_to: "<msg-parent@host.com>",
      references: "<msg-root@host.com> <msg-parent@host.com>",
    });
    const { threadable } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");

    expect(threadable.id).toBe("imap-acc-1-INBOX-42");
    expect(threadable.messageId).toBe("<msg-abc@host.com>");
    expect(threadable.inReplyTo).toBe("<msg-parent@host.com>");
    expect(threadable.references).toBe("<msg-root@host.com> <msg-parent@host.com>");
    expect(threadable.subject).toBe("Test Subject");
    expect(threadable.date).toBe(1700000000000);
  });

  it("generates synthetic message ID when none present", () => {
    const msg = createMockImapMessage({ message_id: null });
    const { threadable } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");

    expect(threadable.messageId).toBe("synthetic-acc-1-INBOX-42@subspacemail.local");
  });

  it("converts attachments correctly", () => {
    const msg = createMockImapMessage({
      attachments: [
        {
          part_id: "2",
          filename: "report.pdf",
          mime_type: "application/pdf",
          size: 50000,
          content_id: null,
          is_inline: false,
        },
        {
          part_id: "3",
          filename: "logo.png",
          mime_type: "image/png",
          size: 1024,
          content_id: "logo-cid",
          is_inline: true,
        },
      ],
    });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");

    expect(parsed.hasAttachments).toBe(true);
    expect(parsed.attachments).toHaveLength(2);
    expect(parsed.attachments[0]).toEqual({
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 50000,
      gmailAttachmentId: "2",
      contentId: null,
      isInline: false,
    });
    expect(parsed.attachments[1]).toEqual({
      filename: "logo.png",
      mimeType: "image/png",
      size: 1024,
      gmailAttachmentId: "3",
      contentId: "logo-cid",
      isInline: true,
    });
  });

  it("generates snippet from body_text when snippet is null", () => {
    const msg = createMockImapMessage({
      snippet: null,
      body_text: "This is a long email body that should be truncated to create a snippet for display purposes.",
    });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.snippet).toBe("This is a long email body that should be truncated to create a snippet for display purposes.");
  });

  it("handles null body fields gracefully", () => {
    const msg = createMockImapMessage({
      body_html: null,
      body_text: null,
      snippet: null,
    });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.bodyHtml).toBeNull();
    expect(parsed.bodyText).toBeNull();
    expect(parsed.snippet).toBe("");
  });

  it("preserves list-unsubscribe headers", () => {
    const msg = createMockImapMessage({
      list_unsubscribe: "<mailto:unsub@list.com>",
      list_unsubscribe_post: "List-Unsubscribe=One-Click",
    });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.listUnsubscribe).toBe("<mailto:unsub@list.com>");
    expect(parsed.listUnsubscribePost).toBe("List-Unsubscribe=One-Click");
  });

  it("preserves auth results", () => {
    const msg = createMockImapMessage({
      auth_results: '{"spf":"pass","dkim":"pass"}',
    });
    const { parsed } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");
    expect(parsed.authResults).toBe('{"spf":"pass","dkim":"pass"}');
  });

  it("handles date=0 (unparseable Date header) without crashing", () => {
    const msg = createMockImapMessage({ date: 0 });
    const { parsed, threadable } = imapMessageToParsedMessage(msg, "acc-1", "INBOX");

    // date=0 * 1000 = 0, passed through — the caller (imapInitialSync) applies the fallback
    expect(parsed.date).toBe(0);
    expect(threadable.date).toBe(0);
    // Message should still be valid
    expect(parsed.id).toBe("imap-acc-1-INBOX-42");
    expect(parsed.fromAddress).toBe("sender@example.com");
  });
});

describe("imapInitialSync", () => {
  const mockGetAccount = vi.mocked(getAccount);
  const mockImapListFolders = vi.mocked(imapListFolders);
  const mockImapSyncFolder = vi.mocked(imapSyncFolder);
  const mockImapFetchMessages = vi.mocked(imapFetchMessages);
  const mockBatchUpsertMessages = vi.mocked(batchUpsertMessages);
  const mockUpdateMessageThreadIds = vi.mocked(updateMessageThreadIds);
  const mockBatchUpsertThreads = vi.mocked(batchUpsertThreads);
  const mockBatchUpsertAttachments = vi.mocked(batchUpsertAttachments);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetAccount.mockResolvedValue(createMockImapAccount({ id: "acc-1" }));
  });

  afterEach(() => {
    // Reset persistent mock implementations to prevent leaking between describe blocks
    mockImapSyncFolder.mockReset();
    mockImapFetchMessages.mockReset();
    mockImapListFolders.mockReset();
    vi.useRealTimers();
  });

  /** Configure mocks to return a single folder with the given messages. */
  function setupFolderWithMessages(folder: string, messages: ReturnType<typeof createMockImapMessage>[]) {
    const mockFolder = createMockImapFolder({
      path: folder,
      raw_path: folder,
      exists: messages.length,
    });
    mockImapListFolders.mockResolvedValue([mockFolder]);
    // imapSyncFolder returns UIDs + full messages in a single connection
    mockImapSyncFolder.mockResolvedValue({
      uids: messages.map((m) => m.uid),
      messages,
      folder_status: createMockImapFolderStatus({ exists: messages.length }),
    });
    return mockFolder;
  }

  it("stores messages to DB immediately per-chunk (streaming)", async () => {
    const msg1 = createMockImapMessage({ uid: 1, message_id: "<m1@test>", subject: "First", date: Math.floor(Date.now() / 1000) });
    const msg2 = createMockImapMessage({ uid: 2, message_id: "<m2@test>", subject: "Second", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg1, msg2]);

    await imapInitialSync("acc-1");

    // Messages should be batch-stored via batchUpsertMessages during fetch phase
    expect(mockBatchUpsertMessages).toHaveBeenCalled();
    const allCalls = mockBatchUpsertMessages.mock.calls;
    let totalMessages = 0;
    for (const call of allCalls) {
      totalMessages += (call[0] as any[]).length;
    }
    expect(totalMessages).toBe(2);

    // Each message should be stored with placeholder threadId = messageId
    const firstBatch = allCalls[0] as any[];
    expect(firstBatch[0].threadId).toBe(firstBatch[0].id);
  });

  it("creates placeholder thread before each message to satisfy FK constraint", async () => {
    const msg1 = createMockImapMessage({ uid: 1, message_id: "<m1@test>", subject: "Hello", date: Math.floor(Date.now() / 1000) });
    const msg2 = createMockImapMessage({ uid: 2, message_id: "<m2@test>", subject: "World", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg1, msg2]);

    await imapInitialSync("acc-1");

    // batchUpsertThreads is called for placeholders in Phase 3, then final threads in Phase 4
    expect(mockBatchUpsertThreads).toHaveBeenCalled();
    // batchUpsertMessages is called for all messages
    expect(mockBatchUpsertMessages).toHaveBeenCalled();

    // Verify placeholder threads use the message ID as thread ID
    const firstBatch = mockBatchUpsertThreads.mock.calls[0]![0] as any[];
    const firstMsgBatch = mockBatchUpsertMessages.mock.calls[0]![0] as any[];
    // Placeholder threads are created before messages in the same chunk
    expect(firstBatch.length).toBeGreaterThanOrEqual(1);
    expect(firstMsgBatch[0].threadId).toBe(firstMsgBatch[0].id);
  });

  it("updates thread IDs after threading phase", async () => {
    const msg1 = createMockImapMessage({ uid: 1, message_id: "<m1@test>", subject: "Hello", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg1]);

    await imapInitialSync("acc-1");

    // Thread record should be created: once as placeholder in Phase 3, once final in Phase 4
    expect(mockBatchUpsertThreads).toHaveBeenCalled();

    // Thread IDs should be batch-updated via updateMessageThreadIds
    expect(mockUpdateMessageThreadIds).toHaveBeenCalledTimes(1);
    const [accountId, messageIds, threadId] = mockUpdateMessageThreadIds.mock.calls[0]!;
    expect(accountId).toBe("acc-1");
    expect(messageIds).toHaveLength(1);
    expect(threadId).toBeTruthy();
  });

  it("returns empty messages array (bodies not accumulated)", async () => {
    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg]);

    const result = await imapInitialSync("acc-1");

    // The streaming approach returns empty array — bodies are already in DB
    expect(result.messages).toEqual([]);
  });

  it("stores attachments immediately with the message", async () => {
    const msg = createMockImapMessage({
      uid: 1,
      message_id: "<m1@test>",
      date: Math.floor(Date.now() / 1000),
      attachments: [
        {
          part_id: "2",
          filename: "doc.pdf",
          mime_type: "application/pdf",
          size: 5000,
          content_id: null,
          is_inline: false,
        },
      ],
    });
    setupFolderWithMessages("INBOX", [msg]);

    await imapInitialSync("acc-1");

    expect(mockBatchUpsertAttachments).toHaveBeenCalled();
    const allAttCalls = mockBatchUpsertAttachments.mock.calls;
    let totalAtts = 0;
    for (const call of allAttCalls) {
      totalAtts += (call[0] as any[]).length;
    }
    expect(totalAtts).toBe(1);
    const attBatch = (allAttCalls[0] as any[])[0] as any[];
    expect(attBatch[0].filename).toBe("doc.pdf");
    expect(attBatch[0].mimeType).toBe("application/pdf");
    expect(attBatch[0].accountId).toBe("acc-1");
  });

  it("filters messages by date cutoff", async () => {
    const recentDate = Math.floor(Date.now() / 1000) - 10; // 10 seconds ago
    const oldDate = Math.floor(Date.now() / 1000) - 400 * 86400; // 400 days ago

    const recentMsg = createMockImapMessage({ uid: 1, message_id: "<recent@test>", date: recentDate });
    const oldMsg = createMockImapMessage({ uid: 2, message_id: "<old@test>", date: oldDate });

    setupFolderWithMessages("INBOX", [recentMsg, oldMsg]);

    await imapInitialSync("acc-1", 365);

    // Only recent message should be stored (old one is beyond 365 days)
    const allMsgCalls = mockBatchUpsertMessages.mock.calls;
    let totalMsgs = 0;
    for (const call of allMsgCalls) {
      totalMsgs += (call[0] as any[]).length;
    }
    expect(totalMsgs).toBe(1);
  });

  it("handles empty folders gracefully", async () => {
    const mockFolder = createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 0 });
    mockImapListFolders.mockResolvedValue([mockFolder]);

    const result = await imapInitialSync("acc-1");

    expect(mockImapSyncFolder).not.toHaveBeenCalled();
    expect(mockBatchUpsertMessages).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
  });

  it("reports progress through all phases", async () => {
    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg]);

    const progressCalls: Array<{ phase: string }> = [];
    await imapInitialSync("acc-1", 365, (progress) => {
      progressCalls.push({ phase: progress.phase });
    });

    const phases = progressCalls.map((p) => p.phase);
    expect(phases).toContain("folders");
    expect(phases).toContain("messages");
    expect(phases).toContain("threading");
    expect(phases).toContain("storing_threads");
    expect(phases).toContain("done");
  });

  it("uses imapSyncFolder for single-connection sync per folder", async () => {
    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg]);

    await imapInitialSync("acc-1");

    // Should use imapSyncFolder (single connection: SELECT → SEARCH → FETCH)
    expect(mockImapSyncFolder).toHaveBeenCalledTimes(1);
    expect(mockImapSyncFolder).toHaveBeenCalledWith(
      expect.objectContaining({ host: "imap.example.com" }),
      "INBOX",
      expect.any(Number), // batchSize
      expect.stringMatching(/^\d{1,2}-[A-Z][a-z]{2}-\d{4}$/), // sinceDate in DD-Mon-YYYY format
    );
  });

  it("uses batch inserts for DB writes instead of per-item calls", async () => {
    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });
    setupFolderWithMessages("INBOX", [msg]);

    await imapInitialSync("acc-1");

    // batchUpsertMessages should be called with an array of messages
    expect(mockBatchUpsertMessages).toHaveBeenCalled();
    const batchCall = mockBatchUpsertMessages.mock.calls[0]![0] as any[];
    expect(Array.isArray(batchCall)).toBe(true);
    expect(batchCall.length).toBe(1);

    // batchUpsertThreads should be called with an array of threads
    expect(mockBatchUpsertThreads).toHaveBeenCalled();
  });

  it("continues on folder sync error", async () => {
    const folders = [
      createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 2 }),
      createMockImapFolder({ path: "Sent", raw_path: "Sent", exists: 1 }),
    ];
    mockImapListFolders.mockResolvedValue(folders);

    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });

    // First folder fails, second succeeds
    mockImapSyncFolder
      .mockRejectedValueOnce(new Error("folder sync failed"))
      .mockResolvedValueOnce({
        uids: [msg.uid],
        messages: [msg],
        folder_status: createMockImapFolderStatus({ exists: 1 }),
      });

    const syncPromise = imapInitialSync("acc-1");
    await vi.runAllTimersAsync();
    const result = await syncPromise;

    // Sync should complete — second folder succeeded
    expect(result.messages).toEqual([]);
  });

  it("circuit breaker skips remaining folders after 5 consecutive connection failures", async () => {
    const folders = Array.from({ length: 8 }, (_, i) =>
      createMockImapFolder({ path: `folder-${i}`, raw_path: `folder-${i}`, exists: 10 }),
    );
    mockImapListFolders.mockResolvedValue(folders);
    mockImapSyncFolder.mockRejectedValue(new Error("TCP connect timed out (os error 60)"));

    // Advance timers and catch the expected error in one go to avoid
    // Vitest's unhandled-rejection tracker from flagging it.
    let caughtError: Error | null = null;
    const syncPromise = imapInitialSync("acc-1").catch((err: Error) => {
      caughtError = err;
    });
    await vi.runAllTimersAsync();
    await syncPromise;

    // All folders fail → error is propagated
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("All folders failed to sync");

    // Circuit breaker should stop after 5 failures (CIRCUIT_BREAKER_MAX_FAILURES)
    expect(mockImapSyncFolder).toHaveBeenCalledTimes(5);
  });

  it("circuit breaker resets on successful folder sync", async () => {
    const folders = [
      createMockImapFolder({ path: "f1", raw_path: "f1", exists: 10 }),
      createMockImapFolder({ path: "f2", raw_path: "f2", exists: 10 }),
      createMockImapFolder({ path: "f3", raw_path: "f3", exists: 10 }),
      createMockImapFolder({ path: "f4", raw_path: "f4", exists: 10 }),
    ];
    mockImapListFolders.mockResolvedValue(folders);

    const msg = createMockImapMessage({ uid: 1, message_id: "<m1@test>", date: Math.floor(Date.now() / 1000) });

    // First 2 fail with connection error, 3rd succeeds, 4th fails
    mockImapSyncFolder
      .mockRejectedValueOnce(new Error("TCP connect timed out"))
      .mockRejectedValueOnce(new Error("TCP connect timed out"))
      .mockResolvedValueOnce({
        uids: [msg.uid],
        messages: [msg],
        folder_status: createMockImapFolderStatus({ exists: 1 }),
      })
      .mockRejectedValueOnce(new Error("TCP connect timed out"));

    const syncPromise = imapInitialSync("acc-1");
    await vi.runAllTimersAsync();
    await syncPromise;

    // All 4 folders should be attempted (circuit breaker resets after success on f3)
    expect(mockImapSyncFolder).toHaveBeenCalledTimes(4);
  });

  it("continues on non-connection errors without triggering circuit breaker", async () => {
    const folders = Array.from({ length: 6 }, (_, i) =>
      createMockImapFolder({ path: `folder-${i}`, raw_path: `folder-${i}`, exists: 10 }),
    );
    mockImapListFolders.mockResolvedValue(folders);

    // Non-connection errors should NOT trigger circuit breaker
    mockImapSyncFolder.mockRejectedValue(new Error("PARSE failed: invalid response"));

    let caughtError: Error | null = null;
    const syncPromise = imapInitialSync("acc-1").catch((err: Error) => {
      caughtError = err;
    });
    await vi.runAllTimersAsync();
    await syncPromise;

    // All folders fail → error is propagated, but all were attempted first
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("All folders failed to sync");

    // All folders should be attempted since these aren't connection errors
    expect(mockImapSyncFolder).toHaveBeenCalledTimes(6);
  });
});

describe("formatImapDate", () => {
  it("formats a date as DD-Mon-YYYY for IMAP SINCE criterion", () => {
    // 2024-03-15 UTC
    const date = new Date(Date.UTC(2024, 2, 15));
    expect(formatImapDate(date)).toBe("15-Mar-2024");
  });

  it("handles single-digit days without zero-padding", () => {
    const date = new Date(Date.UTC(2024, 0, 5));
    expect(formatImapDate(date)).toBe("5-Jan-2024");
  });

  it("handles December correctly", () => {
    const date = new Date(Date.UTC(2024, 11, 31));
    expect(formatImapDate(date)).toBe("31-Dec-2024");
  });
});

describe("computeSinceDate", () => {
  it("returns a date daysBack+1 days ago in DD-Mon-YYYY format", () => {
    const result = computeSinceDate(365);
    // Should match DD-Mon-YYYY format
    expect(result).toMatch(/^\d{1,2}-[A-Z][a-z]{2}-\d{4}$/);
  });

  it("adds 1-day safety margin", () => {
    // For daysBack=0, should still go back 1 day
    const result = computeSinceDate(0);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    expect(result).toBe(formatImapDate(yesterday));
  });
});

describe("isConnectionError", () => {
  it("detects 'timed out' errors", () => {
    expect(isConnectionError("TCP connect timed out (os error 60)")).toBe(true);
  });

  it("detects 'connection' errors", () => {
    expect(isConnectionError("connection reset by peer")).toBe(true);
  });

  it("detects TLS errors", () => {
    expect(isConnectionError("tls handshake failed")).toBe(true);
  });

  it("detects DNS errors", () => {
    expect(isConnectionError("dns resolution failed")).toBe(true);
  });

  it("detects ECONNREFUSED errors", () => {
    expect(isConnectionError("connect ECONNREFUSED 127.0.0.1:993")).toBe(true);
  });

  it("detects socket errors", () => {
    expect(isConnectionError("socket hang up")).toBe(true);
  });

  it("detects network errors", () => {
    expect(isConnectionError("network is unreachable")).toBe(true);
  });

  it("returns false for non-connection errors", () => {
    expect(isConnectionError("PARSE failed: invalid response")).toBe(false);
    expect(isConnectionError("authentication failed")).toBe(false);
  });
});

describe("imapInitialSync — all-folders-fail propagation", () => {
  const mockGetAccount = vi.mocked(getAccount);
  const mockImapListFolders = vi.mocked(imapListFolders);
  const mockImapSyncFolder = vi.mocked(imapSyncFolder);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetAccount.mockResolvedValue(createMockImapAccount({ id: "acc-1" }));
  });

  afterEach(() => {
    mockImapSyncFolder.mockReset();
    vi.useRealTimers();
  });

  it("throws when all folders fail and no messages were stored", async () => {
    const folders = [
      createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 10 }),
      createMockImapFolder({ path: "Sent", raw_path: "Sent", exists: 5 }),
    ];
    mockImapListFolders.mockResolvedValue(folders);
    mockImapSyncFolder.mockRejectedValue("authentication failed");

    let caughtError: Error | null = null;
    const syncPromise = imapInitialSync("acc-1").catch((err: Error) => {
      caughtError = err;
    });
    await vi.runAllTimersAsync();
    await syncPromise;

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("All folders failed to sync");
  });
});

describe("imapInitialSync — placeholder cleanup", () => {
  const mockGetAccount = vi.mocked(getAccount);
  const mockImapListFolders = vi.mocked(imapListFolders);
  const mockImapSyncFolder = vi.mocked(imapSyncFolder);
  const mockDeleteThread = vi.mocked(deleteThread);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetAccount.mockResolvedValue(createMockImapAccount({ id: "acc-1" }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes orphaned placeholder threads after threading", async () => {
    // Two messages that share the same thread via References
    const msg1 = createMockImapMessage({
      uid: 1,
      message_id: "<m1@test>",
      subject: "Thread Subject",
      date: Math.floor(Date.now() / 1000),
    });
    const msg2 = createMockImapMessage({
      uid: 2,
      message_id: "<m2@test>",
      in_reply_to: "<m1@test>",
      references: "<m1@test>",
      subject: "Re: Thread Subject",
      date: Math.floor(Date.now() / 1000) + 60,
    });

    const mockFolder = createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 2 });
    mockImapListFolders.mockResolvedValue([mockFolder]);
    mockImapSyncFolder.mockResolvedValue({
      uids: [1, 2],
      messages: [msg1, msg2],
      folder_status: createMockImapFolderStatus({ exists: 2 }),
    });

    await imapInitialSync("acc-1");

    // Threading should merge the two messages into one thread,
    // so at least one placeholder thread (the one not chosen as thread ID) should be deleted
    expect(mockDeleteThread).toHaveBeenCalled();
  });
});

describe("imapDeltaSync — label merging for existing threads", () => {
  const mockGetAccount = vi.mocked(getAccount);
  const mockImapListFolders = vi.mocked(imapListFolders);
  const mockImapDeltaCheck = vi.mocked(imapDeltaCheck);
  const mockImapFetchMessages = vi.mocked(imapFetchMessages);
  const mockBatchUpsertThreads = vi.mocked(batchUpsertThreads);
  const mockSetThreadLabels = vi.mocked(setThreadLabels);
  const mockAddThreadLabels = vi.mocked(addThreadLabels);
  const mockGetThreadsByIds = vi.mocked(getThreadsByIds);
  const mockGetThreadIdsByMessageIds = vi.mocked(getThreadIdsByMessageIds);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetAccount.mockResolvedValue(createMockImapAccount({ id: "acc-1" }));
    mockGetThreadIdsByMessageIds.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges labels for existing threads instead of replacing them", async () => {
    // Simulate: a thread already exists with INBOX + Sent labels.
    // A new reply arrives in INBOX only. Delta sync should merge labels,
    // not replace them (which would delete the Sent label).

    const folders = [
      createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 10 }),
    ];
    mockImapListFolders.mockResolvedValue(folders);

    // Mock folder sync state
    vi.mocked(getAllFolderSyncStates).mockResolvedValue([
      { account_id: "acc-1", folder_path: "INBOX", last_uid: 100, uidvalidity: 1, modseq: null, last_sync_at: 1000 },
    ]);

    // Delta check returns one new UID
    mockImapDeltaCheck.mockResolvedValue([
      {
        folder: "INBOX",
        uidvalidity: 1,
        new_uids: [101],
        uidvalidity_changed: false,
      },
    ]);

    const existingThreadId = "existing-thread-id";

    const newMsg = createMockImapMessage({
      uid: 101,
      message_id: "<new-reply@test>",
      in_reply_to: "<original@test>",
      references: "<original@test>",
      subject: "Re: Existing Thread",
      date: Math.floor(Date.now() / 1000),
    });
    mockImapFetchMessages.mockResolvedValue({
      messages: [newMsg],
      folder_status: createMockImapFolderStatus({ exists: 11, uidvalidity: 1 }),
    });

    // The new message references <original@test>, which exists in the DB under
    // the existingThreadId. getThreadIdsByMessageIds returns this mapping so the
    // delta sync can remap the new thread group to the existing thread.
    mockGetThreadIdsByMessageIds.mockResolvedValue(
      new Map([["original@test", existingThreadId]]),
    );

    // After remapping, getThreadsByIds is called with the existing thread ID
    mockGetThreadsByIds.mockImplementation(async (_accountId: string, threadIds: string[]) => {
      const existingThread = {
        id: existingThreadId,
        account_id: "acc-1",
        message_count: 3,
      };
      return new Map([[existingThreadId, existingThread as any]]);
    });

    await imapDeltaSync("acc-1");

    // The new message should be remapped to the existing thread
    expect(mockGetThreadIdsByMessageIds).toHaveBeenCalledWith(
      "acc-1",
      expect.arrayContaining(["original@test"]),
    );

    // For an existing thread, addThreadLabels should be called instead of setThreadLabels
    // This preserves the Sent label while adding the INBOX label
    expect(mockAddThreadLabels).toHaveBeenCalledWith(
      "acc-1",
      existingThreadId,
      expect.any(Array),
    );
  });

  it("remaps thread ID when new message references existing thread", async () => {
    // Simulate: buildThreads produces a different thread ID than the existing thread
    // because it only sees the new message, not the full conversation.
    // The remapping logic should detect the reference and use the existing thread ID.

    const folders = [
      createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 10 }),
    ];
    mockImapListFolders.mockResolvedValue(folders);

    vi.mocked(getAllFolderSyncStates).mockResolvedValue([
      { account_id: "acc-1", folder_path: "INBOX", last_uid: 100, uidvalidity: 1, modseq: null, last_sync_at: 1000 },
    ]);

    mockImapDeltaCheck.mockResolvedValue([
      {
        folder: "INBOX",
        uidvalidity: 1,
        new_uids: [101],
        uidvalidity_changed: false,
      },
    ]);

    const existingThreadId = "existing-thread-abc";

    const newMsg = createMockImapMessage({
      uid: 101,
      message_id: "<reply-101@test>",
      in_reply_to: "<msg-50@test>",
      references: "<msg-10@test> <msg-50@test>",
      subject: "Re: Important Discussion",
      date: Math.floor(Date.now() / 1000),
    });
    mockImapFetchMessages.mockResolvedValue({
      messages: [newMsg],
      folder_status: createMockImapFolderStatus({ exists: 11, uidvalidity: 1 }),
    });

    // The referenced message <msg-50@test> belongs to existingThreadId
    mockGetThreadIdsByMessageIds.mockResolvedValue(
      new Map([["msg-50@test", existingThreadId]]),
    );

    // getThreadsByIds should be called with the REMAPPED existing thread ID,
    // not the thread ID generated by buildThreads
    mockGetThreadsByIds.mockImplementation(async (_accountId: string, threadIds: string[]) => {
      // Verify the thread ID is the remapped one, not a buildThreads-generated ID
      expect(threadIds).toContain(existingThreadId);
      const existingThread = {
        id: existingThreadId,
        account_id: "acc-1",
        message_count: 5,
      };
      return new Map([[existingThreadId, existingThread as any]]);
    });

    await imapDeltaSync("acc-1");

    // Verify the new message is stored under the existing thread
    expect(mockBatchUpsertThreads).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: existingThreadId,
          messageCount: 6, // 5 existing + 1 new
        }),
      ]),
    );
  });

  it("uses setThreadLabels for new threads during delta sync", async () => {
    // Simulate: a completely new thread — no existing thread found
    mockGetThreadsByIds.mockResolvedValue(new Map());

    const folders = [
      createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 10 }),
    ];
    mockImapListFolders.mockResolvedValue(folders);

    vi.mocked(getAllFolderSyncStates).mockResolvedValue([
      { account_id: "acc-1", folder_path: "INBOX", last_uid: 100, uidvalidity: 1, modseq: null, last_sync_at: 1000 },
    ]);

    mockImapDeltaCheck.mockResolvedValue([
      {
        folder: "INBOX",
        uidvalidity: 1,
        new_uids: [101],
        uidvalidity_changed: false,
      },
    ]);

    const newMsg = createMockImapMessage({
      uid: 101,
      message_id: "<brand-new@test>",
      subject: "Brand New Thread",
      date: Math.floor(Date.now() / 1000),
    });
    mockImapFetchMessages.mockResolvedValue({
      messages: [newMsg],
      folder_status: createMockImapFolderStatus({ exists: 11, uidvalidity: 1 }),
    });

    await imapDeltaSync("acc-1");

    // For a new thread, setThreadLabels should be called
    expect(mockSetThreadLabels).toHaveBeenCalled();
    expect(mockAddThreadLabels).not.toHaveBeenCalled();
  });

  it("remaps thread by RFC Message-ID when In-Reply-To remapping fails", async () => {
    // Simulate: a new message has no In-Reply-To/References headers,
    // but its RFC Message-ID already exists in the DB under a different thread.
    // The RFC-ID-based safety net should detect this and remap.

    const folders = [
      createMockImapFolder({ path: "INBOX", raw_path: "INBOX", exists: 10 }),
    ];
    mockImapListFolders.mockResolvedValue(folders);

    vi.mocked(getAllFolderSyncStates).mockResolvedValue([
      { account_id: "acc-1", folder_path: "INBOX", last_uid: 100, uidvalidity: 1, modseq: null, last_sync_at: 1000 },
    ]);

    mockImapDeltaCheck.mockResolvedValue([
      {
        folder: "INBOX",
        uidvalidity: 1,
        new_uids: [101],
        uidvalidity_changed: false,
      },
    ]);

    const existingThreadId = "existing-thread-rfc";

    // New message with no In-Reply-To — In-Reply-To remapping won't help
    const newMsg = createMockImapMessage({
      uid: 101,
      message_id: "<existing-msg@test>",
      subject: "Existing Thread",
      date: Math.floor(Date.now() / 1000),
    });
    mockImapFetchMessages.mockResolvedValue({
      messages: [newMsg],
      folder_status: createMockImapFolderStatus({ exists: 11, uidvalidity: 1 }),
    });

    // The new message's RFC-ID (with angle brackets as stored in DB) already exists
    // in the DB under existingThreadId. The safety net lookup uses the raw message_id
    // from the IMAP message, which includes angle brackets.
    mockGetThreadIdsByMessageIds.mockResolvedValue(
      new Map([["<existing-msg@test>", existingThreadId]]),
    );

    // First call: getThreadsByIds for buildThreads-generated ID (won't find it)
    // Second call: after RFC-ID remapping, getThreadsByIds for existingThreadId
    mockGetThreadsByIds.mockImplementation(async (_accountId: string, threadIds: string[]) => {
      if (threadIds.includes(existingThreadId)) {
        const existingThread = {
          id: existingThreadId,
          account_id: "acc-1",
          message_count: 4,
        };
        return new Map([[existingThreadId, existingThread as any]]);
      }
      return new Map();
    });

    await imapDeltaSync("acc-1");

    // Should use addThreadLabels for the existing thread, not setThreadLabels
    expect(mockAddThreadLabels).toHaveBeenCalledWith(
      "acc-1",
      existingThreadId,
      expect.any(Array),
    );

    // Thread should be updated with incremented message count
    expect(mockBatchUpsertThreads).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: existingThreadId,
          messageCount: 5, // 4 existing + 1 new
        }),
      ]),
    );
  });
});
