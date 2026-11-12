import { getDb } from "./connection";

export interface DbThread {
  id: string;
  account_id: string;
  subject: string | null;
  snippet: string | null;
  last_message_at: number | null;
  message_count: number;
  is_read: number;
  is_starred: number;
  is_important: number;
  has_attachments: number;
  is_snoozed: number;
  snooze_until: number | null;
  is_pinned: number;
  is_muted: number;
  from_name: string | null;
  from_address: string | null;
}

export async function getThreadsForAccount(
  accountId: string,
  labelId?: string,
  limit = 50,
  offset = 0,
): Promise<DbThread[]> {
  const db = await getDb();
  if (labelId) {
    return db.select<DbThread[]>(
      `SELECT t.*, m.from_name, m.from_address FROM threads t
       INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
       LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
         AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
       WHERE t.account_id = $1 AND tl.label_id = $2
       GROUP BY t.account_id, t.id
       ORDER BY t.is_pinned DESC, t.last_message_at DESC
       LIMIT $3 OFFSET $4`,
      [accountId, labelId, limit, offset],
    );
  }
  return db.select<DbThread[]>(
    `SELECT t.*, m.from_name, m.from_address FROM threads t
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     WHERE t.account_id = $1
     ORDER BY t.is_pinned DESC, t.last_message_at DESC LIMIT $2 OFFSET $3`,
    [accountId, limit, offset],
  );
}

export async function getThreadsForCategory(
  accountId: string,
  category: string,
  limit = 50,
  offset = 0,
): Promise<DbThread[]> {
  const db = await getDb();
  if (category === "Primary") {
    // Primary includes threads with NULL category (uncategorized)
    return db.select<DbThread[]>(
      `SELECT t.*, m.from_name, m.from_address FROM threads t
       INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
       LEFT JOIN thread_categories tc ON tc.account_id = t.account_id AND tc.thread_id = t.id
       LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
         AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
       WHERE t.account_id = $1 AND tl.label_id = 'INBOX' AND (tc.category IS NULL OR tc.category = 'Primary')
       GROUP BY t.account_id, t.id
       ORDER BY t.is_pinned DESC, t.last_message_at DESC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset],
    );
  }
  return db.select<DbThread[]>(
    `SELECT t.*, m.from_name, m.from_address FROM threads t
     INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
     INNER JOIN thread_categories tc ON tc.account_id = t.account_id AND tc.thread_id = t.id
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     WHERE t.account_id = $1 AND tl.label_id = 'INBOX' AND tc.category = $2
     GROUP BY t.account_id, t.id
     ORDER BY t.is_pinned DESC, t.last_message_at DESC
     LIMIT $3 OFFSET $4`,
    [accountId, category, limit, offset],
  );
}

export interface UpsertThreadInput {
  id: string;
  accountId: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: number | null;
  messageCount: number;
  isRead: boolean;
  isStarred: boolean;
  isImportant: boolean;
  hasAttachments: boolean;
}

export async function upsertThread(thread: UpsertThreadInput): Promise<void> {
  await batchUpsertThreads([thread]);
}

/**
 * Batch upsert multiple threads in a single SQL statement.
 */
export async function batchUpsertThreads(threads: UpsertThreadInput[]): Promise<void> {
  if (threads.length === 0) return;
  const db = await getDb();
  const cols = "id, account_id, subject, snippet, last_message_at, message_count, is_read, is_starred, is_important, has_attachments";
  const perRow = 10;
  const placeholders = threads.map((_, ri) => {
    const params: string[] = [];
    for (let ci = 0; ci < perRow; ci++) {
      params.push(`$${ri * perRow + ci + 1}`);
    }
    return `(${params.join(", ")})`;
  }).join(", ");
  const allParams: unknown[] = [];
  for (const t of threads) {
    allParams.push(
      t.id, t.accountId, t.subject, t.snippet, t.lastMessageAt,
      t.messageCount, t.isRead ? 1 : 0, t.isStarred ? 1 : 0,
      t.isImportant ? 1 : 0, t.hasAttachments ? 1 : 0,
    );
  }
  await db.execute(
    `INSERT INTO threads (${cols}) VALUES ${placeholders}
     ON CONFLICT(account_id, id) DO UPDATE SET
       subject = excluded.subject, snippet = excluded.snippet,
       last_message_at = excluded.last_message_at, message_count = excluded.message_count,
       is_read = excluded.is_read, is_starred = excluded.is_starred,
       is_important = excluded.is_important, has_attachments = excluded.has_attachments`,
    allParams,
  );
}

export async function setThreadLabels(
  accountId: string,
  threadId: string,
  labelIds: string[],
): Promise<void> {
  const db = await getDb();
  // Remove existing labels
  await db.execute(
    "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2",
    [accountId, threadId],
  );
  // Insert new labels
  for (const labelId of labelIds) {
    await db.execute(
      "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
      [accountId, threadId, labelId],
    );
  }
}

export async function getThreadLabelIds(
  accountId: string,
  threadId: string,
): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ label_id: string }[]>(
    "SELECT label_id FROM thread_labels WHERE account_id = $1 AND thread_id = $2",
    [accountId, threadId],
  );
  return rows.map((r) => r.label_id);
}

export async function getThreadById(
  accountId: string,
  threadId: string,
): Promise<DbThread | undefined> {
  const db = await getDb();
  const rows = await db.select<DbThread[]>(
    `SELECT t.*, m.from_name, m.from_address FROM threads t
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     WHERE t.account_id = $1 AND t.id = $2
     LIMIT 1`,
    [accountId, threadId],
  );
  return rows[0];
}

export async function getThreadCountForAccount(accountId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM threads WHERE account_id = $1",
    [accountId],
  );
  return rows[0]?.count ?? 0;
}

export async function getUnreadInboxCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM threads t
     INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
     WHERE tl.label_id = 'INBOX' AND t.is_read = 0`,
  );
  return rows[0]?.count ?? 0;
}

export async function deleteThread(
  accountId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM threads WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
}

export async function deleteAllThreadsForAccount(
  accountId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM threads WHERE account_id = $1",
    [accountId],
  );
}

export async function pinThread(
  accountId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE threads SET is_pinned = 1 WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
}

export async function unpinThread(
  accountId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE threads SET is_pinned = 0 WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
}

export async function muteThread(
  accountId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE threads SET is_muted = 1 WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
}

export async function unmuteThread(
  accountId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE threads SET is_muted = 0 WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
}

export async function getMutedThreadIds(
  accountId: string,
): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM threads WHERE account_id = $1 AND is_muted = 1",
    [accountId],
  );
  return new Set(rows.map((r) => r.id));
}
