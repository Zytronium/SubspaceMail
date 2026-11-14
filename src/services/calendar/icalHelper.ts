import type { CalendarEventData, CreateEventInput, UpdateEventInput } from "./types";

/**
 * Generate a VEVENT iCalendar string from event input.
 */
export function generateVEvent(event: CreateEventInput | UpdateEventInput, uid?: string): string {
  const eventUid = uid ?? crypto.randomUUID();
  const now = formatDateTimeUTC(new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Subspace Mail//CalDAV Client//EN",
    "BEGIN:VEVENT",
    `UID:${eventUid}`,
    `DTSTAMP:${now}`,
  ];

  if (event.summary) {
    lines.push(`SUMMARY:${escapeICalText(event.summary)}`);
  }

  if (event.startTime && event.endTime) {
    if (event.isAllDay) {
      // Extract the date directly from the ISO string to avoid timezone conversion issues
      // The input is an ISO string like "2025-12-25T00:00:00Z" or "2025-12-25T00:00"
      const startParts = event.startTime.split("T")[0]?.split("-");
      const endParts = event.endTime.split("T")[0]?.split("-");
      if (startParts?.length === 3) {
        lines.push(`DTSTART;VALUE=DATE:${startParts[0]}${startParts[1]}${startParts[2]}`);
      }
      if (endParts?.length === 3) {
        lines.push(`DTEND;VALUE=DATE:${endParts[0]}${endParts[1]}${endParts[2]}`);
      }
    } else {
      lines.push(`DTSTART:${formatDateTimeUTC(new Date(event.startTime))}`);
      lines.push(`DTEND:${formatDateTimeUTC(new Date(event.endTime))}`);
    }
  }

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICalText(event.description)}`);
  }

  if (event.location) {
    lines.push(`LOCATION:${escapeICalText(event.location)}`);
  }

  if ("attendees" in event && event.attendees) {
    for (const attendee of event.attendees) {
      lines.push(`ATTENDEE;RSVP=TRUE:mailto:${attendee.email}`);
    }
  }

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}

/**
 * Parse a VEVENT from iCalendar data into CalendarEventData.
 */
export function parseVEvent(icalData: string, href?: string): CalendarEventData {
  const lines = unfoldLines(icalData);

  let uid: string | null = null;
  let summary: string | null = null;
  let description: string | null = null;
  let location: string | null = null;
  let dtstart: string | null = null;
  let dtend: string | null = null;
  let duration: string | null = null;
  let status = "confirmed";
  let organizerEmail: string | null = null;
  let isAllDay = false;
  const attendees: { email: string; displayName?: string; responseStatus?: string }[] = [];

  for (const line of lines) {
    const [nameWithParams, ...valueParts] = line.split(":");
    if (!nameWithParams) continue;
    const value = valueParts.join(":");
    const nameParts = nameWithParams.split(";");
    const propName = nameParts[0]!.toUpperCase();
    const params = nameParts.slice(1).join(";").toUpperCase();

    switch (propName) {
      case "UID":
        uid = value;
        break;
      case "SUMMARY":
        summary = unescapeICalText(value);
        break;
      case "DESCRIPTION":
        description = unescapeICalText(value);
        break;
      case "LOCATION":
        location = unescapeICalText(value);
        break;
      case "DTSTART":
        dtstart = value;
        if (params.includes("VALUE=DATE") && !params.includes("VALUE=DATE-TIME")) {
          isAllDay = true;
        }
        break;
      case "DTEND":
        dtend = value;
        // DTEND can also indicate all-day if it has VALUE=DATE
        if (params.includes("VALUE=DATE") && !params.includes("VALUE=DATE-TIME")) {
          isAllDay = true;
        }
        break;
      case "DURATION":
        duration = value;
        break;
      case "STATUS":
        status = value.toLowerCase();
        break;
      case "ORGANIZER": {
        const mailto = value.match(/mailto:(.+)/i);
        if (mailto) organizerEmail = mailto[1]!;
        break;
      }
      case "ATTENDEE": {
        const attendeeMailto = value.match(/mailto:(.+)/i);
        if (attendeeMailto) {
          const cnMatch = nameWithParams.match(/CN=([^;]+)/i);
          const statusMatch = nameWithParams.match(/PARTSTAT=([^;]+)/i);
          attendees.push({
            email: attendeeMailto[1]!,
            displayName: cnMatch?.[1]?.replace(/^"(.*)"$/, "$1"),
            responseStatus: statusMatch?.[1]?.toLowerCase(),
          });
        }
        break;
      }
    }
  }

  const startTime = dtstart ? parseICalDateTime(dtstart, isAllDay) : 0;
  let endTime: number;
  if (dtend) {
    endTime = parseICalDateTime(dtend, isAllDay);
  } else if (duration && startTime > 0) {
    endTime = startTime + parseICalDuration(duration);
  } else {
    endTime = startTime + 3600;
  }

  return {
    remoteEventId: href ?? uid ?? crypto.randomUUID(),
    uid,
    etag: null,
    summary,
    description,
    location,
    startTime,
    endTime,
    isAllDay,
    status,
    organizerEmail,
    attendeesJson: attendees.length > 0 ? JSON.stringify(attendees) : null,
    htmlLink: null,
    icalData,
  };
}

/** Unfold continuation lines (RFC 5545 §3.1) */
function unfoldLines(icalData: string): string[] {
  const raw = icalData.replace(/\r\n[ \t]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return raw.split("\n").filter((l) => l.length > 0);
}

function formatDateTimeUTC(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}


function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function unescapeICalText(text: string): string {
  return text
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseICalDateTime(value: string, isAllDay: boolean): number {
  if (isAllDay) {
    // Format: YYYYMMDD — use UTC to match the UTC day boundaries used in calendar views
    const y = parseInt(value.substring(0, 4), 10);
    const m = parseInt(value.substring(4, 6), 10) - 1;
    const d = parseInt(value.substring(6, 8), 10);
    return Math.floor(Date.UTC(y, m, d) / 1000);
  }

  // Format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS+HHMM
  // Always store as UTC timestamps for consistent filtering in calendar views.
  // For datetimes without a timezone indicator (floating times), treat them as UTC
  // to avoid timezone-dependent behavior — the event will display correctly in the
  // user's local timezone when rendered.

  // Check for timezone offset (e.g., +0530, -0400)
  const offsetMatch = value.match(/([+-])(\d{2})(\d{2})$/);
  if (offsetMatch) {
    // Has timezone offset — parse the local time and adjust to UTC
    const sign = (offsetMatch[1] ?? '+') === '+' ? -1 : 1; // subtract offset to get UTC
    const offsetHours = parseInt(offsetMatch[2] ?? '0', 10);
    const offsetMinutes = parseInt(offsetMatch[3] ?? '0', 10);
    const cleaned = value.slice(0, -5); // strip the offset
    const y = parseInt(cleaned.substring(0, 4), 10);
    const m = parseInt(cleaned.substring(4, 6), 10) - 1;
    const d = parseInt(cleaned.substring(6, 8), 10);
    const h = parseInt(cleaned.substring(9, 11), 10);
    const min = parseInt(cleaned.substring(11, 13), 10);
    const s = parseInt(cleaned.substring(13, 15), 10) || 0;
    const date = new Date(Date.UTC(y, m, d, h, min, s));
    // Adjust by the offset to get UTC
    date.setUTCMinutes(date.getUTCMinutes() + sign * (offsetHours * 60 + offsetMinutes));
    const result = Math.floor(date.getTime() / 1000);
    return Number.isFinite(result) ? result : 0;
  }

  // UTC (Z suffix) or floating time — treat both as UTC
  const cleaned = value.replace("Z", "");
  const y = parseInt(cleaned.substring(0, 4), 10);
  const m = parseInt(cleaned.substring(4, 6), 10) - 1;
  const d = parseInt(cleaned.substring(6, 8), 10);
  const h = parseInt(cleaned.substring(9, 11), 10);
  const min = parseInt(cleaned.substring(11, 13), 10);
  const s = parseInt(cleaned.substring(13, 15), 10) || 0;

  const date = new Date(Date.UTC(y, m, d, h, min, s));
  const result = Math.floor(date.getTime() / 1000);
  return Number.isFinite(result) ? result : 0;
}

/**
 * Parse an iCalendar DURATION value (RFC 5545 §3.3.10) to seconds.
 * Format: P[n]W or P[n]Y[n]M[n]DT[n]H[n]M[n]S
 * e.g., PT1H30M = 5400 seconds, P1D = 86400 seconds
 */
function parseICalDuration(value: string): number {
  // RFC 5545 duration: P[n]W or P[n]Y[n]M[n]DT[n]H[n]M[n]S
  const match = value.match(/^(-?)P(?:((\d+)W)|(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/);
  if (!match) return 3600; // fallback: 1 hour

  const sign = match[1] === '-' ? -1 : 1;
  const weeks = match[3] ? parseInt(match[3], 10) : 0;
  const years = match[4] ? parseInt(match[4], 10) : 0;
  const months = match[5] ? parseInt(match[5], 10) : 0;
  const days = match[6] ? parseInt(match[6], 10) : 0;
  const hours = match[7] ? parseInt(match[7], 10) : 0;
  const minutes = match[8] ? parseInt(match[8], 10) : 0;
  const seconds = match[9] ? parseInt(match[9], 10) : 0;

  // Approximate years and months (not precise, but good enough for display)
  const totalSeconds = (weeks * 7 + years * 365 + months * 30 + days) * 86400 +
    hours * 3600 + minutes * 60 + seconds;

  return sign * totalSeconds;
}
