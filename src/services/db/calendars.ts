import { getDb, selectFirstBy } from "./connection";

export interface DbCalendar {
  id: string;
  account_id: string;
  provider: string;
  remote_id: string;
  display_name: string | null;
  color: string | null;
  is_primary: number;
  is_visible: number;
  sync_token: string | null;
  ctag: string | null;
  created_at: number;
  updated_at: number;
}

export async function upsertCalendar(calendar: {
  accountId: string;
  provider: string;
  remoteId: string;
  displayName: string | null;
  color: string | null;
  isPrimary: boolean;
}): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO calendars (id, account_id, provider, remote_id, display_name, color, is_primary, is_visible)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(account_id, remote_id) DO UPDATE SET
       display_name = $5, color = $6, is_primary = $7, updated_at = unixepoch()`,
    [id, calendar.accountId, calendar.provider, calendar.remoteId, calendar.displayName, calendar.color, calendar.isPrimary ? 1 : 0, 1],
  );
  // Return the actual ID (could be existing row on conflict)
  const existing = await selectFirstBy<{ id: string }>(
    "SELECT id FROM calendars WHERE account_id = $1 AND remote_id = $2",
    [calendar.accountId, calendar.remoteId],
  );
  return existing?.id ?? id;
}

export async function getCalendarsForAccount(accountId: string): Promise<DbCalendar[]> {
  const db = await getDb();
  return db.select<DbCalendar[]>(
    "SELECT * FROM calendars WHERE account_id = $1 ORDER BY is_primary DESC, display_name ASC",
    [accountId],
  );
}

export async function getVisibleCalendars(accountId: string): Promise<DbCalendar[]> {
  const db = await getDb();
  return db.select<DbCalendar[]>(
    "SELECT * FROM calendars WHERE account_id = $1 AND is_visible = 1 ORDER BY is_primary DESC, display_name ASC",
    [accountId],
  );
}

export async function setCalendarVisibility(calendarId: string, visible: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE calendars SET is_visible = $1, updated_at = unixepoch() WHERE id = $2",
    [visible ? 1 : 0, calendarId],
  );
}

export async function updateCalendarSyncToken(
  calendarId: string,
  syncToken: string | null,
  ctag?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE calendars SET sync_token = $1, ctag = $2, updated_at = unixepoch() WHERE id = $3",
    [syncToken, ctag ?? null, calendarId],
  );
}

export async function deleteCalendarsForAccount(accountId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM calendars WHERE account_id = $1", [accountId]);
}

export async function getCalendarById(calendarId: string): Promise<DbCalendar | null> {
  return selectFirstBy<DbCalendar>(
    "SELECT * FROM calendars WHERE id = $1",
    [calendarId],
  );
}

/**
 * Extract the host and path from a URL for comparison.
 * Normalizes by stripping trailing slashes, lowercasing, and removing the scheme.
 * e.g., "https://mail.example.com/dav/cal/user/" -> "mail.example.com/dav/cal/user"
 */
export function normalizeCalendarUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "").toLowerCase();
  // Remove scheme (https:// or http://)
  const withoutScheme = trimmed.replace(/^https?:\/\//, "");
  return withoutScheme;
}

/**
 * Detect duplicate calendars (same normalized URL) for an account and remove the duplicates.
 * Keeps the calendar with the earliest created_at (or primary) and deletes the rest.
 * Also removes associated events for deleted calendars.
 * Returns the number of calendars that were deleted.
 */
export async function deduplicateCalendars(accountId: string): Promise<number> {
  const allCals = await getCalendarsForAccount(accountId);
  if (allCals.length <= 1) return 0;

  // Group by normalized URL
  const groups = new Map<string, DbCalendar[]>();
  for (const cal of allCals) {
    const normalized = normalizeCalendarUrl(cal.remote_id);
    const group = groups.get(normalized) ?? [];
    group.push(cal);
    groups.set(normalized, group);
  }

  let deletedCount = 0;
  const db = await getDb();
  for (const [, group] of groups) {
    if (group.length <= 1) continue;

    // Sort: primary first, then by created_at ascending (keep the oldest/primary one)
    group.sort((a, b) => {
      if (a.is_primary !== b.is_primary) return b.is_primary - a.is_primary;
      return a.created_at - b.created_at;
    });

    // Keep the first one, delete the rest (along with their events)
    const duplicates = group.slice(1);
    for (const dup of duplicates) {
      await db.execute("DELETE FROM calendar_events WHERE calendar_id = $1", [dup.id]);
      await db.execute("DELETE FROM calendars WHERE id = $1", [dup.id]);
      deletedCount++;
    }
  }

  return deletedCount;
}
