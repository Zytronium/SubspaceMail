import { CalDAVProvider } from "./caldavProvider";

const MOCK_ICAL_DATA =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-uid\r\nSUMMARY:Test Event\r\nDTSTART:20240101T100000Z\r\nDTEND:20240101T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";

const MOCK_ICAL_DATA_2 =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-uid-2\r\nSUMMARY:Second Event\r\nDTSTART:20240102T140000Z\r\nDTEND:20240102T150000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

vi.mock("@/services/db/accounts", () => ({
  getAccount: vi.fn().mockResolvedValue({
    id: "acc-1",
    email: "user@example.com",
    caldav_url: "https://caldav.example.com",
    caldav_username: "user@example.com",
    caldav_password: "secret",
  }),
}));

describe("CalDAVProvider", () => {
  let provider: CalDAVProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CalDAVProvider("acc-1");
  });

  describe("listCalendars", () => {
    it("maps backend calendars to CalendarInfo array", async () => {
      mockInvoke.mockResolvedValueOnce([
        { url: "/cal/personal/", display_name: "Personal", color: null },
        { url: "/cal/work/", display_name: "Work", color: "#ff0000" },
      ]);

      const calendars = await provider.listCalendars();

      expect(calendars).toEqual([
        { remoteId: "/cal/personal/", displayName: "Personal", color: null, isPrimary: true },
        { remoteId: "/cal/work/", displayName: "Work", color: "#ff0000", isPrimary: false },
      ]);
    });

    it("handles empty display_name by falling back to indexed name", async () => {
      mockInvoke.mockResolvedValueOnce([
        { url: "/cal/unnamed/", display_name: "", color: null },
        { url: "/cal/also-unnamed/", display_name: null, color: null },
      ]);

      const calendars = await provider.listCalendars();

      expect(calendars[0]!.displayName).toBe("Calendar 1");
      expect(calendars[1]!.displayName).toBe("Calendar 2");
    });
  });

  describe("fetchEvents", () => {
    it("passes time range and parses iCalendar data from events", async () => {
      mockInvoke.mockResolvedValueOnce([
        { url: "/cal/personal/test-uid.ics", etag: "etag-1", ical_data: MOCK_ICAL_DATA },
        { url: "/cal/personal/test-uid-2.ics", etag: "etag-2", ical_data: MOCK_ICAL_DATA_2 },
      ]);

      const events = await provider.fetchEvents("/cal/personal/", "2024-01-01T00:00:00Z", "2024-01-31T23:59:59Z");

      expect(mockInvoke).toHaveBeenCalledWith("caldav_fetch_events", {
        config: expect.objectContaining({ server_url: "https://caldav.example.com" }),
        calendar_url: "/cal/personal/",
        time_start: "2024-01-01T00:00:00Z",
        time_end: "2024-01-31T23:59:59Z",
      });

      expect(events).toHaveLength(2);
      expect(events[0]!.summary).toBe("Test Event");
      expect(events[0]!.uid).toBe("test-uid");
      expect(events[0]!.etag).toBe("etag-1");
      expect(events[0]!.remoteEventId).toBe("/cal/personal/test-uid.ics");
      expect(events[1]!.summary).toBe("Second Event");
      expect(events[1]!.etag).toBe("etag-2");
    });

    it("filters out events with no ical_data", async () => {
      mockInvoke.mockResolvedValueOnce([
        { url: "/cal/personal/test-uid.ics", etag: "etag-1", ical_data: MOCK_ICAL_DATA },
        { url: "/cal/personal/empty.ics", etag: null, ical_data: "" },
      ]);

      const events = await provider.fetchEvents("/cal/personal/", "2024-01-01T00:00:00Z", "2024-01-31T23:59:59Z");

      expect(events).toHaveLength(1);
    });
  });

  describe("createEvent", () => {
    it("generates iCalendar and calls backend create", async () => {
      vi.spyOn(crypto, "randomUUID").mockReturnValue("generated-uuid" as `${string}-${string}-${string}-${string}-${string}`);

      mockInvoke.mockImplementationOnce((cmd: string) => {
        if (cmd === "caldav_create_event") {
          return Promise.resolve({
            url: "/cal/personal/generated-uuid.ics",
            etag: "new-etag",
            ical_data: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:generated-uuid\r\nSUMMARY:New Meeting\r\nDTSTART:20240316T090000Z\r\nDTEND:20240316T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR",
          });
        }
        return Promise.resolve();
      });

      const event = await provider.createEvent("/cal/personal/", {
        summary: "New Meeting",
        startTime: "2024-03-16T09:00:00Z",
        endTime: "2024-03-16T10:00:00Z",
      });

      expect(mockInvoke).toHaveBeenCalledWith("caldav_create_event", {
        config: expect.objectContaining({ server_url: "https://caldav.example.com" }),
        calendar_url: "/cal/personal/",
        ical_data: expect.stringContaining("SUMMARY:New Meeting"),
      });

      expect(event.summary).toBe("New Meeting");
      expect(event.remoteEventId).toBe("/cal/personal/generated-uuid.ics");
    });

    it("handles calendar URL without trailing slash", async () => {
      vi.spyOn(crypto, "randomUUID").mockReturnValue("generated-uuid-2" as `${string}-${string}-${string}-${string}-${string}`);

      mockInvoke.mockImplementationOnce((cmd: string) => {
        if (cmd === "caldav_create_event") {
          return Promise.resolve({
            url: "/cal/personal/generated-uuid-2.ics",
            etag: "new-etag-2",
            ical_data: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:generated-uuid-2\r\nSUMMARY:Another Meeting\r\nDTSTART:20240316T090000Z\r\nDTEND:20240316T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR",
          });
        }
        return Promise.resolve();
      });

      const event = await provider.createEvent("/cal/personal", {
        summary: "Another Meeting",
        startTime: "2024-03-16T09:00:00Z",
        endTime: "2024-03-16T10:00:00Z",
      });

      expect(mockInvoke).toHaveBeenCalledWith("caldav_create_event", {
        config: expect.objectContaining({ server_url: "https://caldav.example.com" }),
        calendar_url: "/cal/personal",
        ical_data: expect.stringContaining("SUMMARY:Another Meeting"),
      });

      expect(event.summary).toBe("Another Meeting");
      expect(event.remoteEventId).toBe("/cal/personal/generated-uuid-2.ics");
    });
  });

  describe("updateEvent", () => {
    it("fetches existing event, merges updates, and calls backend update", async () => {
      // First call: fetch events to find existing
      mockInvoke.mockResolvedValueOnce([
        { url: "/cal/personal/existing.ics", etag: "old-etag", ical_data: MOCK_ICAL_DATA },
      ]);
      // Second call: update event
      mockInvoke.mockResolvedValueOnce(undefined);

      const event = await provider.updateEvent(
        "/cal/personal/",
        "/cal/personal/existing.ics",
        { summary: "Updated Event" },
        "old-etag",
      );

      expect(mockInvoke).toHaveBeenNthCalledWith(2, "caldav_update_event", {
        config: expect.objectContaining({ server_url: "https://caldav.example.com" }),
        event_url: "/cal/personal/existing.ics",
        ical_data: expect.stringContaining("SUMMARY:Updated Event"),
        etag: "old-etag",
      });

      expect(event.summary).toBe("Updated Event");
    });

    it("throws if event not found on server", async () => {
      mockInvoke.mockResolvedValueOnce([]);

      await expect(
        provider.updateEvent("/cal/personal/", "/cal/personal/missing.ics", { summary: "Nope" }),
      ).rejects.toThrow("Event not found on server");
    });
  });

  describe("deleteEvent", () => {
    it("calls backend delete", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      await provider.deleteEvent("/cal/personal/", "/cal/personal/test-uid.ics", "etag-1");

      expect(mockInvoke).toHaveBeenCalledWith("caldav_delete_event", {
        config: expect.objectContaining({ server_url: "https://caldav.example.com" }),
        event_url: "/cal/personal/test-uid.ics",
        etag: "etag-1",
      });
    });
  });

  describe("syncEvents", () => {
    it("fetches events and returns them as created", async () => {
      mockInvoke.mockResolvedValueOnce([
        { url: "/cal/personal/test-uid.ics", etag: "etag-1", ical_data: MOCK_ICAL_DATA },
      ]);

      const result = await provider.syncEvents("/cal/personal/");

      expect(result.created).toHaveLength(1);
      expect(result.created[0]!.summary).toBe("Test Event");
      expect(result.updated).toEqual([]);
      expect(result.deletedRemoteIds).toEqual([]);
    });
  });

  describe("testConnection", () => {
    it("returns success with calendar count", async () => {
      mockInvoke.mockResolvedValueOnce(3);

      const result = await provider.testConnection();

      expect(result).toEqual({
        success: true,
        message: "Connected — found 3 calendars",
      });
    });

    it("returns failure on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Authentication failed"));

      const result = await provider.testConnection();

      expect(result).toEqual({
        success: false,
        message: "Authentication failed",
      });
    });

    it("handles non-Error rejection", async () => {
      mockInvoke.mockRejectedValueOnce("some string error");

      const result = await provider.testConnection();

      expect(result).toEqual({
        success: false,
        message: "Connection failed",
      });
    });
  });

  describe("IMAP fallback", () => {
    it("uses IMAP credentials when CalDAV is not configured", async () => {
      const { getAccount } = await import("@/services/db/accounts");

      // Override the mock for this test
      (getAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: "acc-2",
        email: "user@example.com",
        caldav_url: null,
        caldav_username: null,
        caldav_password: null,
        imap_host: "mail.example.com",
        imap_port: 993,
        imap_security: "tls",
        imap_username: "user@example.com",
        imap_password: "imap-secret",
      });

      const fallbackProvider = new CalDAVProvider("acc-2");

      mockInvoke.mockResolvedValueOnce([
        { url: "/cal/personal/", display_name: "Personal", color: null },
      ]);

      const calendars = await fallbackProvider.listCalendars();

      expect(calendars).toHaveLength(1);
      expect(mockInvoke).toHaveBeenCalledWith("caldav_list_calendars", {
        config: expect.objectContaining({
          server_url: "https://mail.example.com",
          username: "user@example.com",
          password: "imap-secret",
        }),
      });
    });
  });
});
