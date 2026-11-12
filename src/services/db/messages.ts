import { getDb } from "./connection";

export interface DbMessage {
  id: string;
  account_id: string;
  thread_id: string;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  reply_to: string | null;
  subject: string | null;
  snippet: string | null;
  date: number;
  is_read: number;
  is_starred: number;
  body_html: string | null;
  body_text: string | null;
  body_cached: number;
  raw_size: number | null;
  internal_date: number | null;
  list_unsubscribe: string | null;
  list_unsubscribe_post: string | null;
  auth_results: string | null;
  message_id_header: string | null;
  references_header: string | null;
  in_reply_to_header: string | null;
  imap_uid: number | null;
  imap_folder: string | null;
}

export async function getMessagesForThread(
  accountId: string,
  threadId: string,
): Promise<DbMessage[]> {
  const db = await getDb();
  return db.select<DbMessage[]>(
    "SELECT * FROM messages WHERE account_id = $1 AND thread_id = $2 ORDER BY date ASC",
    [accountId, threadId],
  );
}

export interface UpsertMessageInput {
  id: string;
  accountId: string;
  threadId: string;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string | null;
  ccAddresses: string | null;
  bccAddresses: string | null;
  replyTo: string | null;
  subject: string | null;
  snippet: string | null;
  date: number;
  isRead: boolean;
  isStarred: boolean;
  bodyHtml: string | null;
  bodyText: string | null;
  rawSize: number | null;
  internalDate: number | null;
  listUnsubscribe?: string | null;
  listUnsubscribePost?: string | null;
  authResults?: string | null;
  messageIdHeader?: string | null;
  referencesHeader?: string | null;
  inReplyToHeader?: string | null;
  imapUid?: number | null;
  imapFolder?: string | null;
}

export async function upsertMessage(msg: UpsertMessageInput): Promise<void> {
  await batchUpsertMessages([msg]);
}

/**
 * Batch upsert multiple messages in a single SQL statement.
 * This dramatically reduces SQLite lock contention during sync by holding
 * the lock once per batch instead of once per message.
 */
export async function batchUpsertMessages(messages: UpsertMessageInput[]): Promise<void> {
  if (messages.length === 0) return;
  const db = await getDb();
  const cols = "id, account_id, thread_id, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, reply_to, subject, snippet, date, is_read, is_starred, body_html, body_text, body_cached, raw_size, internal_date, list_unsubscribe, list_unsubscribe_post, auth_results, message_id_header, references_header, in_reply_to_header, imap_uid, imap_folder";
  // Each message has 27 columns → 27 params per row
  const perRow = 27;
  const placeholders = messages.map((_, ri) => {
    const params: string[] = [];
    for (let ci = 0; ci < perRow; ci++) {
      params.push(`$${ri * perRow + ci + 1}`);
    }
    return `(${params.join(", ")})`;
  }).join(", ");
  const allParams: unknown[] = [];
  for (const msg of messages) {
    allParams.push(
      msg.id, msg.accountId, msg.threadId, msg.fromAddress, msg.fromName,
      msg.toAddresses, msg.ccAddresses, msg.bccAddresses, msg.replyTo,
      msg.subject, msg.snippet, msg.date, msg.isRead ? 1 : 0, msg.isStarred ? 1 : 0,
      msg.bodyHtml, msg.bodyText, msg.bodyHtml ? 1 : 0, msg.rawSize,
      msg.internalDate, msg.listUnsubscribe ?? null, msg.listUnsubscribePost ?? null,
      msg.authResults ?? null, msg.messageIdHeader ?? null, msg.referencesHeader ?? null,
      msg.inReplyToHeader ?? null, msg.imapUid ?? null, msg.imapFolder ?? null,
    );
  }
  await db.execute(
    `INSERT INTO messages (${cols}) VALUES ${placeholders}
     ON CONFLICT(account_id, id) DO UPDATE SET
       from_address = excluded.from_address, from_name = excluded.from_name,
       to_addresses = excluded.to_addresses, cc_addresses = excluded.cc_addresses,
       bcc_addresses = excluded.bcc_addresses, reply_to = excluded.reply_to,
       subject = excluded.subject, snippet = excluded.snippet,
       date = excluded.date, is_read = excluded.is_read, is_starred = excluded.is_starred,
       body_html = COALESCE(excluded.body_html, body_html),
       body_text = COALESCE(excluded.body_text, body_text),
       body_cached = CASE WHEN excluded.body_html IS NOT NULL THEN 1 ELSE body_cached END,
       raw_size = excluded.raw_size, internal_date = excluded.internal_date,
       list_unsubscribe = excluded.list_unsubscribe,
       list_unsubscribe_post = excluded.list_unsubscribe_post,
       auth_results = excluded.auth_results,
       message_id_header = COALESCE(excluded.message_id_header, message_id_header),
       references_header = COALESCE(excluded.references_header, references_header),
       in_reply_to_header = COALESCE(excluded.in_reply_to_header, in_reply_to_header),
       imap_uid = COALESCE(excluded.imap_uid, imap_uid),
       imap_folder = COALESCE(excluded.imap_folder, imap_folder)`,
    allParams,
  );
}

export async function deleteMessage(
  accountId: string,
  messageId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM messages WHERE account_id = $1 AND id = $2",
    [accountId, messageId],
  );
}

export async function updateMessageThreadIds(
  accountId: string,
  messageIds: string[],
  threadId: string,
): Promise<void> {
  const db = await getDb();
  // SQLite variable limit is 999; process in chunks
  for (let i = 0; i < messageIds.length; i += 500) {
    const chunk = messageIds.slice(i, i + 500);
    const placeholders = chunk.map((_, idx) => `$${idx + 3}`).join(", ");
    await db.execute(
      `UPDATE messages SET thread_id = $1 WHERE account_id = $2 AND id IN (${placeholders})`,
      [threadId, accountId, ...chunk],
    );
  }
}

export async function deleteAllMessagesForAccount(
  accountId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM messages WHERE account_id = $1",
    [accountId],
  );
}

/**
 * Get recent sent messages for an account, matching from_address to account email.
 * Used for writing style analysis.
 */
export async function getRecentSentMessages(
  accountId: string,
  accountEmail: string,
  limit: number = 15,
): Promise<DbMessage[]> {
  const db = await getDb();
  return db.select<DbMessage[]>(
    `SELECT * FROM messages
     WHERE account_id = $1 AND LOWER(from_address) = LOWER($2)
       AND body_text IS NOT NULL AND LENGTH(body_text) > 50
     ORDER BY date DESC LIMIT $3`,
    [accountId, accountEmail, limit],
  );
}

/**
 * Count messages with broken body content.
 * Broken messages are those where:
 * 1. body_html or body_text starts with MIME boundaries (`--`), indicating raw multipart
 *    content was stored instead of parsed HTML/text (mail-parser issue).
 * 2. Both body_html and body_text are NULL or empty AND the message has an imap_uid
 *    set, indicating the IMAP fetch returned no body data (async-imap parsing issue).
 *    We require imap_folder IS NOT NULL to avoid counting legitimate plain-text emails
 *    that simply have no HTML part.
 */
export async function countBrokenMessagesForAccount(accountId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count FROM messages
     WHERE account_id = $1
       AND (
         -- Raw MIME content stored instead of parsed HTML/text
         body_html LIKE '--%'
         OR body_text LIKE '--%'
         -- Both body_html and body_text are missing for an IMAP message (empty fetch)
         OR ((body_html IS NULL OR TRIM(body_html) = '')
             AND (body_text IS NULL OR TRIM(body_text) = '')
             AND imap_folder IS NOT NULL)
       )`,
    [accountId],
  );
  return rows[0]?.count ?? 0;
}
