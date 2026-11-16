import { getContactByEmail, updateContactAvatar } from "@/services/db/contacts";
import { normalizeEmail } from "@/utils/emailUtils";

/**
 * Company logo lookup for email domains.
 *
 * Priority:
 * 1. BIMI DNS record — industry standard; companies publish their logo URL in DNS
 * 2. Hunter.io Logo API — free, no API key, returns actual company logos (PNG/WEBP/AVIF)
 */

/**
 * Extract the domain from an email address.
 */
function extractDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  const atIdx = normalized.indexOf("@");
  if (atIdx === -1) return null;
  return normalized.slice(atIdx + 1);
}

/**
 * Public email providers — we skip logo lookup for these because they don't
 * represent a specific organization.
 */
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com",
  "live.com", "yahoo.com", "yahoo.co.uk", "aol.com", "icloud.com",
  "me.com", "mac.com", "protonmail.com", "proton.me", "mail.com",
  "zoho.com", "yandex.com", "gmx.com", "gmx.net",
]);

/**
 * BIMI (Brand Indicators for Message Identification) logo lookup.
 *
 * Companies publish their logo URL in a DNS TXT record at
 * `default._bimi.{domain}`. This is the industry standard used by Gmail,
 * Apple Mail, Outlook, and other email clients to display company logos.
 *
 * The TXT record format is: `v=BIMI1; l=https://example.com/logo.svg; a=...`
 * We extract the `l=` (logo) value as the logo URL.
 *
 * We query DNS over HTTPS via Cloudflare's public resolver (no API key needed).
 */
async function fetchBimiLogo(domain: string): Promise<string | null> {
  try {
    const bimiName = `default._bimi.${domain}`;
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(bimiName)}&type=TXT`,
      {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(3000),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const txtRecords = data?.Answer?.filter(
      (r: any) => r.type === 16
    ) as Array<{ data: string }> | undefined;

    if (!txtRecords || txtRecords.length === 0) return null;

    // Look for a BIMI record containing the logo URL
    for (const record of txtRecords) {
      const txt = record.data;
      // BIMI format: "v=BIMI1; l=https://...; a=..."
      const logoMatch = txt.match(/l=(https?:\/\/[^\s;]+)/i);
      if (logoMatch && logoMatch[1]) {
        return logoMatch[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Build a Hunter.io logo API URL for a domain.
 * Hunter.io returns actual company logos (PNG/WEBP/AVIF) — free, no API key.
 * Drop-in replacement for the defunct Clearbit Logo API.
 */
function getHunterLogoUrl(domain: string): string {
  return `https://logos.hunter.io/${encodeURIComponent(domain)}`;
}

/**
 * Check if a logo URL actually returns an image (not a 404).
 */
async function logoExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch only the BIMI DNS logo for a domain (without caching or Hunter fallback).
 * Used by the avatar priority chain: Cached > BIMI > Gravatar > Hunter.io.
 */
export async function fetchBimiLogoOnly(email: string): Promise<string | null> {
  const domain = extractDomain(email);
  if (!domain) return null;
  if (PUBLIC_DOMAINS.has(domain)) return null;

  const bimiUrl = await fetchBimiLogo(domain);
  if (bimiUrl) {
    await updateContactAvatar(email, bimiUrl);
    return bimiUrl;
  }
  return null;
}

/**
 * Fetch only the Hunter.io logo for a domain (without BIMI check).
 * Used as the lowest-priority fallback in the avatar chain.
 */
export async function fetchHunterLogoOnly(email: string): Promise<string | null> {
  const domain = extractDomain(email);
  if (!domain) return null;
  if (PUBLIC_DOMAINS.has(domain)) return null;

  const hunterUrl = getHunterLogoUrl(domain);
  if (await logoExists(hunterUrl)) {
    await updateContactAvatar(email, hunterUrl);
    return hunterUrl;
  }
  return null;
}

/**
 * Fetch and cache a domain logo for the given email address.
 * Returns the logo URL if found, null otherwise.
 * Priority: BIMI DNS record > Hunter.io.
 */
export async function fetchAndCacheDomainLogo(email: string): Promise<string | null> {
  const domain = extractDomain(email);
  if (!domain) return null;

  // Skip public email providers
  if (PUBLIC_DOMAINS.has(domain)) return null;

  // Check if we already have a cached avatar from a domain logo
  const contact = await getContactByEmail(email);
  if (contact?.avatar_url) {
    const url = contact.avatar_url;
    if (url.includes("logos.hunter.io") || url.includes(".svg")) {
      return url;
    }
  }

  // 1. Try BIMI DNS record — industry standard for email logos
  const bimiUrl = await fetchBimiLogo(domain);
  if (bimiUrl) {
    await updateContactAvatar(email, bimiUrl);
    return bimiUrl;
  }

  // 2. Try Hunter.io — returns actual company logos
  const hunterUrl = getHunterLogoUrl(domain);
  if (await logoExists(hunterUrl)) {
    await updateContactAvatar(email, hunterUrl);
    return hunterUrl;
  }

  return null;
}

/**
 * Get the domain logo URL for an email without caching.
 * Returns Hunter.io URL (BIMI requires async DNS lookup).
 */
export function getDomainLogoUrl(email: string): string | null {
  const domain = extractDomain(email);
  if (domain && !PUBLIC_DOMAINS.has(domain)) {
    return getHunterLogoUrl(domain);
  }
  return null;
}
