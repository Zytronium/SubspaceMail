import { useMemo } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { EventCard } from "./EventCard";

interface MonthViewProps {
  currentDate: Date;
  events: DbCalendarEvent[];
  onEventClick: (event: DbCalendarEvent) => void;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({ currentDate, events, onEventClick }: MonthViewProps) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const totalDays = lastDay.getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  // Build grid of weeks
  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Pre-bucket events by day (O(E×D) → O(E)) instead of filtering per cell
  // Use UTC day boundaries to match the UTC timestamps stored from CalDAV
  const eventsByDay = useMemo(() => {
    const map = new Map<number, DbCalendarEvent[]>();
    for (let d = 1; d <= totalDays; d++) {
      const dayStart = Date.UTC(year, month, d) / 1000;
      const dayEnd = Date.UTC(year, month, d + 1) / 1000;
      // For all-day events, DTEND is exclusive per RFC 5545, so subtract 1s to avoid
      // matching the next day's boundary (e.g., an event on Dec 16 has DTEND=Dec 17 00:00
      // but should not appear on Dec 17).
      const dayEvents = events.filter((e) => {
        // For all-day events with a non-zero duration (RFC 5545 exclusive end),
        // subtract 1s so the exclusive DTEND doesn't match the next day's boundary.
        // For zero-duration all-day events (start === end), keep end_time as-is.
        const end = e.is_all_day && e.end_time > e.start_time ? e.end_time - 1 : e.end_time;
        return e.start_time < dayEnd && end >= dayStart;
      });
      if (dayEvents.length > 0) map.set(d, dayEvents);
    }
    return map;
  }, [events, year, month, totalDays]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border-primary">
        {DAY_NAMES.map((name) => (
          <div key={name} className="px-2 py-2 text-xs font-medium text-text-tertiary text-center">
            {name}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 flex-1 auto-rows-fr overflow-y-auto">
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="border-b border-r border-border-secondary bg-bg-tertiary/30" />;
          }
          const isToday = `${year}-${month}-${day}` === todayStr;
          const dayEvents = eventsByDay.get(day) ?? [];

          return (
            <div
              key={day}
              className="border-b border-r border-border-secondary p-1 min-h-[80px]"
            >
              <div className={`text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full ${
                isToday ? "bg-accent text-white" : "text-text-secondary"
              }`}>
                {day}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    compact
                    onClick={() => onEventClick(event)}
                  />
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[0.625rem] text-text-tertiary pl-1">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
