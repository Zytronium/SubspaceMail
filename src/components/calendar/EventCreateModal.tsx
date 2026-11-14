import { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import { Select } from "@/components/ui/Select";
import { DateTimePicker } from "@/components/ui/DateTimePicker";
import type { DbCalendar } from "@/services/db/calendars";

interface EventCreateModalProps {
  calendars?: DbCalendar[];
  onClose: () => void;
  onCreate: (event: {
    summary: string;
    description: string;
    location: string;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    calendarId?: string;
  }) => void;
}

export function EventCreateModal({ calendars, onClose, onCreate }: EventCreateModalProps) {
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState(getDefaultStart());
  const [endTime, setEndTime] = useState(getDefaultEnd());
  const [calendarId, setCalendarId] = useState<string>(
    calendars?.find((c) => c.is_primary)?.id ?? calendars?.[0]?.id ?? "",
  );
  const [isAllDay, setIsAllDay] = useState(false);

  // Track the delta between start and end times, so end shifts when start changes
  const initialDelta = useMemo(() => {
    return new Date(endTime).getTime() - new Date(startTime).getTime();
  }, []);

  useEffect(() => {
    // When start time changes, adjust end time by the same delta
    const newStart = new Date(startTime);
    const newEnd = new Date(newStart.getTime() + initialDelta);
    setEndTime(toLocalISOString(newEnd));
  }, [startTime, initialDelta]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) return;
    onCreate({
      summary: summary.trim(),
      description,
      location,
      startTime,
      endTime,
      isAllDay,
      calendarId: calendarId || undefined,
    });
  }, [summary, description, location, startTime, endTime, isAllDay, calendarId, onCreate]);

  return (
    <Modal isOpen={true} onClose={onClose} title="Create Event" width="w-full max-w-md">
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <TextField
          label="Title"
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Event title"
          autoFocus
        />

        {calendars && calendars.length > 1 && (
          <div>
            <label className="text-xs text-text-secondary block mb-1">Calendar</label>
            <Select
              value={calendarId}
              onChange={(val) => setCalendarId(val)}
              options={calendars.map((cal) => ({
                value: cal.id,
                label: `${cal.display_name ?? "Calendar"}${cal.is_primary ? " (Primary)" : ""}`,
              }))}
              className="w-full"
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsAllDay(!isAllDay)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              isAllDay ? "bg-accent" : "bg-bg-tertiary border border-border-primary"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                isAllDay ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-sm text-text-primary">All day</span>
        </div>

        <div className="space-y-3">
          <DateTimePicker
            label="Start"
            value={startTime}
            onChange={setStartTime}
            hideTime={isAllDay}
          />
          <DateTimePicker
            label="End"
            value={endTime}
            onChange={setEndTime}
            hideTime={isAllDay}
          />
        </div>

        <TextField
          label="Location"
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Add location"
        />

        <div>
          <label className="text-xs text-text-secondary block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description"
            rows={3}
            className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-primary rounded text-sm text-text-primary outline-none focus:border-accent resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!summary.trim()}
          >
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function getDefaultStart(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return toLocalISOString(now);
}

function getDefaultEnd(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 2);
  return toLocalISOString(now);
}

function toLocalISOString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
