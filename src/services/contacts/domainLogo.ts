import { getContactByEmail, updateContactAvatar } from "@/services/db/contacts";
import { normalizeEmail } from "@/utils/emailUtils";

/**
 * Company logo lookup for email domains.
 *
 * Priority:
 * 1. BIMI DNS record — industry standard; companies publish their logo URL in DNS
 * 2. Hunter.io Logo API — free, no API key, returns actual company logos (PNG/WEBP/AVIF)
 * 3. Google Favicon API — fallback for domains not in Hunter's database
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
 * Build a Google Favicon API URL for a domain (fallback).
 * Returns browser favicons, not actual company logos — used only as last resort.
 */
function getGoogleLogoUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
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
 * Fetch and cache a domain logo for the given email address.
 * Returns the logo URL if found, null otherwise.
 * Priority: BIMI DNS record > Hunter.io > Google Favicons.
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
    if (url.includes("logos.hunter.io") || url.includes("google.com/s2/favicons") || url.includes(".svg")) {
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

  // 3. Fall back to Google Favicons for domains not in Hunter's database
  const googleUrl = getGoogleLogoUrl(domain);
  if (await logoExists(googleUrl)) {
    await updateContactAvatar(email, googleUrl);
    return googleUrl;
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
