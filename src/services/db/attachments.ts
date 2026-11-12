import { getDb } from "./connection";

export interface DbAttachment {
  id: string;
  message_id: string;
  account_id: string;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
  gmail_attachment_id: string | null;
  content_id: string | null;
  is_inline: number;
  local_path: string | null;
}

export interface UpsertAttachmentInput {
  id: string;
  messageId: string;
  accountId: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  gmailAttachmentId: string | null;
  contentId: string | null;
  isInline: boolean;
}

export async function upsertAttachment(att: UpsertAttachmentInput): Promise<void> {
  await batchUpsertAttachments([att]);
}

/**
 * Batch upsert multiple attachments in a single SQL statement.
 */
export async function batchUpsertAttachments(attachments: UpsertAttachmentInput[]): Promise<void> {
  if (attachments.length === 0) return;
  const db = await getDb();
  const cols = "id, message_id, account_id, filename, mime_type, size, gmail_attachment_id, content_id, is_inline";
  const perRow = 9;
  const placeholders = attachments.map((_, ri) => {
    const params: string[] = [];
    for (let ci = 0; ci < perRow; ci++) {
      params.push(`$${ri * perRow + ci + 1}`);
    }
    return `(${params.join(", ")})`;
  }).join(", ");
  const allParams: unknown[] = [];
  for (const att of attachments) {
    allParams.push(
      att.id, att.messageId, att.accountId, att.filename, att.mimeType,
      att.size, att.gmailAttachmentId, att.contentId, att.isInline ? 1 : 0,
    );
  }
  await db.execute(
    `INSERT INTO attachments (${cols}) VALUES ${placeholders}
     ON CONFLICT(id) DO UPDATE SET
       filename = excluded.filename, mime_type = excluded.mime_type,
       size = excluded.size, gmail_attachment_id = excluded.gmail_attachment_id,
       content_id = excluded.content_id, is_inline = excluded.is_inline`,
    allParams,
  );
}

export interface AttachmentWithContext {
  id: string;
  message_id: string;
  account_id: string;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
  gmail_attachment_id: string | null;
  content_id: string | null;
  is_inline: number;
  local_path: string | null;
  from_address: string | null;
  from_name: string | null;
  date: number | null;
  subject: string | null;
  thread_id: string | null;
}

export async function getAttachmentsForAccount(
  accountId: string,
  limit = 200,
  offset = 0,
): Promise<AttachmentWithContext[]> {
  const db = await getDb();
  return db.select<AttachmentWithContext[]>(
    `SELECT a.*, m.from_address, m.from_name, m.date, m.subject, m.thread_id
     FROM attachments a
     JOIN messages m ON a.message_id = m.id AND a.account_id = m.account_id
     WHERE a.account_id = $1 AND a.filename IS NOT NULL AND a.filename != ''
     ORDER BY m.date DESC
     LIMIT $2 OFFSET $3`,
    [accountId, limit, offset],
  );
}

export interface AttachmentSender {
  from_address: string;
  from_name: string | null;
  count: number;
}

export async function getAttachmentSenders(
  accountId: string,
): Promise<AttachmentSender[]> {
  const db = await getDb();
  return db.select<AttachmentSender[]>(
    `SELECT m.from_address, m.from_name, COUNT(*) as count
     FROM attachments a
     JOIN messages m ON a.message_id = m.id AND a.account_id = m.account_id
     WHERE a.account_id = $1 AND a.filename IS NOT NULL AND a.filename != ''
       AND m.from_address IS NOT NULL
     GROUP BY m.from_address
     ORDER BY count DESC`,
    [accountId],
  );
}

export async function getAttachmentsForMessage(
  accountId: string,
  messageId: string,
): Promise<DbAttachment[]> {
  const db = await getDb();
  return db.select<DbAttachment[]>(
    "SELECT * FROM attachments WHERE account_id = $1 AND message_id = $2 ORDER BY filename ASC",
    [accountId, messageId],
  );
}
