import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

const { mockGetAccount } = vi.hoisted(() => ({
  mockGetAccount: vi.fn(),
}));

// Mock the DB connection
vi.mock("@/services/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/connection")>();
  return {
    ...actual,
    getDb: mockGetDb,
    selectFirstBy: async (query: string, params: unknown[] = []) => {
      const db = await mockGetDb();
      const rows = await db.select(query, params);
      return rows[0] ?? null;
    },
  };
});

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

// Mock accounts DB
vi.mock("@/services/db/accounts", () => ({
  getAccount: mockGetAccount,
  updateAccountCalDav: vi.fn().mockResolvedValue(undefined),
}));

// Mock crypto for calendar UUID generation
vi.mock("@/services/db/calendars", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/calendars")>();
  return {
    ...actual,
  };
});

import { getDb } from "@/services/db/connection";
import { createMockDb } from "@/test/mocks";
import { CalDAVProvider } from "./caldavProvider";
import { getCalendarProvider, hasCalendarSupport, removeCalendarProvider, clearAllCalendarProviders } from "./providerFactory";

const MOCK_ICAL_DATA =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-uid\r\nSUMMARY:Test Event\r\nDTSTART:20240101T100000Z\r\nDTEND:20240101T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";

const mockDb = createMockDb();

describe("Calendar integration - IMAP to CalDAV flow", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    clearAllCalendarProviders();
    vi.stubGlobal("crypto", {
      randomUUID: () => "test-uuid-1234" as `${string}-${string}-${string}-${string}-${string}`,
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("hasCalendarSupport", () => {
    it("returns true for IMAP account with imap_host and imap_password", async () => {
      mockGetAccount.mockResolvedValueOnce({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_security: "tls",
        imap_password: "secret",
        imap_username: "user@example.com",
        caldav_url: null,
        caldav_password: null,
        calendar_provider: null,
      });

      const supported = await hasCalendarSupport("acc-1");
      expect(supported).toBe(true);
    });

    it("returns true for IMAP account with explicit CalDAV config", async () => {
      mockGetAccount.mockResolvedValueOnce({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "imap.example.com",
        imap_port: 993,
        imap_password: "secret",
        caldav_url: "https://caldav.example.com",
        caldav_password: "caldav-secret",
        calendar_provider: "caldav",
      });

      const supported = await hasCalendarSupport("acc-1");
      expect(supported).toBe(true);
    });

    it("returns true for standalone CalDAV account", async () => {
      mockGetAccount.mockResolvedValueOnce({
        id: "acc-1",
        email: "user@example.com",
        provider: "caldav",
        caldav_url: "https://caldav.example.com",
        caldav_password: "secret",
      });

      const supported = await hasCalendarSupport("acc-1");
      expect(supported).toBe(true);
    });

    it("returns true for Gmail API account", async () => {
      mockGetAccount.mockResolvedValueOnce({
        id: "acc-1",
        email: "user@gmail.com",
        provider: "gmail_api",
      });

      const supported = await hasCalendarSupport("acc-1");
      expect(supported).toBe(true);
    });

    it("returns false for IMAP account without password", async () => {
      mockGetAccount.mockResolvedValueOnce({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "imap.example.com",
        imap_port: 993,
        imap_password: null,
        caldav_url: null,
        caldav_password: null,
        calendar_provider: null,
      });

      const supported = await hasCalendarSupport("acc-1");
      expect(supported).toBe(false);
    });
  });

  describe("getCalendarProvider", () => {
    it("creates CalDAV provider for IMAP account with credentials", async () => {
      mockGetAccount.mockResolvedValueOnce({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_security: "tls",
        imap_password: "secret",
        imap_username: "user@example.com",
        caldav_url: null,
        caldav_password: null,
        calendar_provider: null,
      });

      const provider = await getCalendarProvider("acc-1");
      expect(provider.type).toBe("caldav");
    });

    it("creates CalDAV provider for IMAP account with explicit CalDAV config", async () => {
      mockGetAccount.mockResolvedValueOnce({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "imap.example.com",
        imap_password: "secret",
        caldav_url: "https://caldav.example.com",
        caldav_password: "caldav-secret",
        calendar_provider: "caldav",
      });

      const provider = await getCalendarProvider("acc-1");
      expect(provider.type).toBe("caldav");
    });

    it("creates Google provider for Gmail API account", async () => {
      mockGetAccount.mockResolvedValueOnce({
        id: "acc-1",
        email: "user@gmail.com",
        provider: "gmail_api",
      });

      const provider = await getCalendarProvider("acc-1");
      expect(provider.type).toBe("google_api");
    });
  });

  describe("CalDAVProvider with IMAP fallback", () => {
    it("listCalendars uses IMAP credentials when CalDAV not configured", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_security: "tls",
        imap_password: "imap-secret",
        imap_username: "user@example.com",
        caldav_url: null,
        caldav_password: null,
        calendar_provider: null,
      });

      mockInvoke.mockResolvedValueOnce([
        { url: "https://mail.example.com/dav/cal/user/calendar/", display_name: "My Calendar", color: null },
      ]);

      const provider = new CalDAVProvider("acc-1");
      const calendars = await provider.listCalendars();

      expect(calendars).toHaveLength(1);
      expect(calendars[0]!.displayName).toBe("My Calendar");
      expect(mockInvoke).toHaveBeenCalledWith("caldav_list_calendars", {
        config: {
          server_url: "https://mail.example.com",
          username: "user@example.com",
          password: "imap-secret",
        },
      });
    });

    it("listCalendars uses explicit CalDAV config when available", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_password: "imap-secret",
        caldav_url: "https://caldav.example.com/dav",
        caldav_username: "user@example.com",
        caldav_password: "caldav-secret",
        calendar_provider: "caldav",
      });

      mockInvoke.mockResolvedValueOnce([
        { url: "https://caldav.example.com/dav/calendar/", display_name: "Work", color: "#ff0000" },
      ]);

      const provider = new CalDAVProvider("acc-1");
      const calendars = await provider.listCalendars();

      expect(calendars).toHaveLength(1);
      expect(mockInvoke).toHaveBeenCalledWith("caldav_list_calendars", {
        config: {
          server_url: "https://caldav.example.com/dav",
          username: "user@example.com",
          password: "caldav-secret",
        },
      });
    });

    it("fetchEvents passes correct params with IMAP fallback", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_security: "tls",
        imap_password: "imap-secret",
        imap_username: "user@example.com",
        caldav_url: null,
        caldav_password: null,
      });

      mockInvoke.mockResolvedValueOnce([
        { url: "https://mail.example.com/dav/cal/user/calendar/event.ics", etag: "etag-1", ical_data: MOCK_ICAL_DATA },
      ]);

      const provider = new CalDAVProvider("acc-1");
      const events = await provider.fetchEvents(
        "https://mail.example.com/dav/cal/user/calendar/",
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.summary).toBe("Test Event");
      expect(mockInvoke).toHaveBeenCalledWith("caldav_fetch_events", {
        config: {
          server_url: "https://mail.example.com",
          username: "user@example.com",
          password: "imap-secret",
        },
        calendar_url: "https://mail.example.com/dav/cal/user/calendar/",
        time_start: "2024-01-01T00:00:00Z",
        time_end: "2024-01-31T23:59:59Z",
      });
    });

    it("throws when no IMAP or CalDAV credentials available", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: null,
        imap_port: null,
        imap_password: null,
        caldav_url: null,
        caldav_password: null,
      });

      const provider = new CalDAVProvider("acc-1");
      await expect(provider.listCalendars()).rejects.toThrow("CalDAV credentials not configured");
    });
  });

  describe("Full calendar loading flow", () => {
    it("successfully loads calendars and events for IMAP account", async () => {
      // Setup: IMAP account with no explicit CalDAV config
      const account = {
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_security: "tls",
        imap_password: "imap-secret",
        imap_username: "user@example.com",
        caldav_url: null,
        caldav_password: null,
        calendar_provider: null,
      };
      mockGetAccount.mockResolvedValue(account);

      // Mock DB for calendar operations
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      // Step 1: hasCalendarSupport returns true
      const supported = await hasCalendarSupport("acc-1");
      expect(supported).toBe(true);

      // Step 2: getCalendarProvider returns CalDAV provider
      const provider = await getCalendarProvider("acc-1");
      expect(provider.type).toBe("caldav");

      // Step 3: listCalendars returns calendars from backend
      mockInvoke.mockResolvedValueOnce([
        { url: "https://mail.example.com/dav/cal/user/calendar/", display_name: "My Calendar", color: null },
      ]);

      const calendars = await provider.listCalendars();
      expect(calendars).toHaveLength(1);
      expect(calendars[0]!.displayName).toBe("My Calendar");

      // Step 4: fetchEvents returns events
      mockInvoke.mockResolvedValueOnce([
        { url: "https://mail.example.com/dav/cal/user/calendar/event.ics", etag: "etag-1", ical_data: MOCK_ICAL_DATA },
      ]);

      const events = await provider.fetchEvents(
        calendars[0]!.remoteId,
        "2024-01-01T00:00:00Z",
        "2024-12-31T23:59:59Z",
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.summary).toBe("Test Event");
    });

    it("handles empty calendar list from backend", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_password: "imap-secret",
        caldav_url: null,
        caldav_password: null,
      });

      mockInvoke.mockResolvedValueOnce([]);

      const provider = new CalDAVProvider("acc-1");
      const calendars = await provider.listCalendars();
      expect(calendars).toEqual([]);
    });

    it("handles backend error gracefully", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_password: "imap-secret",
        caldav_url: null,
        caldav_password: null,
      });

      mockInvoke.mockRejectedValueOnce(new Error("Failed to fetch calendars: HTTP 401"));

      const provider = new CalDAVProvider("acc-1");
      await expect(provider.listCalendars()).rejects.toThrow("Failed to fetch calendars: Failed to fetch calendars: HTTP 401");
    });

    it("provider cache works correctly", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "imap.example.com",
        imap_password: "secret",
      });

      const provider1 = await getCalendarProvider("acc-1");
      const provider2 = await getCalendarProvider("acc-1");
      expect(provider1).toBe(provider2); // Same instance from cache

      removeCalendarProvider("acc-1");
      const provider3 = await getCalendarProvider("acc-1");
      expect(provider3).not.toBe(provider1); // New instance after cache clear
    });

    it("testConnection returns calendar count", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_password: "imap-secret",
        caldav_url: null,
        caldav_password: null,
      });

      mockInvoke.mockResolvedValueOnce(2);

      const provider = new CalDAVProvider("acc-1");
      const result = await provider.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain("2 calendars");
    });
  });

  describe("CalDAV provider with starttls IMAP security", () => {
    it("uses http protocol for starttls IMAP security", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_security: "starttls",
        imap_password: "secret",
        caldav_url: null,
        caldav_password: null,
      });

      mockInvoke.mockResolvedValueOnce([]);

      const provider = new CalDAVProvider("acc-1");
      await provider.listCalendars();

      expect(mockInvoke).toHaveBeenCalledWith("caldav_list_calendars", {
        config: expect.objectContaining({
          server_url: "http://mail.example.com",
        }),
      });
    });

    it("uses https protocol for tls IMAP security", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_security: "tls",
        imap_password: "secret",
        caldav_url: null,
        caldav_password: null,
      });

      mockInvoke.mockResolvedValueOnce([]);

      const provider = new CalDAVProvider("acc-1");
      await provider.listCalendars();

      expect(mockInvoke).toHaveBeenCalledWith("caldav_list_calendars", {
        config: expect.objectContaining({
          server_url: "https://mail.example.com",
        }),
      });
    });
  });

  describe("No calendars found scenario", () => {
    it("throws clear error when backend returns empty calendar list", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_password: "imap-secret",
        caldav_url: null,
        caldav_password: null,
      });

      mockInvoke.mockResolvedValueOnce([]);

      const provider = new CalDAVProvider("acc-1");
      const calendars = await provider.listCalendars();

      // Provider returns empty array — the error is thrown by CalendarPage
      // when it detects no calendars from server and no local calendars
      expect(calendars).toEqual([]);
    });

    it("throws when backend connection fails", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_password: "imap-secret",
        caldav_url: null,
        caldav_password: null,
      });

      mockInvoke.mockRejectedValueOnce(new Error("Connection refused"));

      const provider = new CalDAVProvider("acc-1");
      await expect(provider.listCalendars()).rejects.toThrow("Failed to fetch calendars: Connection refused");
    });

    it("throws when backend returns HTTP 401", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_password: "wrong-password",
        caldav_url: null,
        caldav_password: null,
      });

      mockInvoke.mockRejectedValueOnce(new Error("CalDAV authentication failed (HTTP 401)"));

      const provider = new CalDAVProvider("acc-1");
      await expect(provider.listCalendars()).rejects.toThrow("Failed to fetch calendars: CalDAV authentication failed (HTTP 401)");
    });

    it("throws when backend returns HTTP 404 for calendar home set", async () => {
      mockGetAccount.mockResolvedValue({
        id: "acc-1",
        email: "user@example.com",
        provider: "imap",
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_password: "imap-secret",
        caldav_url: null,
        caldav_password: null,
      });

      mockInvoke.mockRejectedValueOnce(new Error("Failed to fetch calendar home set: HTTP 404 Not Found"));

      const provider = new CalDAVProvider("acc-1");
      await expect(provider.listCalendars()).rejects.toThrow("Failed to fetch calendars: Failed to fetch calendar home set: HTTP 404 Not Found");
    });

    it("auto-discovery returns null for unknown domain without .well-known", async () => {
      const { discoverCalDavSettings } = await import("./autoDiscovery");

      // Simulate network failure for .well-known discovery
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await discoverCalDavSettings("user@example.com");
      expect(result.caldavUrl).toBeNull();
    });

    it("auto-discovery returns URL for .well-known redirect", async () => {
      const { discoverCalDavSettings } = await import("./autoDiscovery");

      // Simulate .well-known/caldav returning a 301 redirect
      mockFetch.mockResolvedValue({
        status: 301,
        ok: false,
        headers: new Headers({
          Location: "https://mail.example.com/dav/cal/",
        }),
      });

      const result = await discoverCalDavSettings("user@example.com");
      expect(result.caldavUrl).toBe("https://mail.example.com/dav/cal/");
    });

    it("auto-discovery handles 307 redirect", async () => {
      const { discoverCalDavSettings } = await import("./autoDiscovery");

      // Stalwart returns 307 Temporary Redirect
      mockFetch.mockResolvedValue({
        status: 307,
        ok: false,
        headers: new Headers({
          Location: "/dav/cal",
        }),
      });

      const result = await discoverCalDavSettings("user@example.com");
      expect(result.caldavUrl).toBe("https://example.com/dav/cal");
    });

    it("auto-discovery handles relative Location header", async () => {
      const { discoverCalDavSettings } = await import("./autoDiscovery");

      mockFetch.mockResolvedValue({
        status: 301,
        ok: false,
        headers: new Headers({
          Location: "/dav/cal/",
        }),
      });

      const result = await discoverCalDavSettings("user@example.com");
      expect(result.caldavUrl).toBe("https://example.com/dav/cal/");
    });
  });
});
