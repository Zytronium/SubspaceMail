import type { CalendarProvider } from "./types";
import { GoogleCalendarProvider } from "./googleCalendarProvider";
import { CalDAVProvider } from "./caldavProvider";
import { getAccount } from "@/services/db/accounts";

const providerCache = new Map<string, CalendarProvider>();

/**
 * Get a CalendarProvider for the given account.
 * Routes based on `account.calendar_provider` or `account.provider` for standalone CalDAV accounts.
 */
export async function getCalendarProvider(accountId: string): Promise<CalendarProvider> {
  const cached = providerCache.get(accountId);
  if (cached) return cached;

  const account = await getAccount(accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);

  let provider: CalendarProvider;

  // Standalone CalDAV account
  if (account.provider === "caldav") {
    provider = new CalDAVProvider(accountId);
  }
  // IMAP account with CalDAV configured, or IMAP account that can fall back to IMAP credentials
  else if (account.calendar_provider === "caldav" || (account.caldav_url && account.caldav_password)) {
    provider = new CalDAVProvider(accountId);
  }
  // IMAP account without explicit CalDAV config — try to use IMAP credentials as fallback
  else if (account.imap_host && account.imap_password) {
    provider = new CalDAVProvider(accountId);
  }
  // Gmail API account
  else if (account.provider === "gmail_api" || account.calendar_provider === "google_api") {
    provider = new GoogleCalendarProvider(accountId);
  }
  // Default for Gmail accounts
  else if (account.provider === "gmail_api") {
    provider = new GoogleCalendarProvider(accountId);
  } else {
    throw new Error(`No calendar provider configured for account ${accountId}`);
  }

  providerCache.set(accountId, provider);
  return provider;
}

/**
 * Check if an account has calendar support configured.
 */
export async function hasCalendarSupport(accountId: string): Promise<boolean> {
  const account = await getAccount(accountId);
  if (!account) return false;

  if (account.provider === "caldav") return true;
  if (account.provider === "gmail_api") return true;
  if (account.calendar_provider === "caldav") return true;
  // IMAP account with credentials can use CalDAV fallback
  if (account.imap_host && account.imap_password) return true;
  return false;
}

export function removeCalendarProvider(accountId: string): void {
  providerCache.delete(accountId);
}

export function clearAllCalendarProviders(): void {
  providerCache.clear();
}
