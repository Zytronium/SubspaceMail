import { useState, useCallback, useEffect, useMemo } from "react";
import { MapPin, Clock, User, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import { DateTimePicker } from "@/components/ui/DateTimePicker";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { DbCalendar } from "@/services/db/calendars";
import { getCalendarProvider } from "@/services/calendar/providerFactory";
import { deleteCalendarEvent as deleteCalendarEventDb } from "@/services/db/calendarEvents";

interface EventDetailModalProps {
  event: DbCalendarEvent;
  calendars: DbCalendar[];
  accountId: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function EventDetailModal({ event, calendars, accountId, onClose, onUpdated }: EventDetailModalProps) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(event.summary ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  const [location, setLocation] = useState(event.location ?? "");
  const [startTime, setStartTime] = useState(toLocalISOString(new Date(event.start_time * 1000)));
  const [endTime, setEndTime] = useState(toLocalISOString(new Date(event.end_time * 1000)));
  const [isAllDay, setIsAllDay] = useState(event.is_all_day === 1);

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

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const calendar = calendars.find((c) => c.id === event.calendar_id);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const provider = await getCalendarProvider(accountId);
      const calendarRemoteId = calendar?.remote_id ?? (provider.type === "google_api" ? "primary" : null);
      if (!calendarRemoteId) throw new Error("No calendar available for this event");
      const remoteEventId = event.remote_event_id ?? event.google_event_id;

      await provider.updateEvent(calendarRemoteId, remoteEventId, {
        summary,
        description: description || undefined,
        location: location || undefined,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        isAllDay,
      }, event.etag ?? undefined);

      setEditing(false);
      onUpdated();
    } catch (err) {
      console.error("Failed to update event:", err);
    } finally {
      setSaving(false);
    }
  }, [accountId, calendar, event, summary, description, location, startTime, endTime, isAllDay, onUpdated]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      // Delete from the server first
      const provider = await getCalendarProvider(accountId);
      const calendarRemoteId = calendar?.remote_id ?? (provider.type === "google_api" ? "primary" : null);
      if (calendarRemoteId) {
        const remoteEventId = event.remote_event_id ?? event.google_event_id;
        await provider.deleteEvent(calendarRemoteId, remoteEventId, event.etag ?? undefined);
      }
    } catch (err) {
      console.error("Failed to delete event from server:", err);
      // Continue with local delete even if server delete fails
    } finally {
      setDeleting(false);
    }

    // Always remove from local DB and refresh UI, regardless of server delete result
    try {
      await deleteCalendarEventDb(event.id);
      onUpdated();
      onClose();
    } catch (err) {
      console.error("Failed to remove event locally:", err);
    }
  }, [accountId, calendar, event, onUpdated, onClose]);

  const formatTime = (ts: number) => {
    return new Date(ts * 1000).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const attendees = event.attendees_json ? JSON.parse(event.attendees_json) as { email: string; displayName?: string }[] : [];

  if (editing) {
    return (
      <Modal isOpen={true} onClose={onClose} title="Edit Event" width="w-full max-w-md">
        <div className="p-4 space-y-3">
          <TextField
            label="Title"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            autoFocus
          />

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
            <Button variant="secondary" size="md" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="md" onClick={handleSave} disabled={saving || !summary.trim()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={event.summary ?? "Event"} width="w-full max-w-md">
      <div className="p-4 space-y-3">
        {calendar && (
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: calendar.color ?? "var(--color-accent)" }}
            />
            {calendar.display_name}
          </div>
        )}

        <div className="flex items-start gap-2.5 text-sm text-text-secondary">
          <Clock size={14} className="mt-0.5 shrink-0 text-text-tertiary" />
          <div>
            <div>{formatTime(event.start_time)}</div>
            <div>{formatTime(event.end_time)}</div>
          </div>
        </div>

        {event.location && (
          <div className="flex items-start gap-2.5 text-sm text-text-secondary">
            <MapPin size={14} className="mt-0.5 shrink-0 text-text-tertiary" />
            <span>{event.location}</span>
          </div>
        )}

        {event.description && (
          <div className="text-sm text-text-secondary whitespace-pre-wrap border-t border-border-primary pt-3">
            {event.description}
          </div>
        )}

        {attendees.length > 0 && (
          <div className="border-t border-border-primary pt-3">
            <div className="text-xs text-text-tertiary mb-1.5">Attendees</div>
            <div className="space-y-1">
              {attendees.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-text-secondary">
                  <User size={12} className="text-text-tertiary" />
                  <span>{a.displayName ?? a.email}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between pt-2 border-t border-border-primary">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-danger">Delete this event?</span>
              <Button variant="danger" size="xs" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Yes, delete"}
              </Button>
              <Button variant="secondary" size="xs" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={<Pencil size={14} />}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function toLocalISOString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
