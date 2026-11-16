import { useState, useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { getContactByEmail, updateContactAvatar } from "@/services/db/contacts";
import { fetchAvatarUrl, isValidAvatarUrl } from "@/services/contacts/gravatar";

/**
 * Module-level cache to avoid redundant fetches across components.
 * Maps normalized email -> avatar URL (or null if explicitly not found).
 */
const avatarCache = new Map<string, string | null>();

/**
 * Hook that returns the avatar URL for a given email address.
 * Respects the loadAvatars setting — returns null immediately when disabled.
 * Priority: cached avatar > Gravatar.
 * All domain logo sources removed to prevent favicons.
 */
export function useAvatar(email: string | null): string | null {
  const loadAvatars = useUIStore((s) => s.loadAvatars);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!email || !loadAvatars) {
      setAvatarUrl(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      // Check module cache first (skip invalid cached URLs)
      const cached = avatarCache.get(email.toLowerCase());
      if (cached && isValidAvatarUrl(cached)) {
        if (!cancelled) setAvatarUrl(cached);
        return;
      }
      // Clear invalid module cache entries (favicon URLs, etc.)
      if (cached !== undefined) {
        avatarCache.delete(email.toLowerCase());
      }

      // Check DB contact
      const contact = await getContactByEmail(email);
      if (contact?.avatar_url) {
        // Skip cached invalid URLs (favicons, etc.) — they are no longer a valid source
        if (!isValidAvatarUrl(contact.avatar_url)) {
          await updateContactAvatar(email, null);
        } else {
          avatarCache.set(email.toLowerCase(), contact.avatar_url);
          if (!cancelled) setAvatarUrl(contact.avatar_url);
          return;
        }
      }

      // Fetch avatar (Gravatar only)
      const url = await fetchAvatarUrl(email);
      avatarCache.set(email.toLowerCase(), url);
      if (!cancelled) setAvatarUrl(url);
    };

    load().catch(() => {
      // Silently ignore network errors
    });

    return () => {
      cancelled = true;
    };
  }, [email, loadAvatars]);

  return avatarUrl;
}
