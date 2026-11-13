import { invoke } from "@tauri-apps/api/core";
import type {
  CalendarProvider,
  CalendarProviderType,
  CalendarInfo,
  CalendarEventData,
  CalendarSyncResult,
  CreateEventInput,
  UpdateEventInput,
} from "./types";
import { generateVEvent, parseVEvent } from "./icalHelper";
import { getAccount } from "@/services/db/accounts";

interface CalDavBackendCalendar {
  url: string;
  display_name: string;
  color: string | null;
}

interface CalDavBackendEvent {
  url: string;
  etag: string | null;
  ical_data: string;
}

export class CalDAVProvider implements CalendarProvider {
  readonly type: CalendarProviderType = "caldav";

  constructor(readonly accountId: string) {}

  private async getConfig() {
    const account = await getAccount(this.accountId);
    if (!account) throw new Error("Account not found");

    let serverUrl = account.caldav_url;
    let username = account.caldav_username ?? account.email;
    let password = account.caldav_password;

    // Fall back to IMAP credentials if CalDAV-specific settings are not configured
    if (!serverUrl || !password) {
      if (account.imap_host && account.imap_port !== null && account.imap_password) {
        if (!serverUrl) {
          const security = account.imap_security;
          const protocol = security === "starttls" ? "http" : "https";
          serverUrl = `${protocol}://${account.imap_host}`;
        }
        if (!password) {
          password = account.imap_password;
        }
        if (!username) {
          username = account.imap_username ?? account.email;
        }
      }
    }

    if (!serverUrl || !password) {
      throw new Error("CalDAV credentials not configured");
    }

    return { server_url: serverUrl, username, password };
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const config = await this.getConfig();
    let calendars: CalDavBackendCalendar[];
    try {
      calendars = await invoke("caldav_list_calendars", { config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch calendars: ${msg}`);
    }

    return calendars.map((cal, index) => ({
      remoteId: cal.url,
      displayName: cal.display_name || `Calendar ${index + 1}`,
      color: cal.color ?? null,
      isPrimary: index === 0,
    }));
  }

  async fetchEvents(calendarRemoteId: string, timeMin: string, timeMax: string): Promise<CalendarEventData[]> {
    const config = await this.getConfig();
    let events: CalDavBackendEvent[];
    try {
      events = await invoke("caldav_fetch_events", {
        config,
        calendar_url: calendarRemoteId,
        time_start: timeMin,
        time_end: timeMax,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch events: ${msg}`);
    }

    return events
      .filter((ev) => ev.ical_data)
      .map((ev) => {
        const event = parseVEvent(ev.ical_data, ev.url);
        event.etag = ev.etag ?? null;
        return event;
      });
  }

  async createEvent(calendarRemoteId: string, event: CreateEventInput): Promise<CalendarEventData> {
    const config = await this.getConfig();
    const uid = crypto.randomUUID();
    const icalData = generateVEvent(event, uid);

    let backendEvent: CalDavBackendEvent;
    try {
      backendEvent = await invoke("caldav_create_event", {
        config,
        calendar_url: calendarRemoteId,
        ical_data: icalData,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create event: ${msg}`);
    }

    const parsed = parseVEvent(backendEvent.ical_data, backendEvent.url);
    parsed.etag = backendEvent.etag ?? null;
    return parsed;
  }

  async updateEvent(
    calendarRemoteId: string,
    remoteEventId: string,
    event: UpdateEventInput,
    etag?: string,
  ): Promise<CalendarEventData> {
    const config = await this.getConfig();

    // Fetch the existing event to get current data
    let existingEvents: CalDavBackendEvent[];
    try {
      // We need to fetch the event by URL - use a narrow time range query
      // or fetch it directly. For now, we'll generate the ical from the input.
      existingEvents = await invoke("caldav_fetch_events", {
        config,
        calendar_url: calendarRemoteId,
        time_start: new Date(0).toISOString(),
        time_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch event for update: ${msg}`);
    }

    const existing = existingEvents.find((ev) => ev.url === remoteEventId);
    if (!existing) throw new Error("Event not found on server");

    const parsed = parseVEvent(existing.ical_data, remoteEventId);
    const merged: CreateEventInput = {
      summary: event.summary ?? parsed.summary ?? "",
      description: event.description ?? parsed.description ?? undefined,
      location: event.location ?? parsed.location ?? undefined,
      startTime: event.startTime ?? new Date(parsed.startTime * 1000).toISOString(),
      endTime: event.endTime ?? new Date(parsed.endTime * 1000).toISOString(),
      isAllDay: event.isAllDay ?? parsed.isAllDay,
    };

    const icalData = generateVEvent(merged, parsed.uid ?? undefined);

    try {
      await invoke("caldav_update_event", {
        config,
        event_url: remoteEventId,
        ical_data: icalData,
        etag: etag ?? existing.etag ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to update event: ${msg}`);
    }

    const result = parseVEvent(icalData, remoteEventId);
    return result;
  }

  async deleteEvent(_calendarRemoteId: string, remoteEventId: string, etag?: string): Promise<void> {
    const config = await this.getConfig();

    try {
      await invoke("caldav_delete_event", {
        config,
        event_url: remoteEventId,
        etag: etag ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to delete event: ${msg}`);
    }
  }

  async syncEvents(calendarRemoteId: string, _syncToken?: string): Promise<CalendarSyncResult> {
    const config = await this.getConfig();
    const created: CalendarEventData[] = [];

    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - 90);
    const timeMax = new Date(now);
    timeMax.setFullYear(timeMax.getFullYear() + 1);

    let events: CalDavBackendEvent[];
    try {
      events = await invoke("caldav_fetch_events", {
        config,
        calendar_url: calendarRemoteId,
        time_start: timeMin.toISOString(),
        time_end: timeMax.toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to sync events: ${msg}`);
    }

    for (const ev of events) {
      if (ev.ical_data) {
        const event = parseVEvent(ev.ical_data, ev.url);
        event.etag = ev.etag ?? null;
        created.push(event);
      }
    }

    return { created, updated: [], deletedRemoteIds: [], newSyncToken: null, newCtag: null };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const config = await this.getConfig();
      const count: number = await invoke("caldav_test_connection", { config });
      return {
        success: true,
        message: `Connected — found ${count} calendar${count !== 1 ? "s" : ""}`,
      };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Connection failed" };
    }
  }
}
