import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/Button";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DateTimePickerProps {
  label: string;
  value: string; // ISO local string: "2024-01-15T09:30"
  onChange: (value: string) => void;
  hideTime?: boolean; // When true, hide the Time tab (for all-day events)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseLocalISO(iso: string): Date {
  return new Date(iso + ":00");
}

function toLocalISOString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(date: Date): boolean {
  const now = new Date();
  return isSameDay(now, date);
}

// ─── Calendar Grid Component ─────────────────────────────────────────────────

function CalendarGrid({
  selectedDate,
  onSelect,
}: {
  selectedDate: Date;
  onSelect: (date: Date) => void;
}) {
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());

  // Keep view in sync with selected date
  useEffect(() => {
    setViewYear(selectedDate.getFullYear());
    setViewMonth(selectedDate.getMonth());
  }, [selectedDate]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

  const prevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const days = useMemo(() => {
    const result: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) result.push(null);
    for (let d = 1; d <= daysInMonth; d++) result.push(d);
    return result;
  }, [daysInMonth, firstDay]);

  return (
    <div className="px-3 pt-2">
      {/* Month/Year header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          onClick={prevMonth}
          className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors text-sm leading-none"
          title="Previous month"
        >
          ‹
        </button>
        <span className="text-sm font-semibold text-text-primary">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          onClick={nextMonth}
          className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors text-sm leading-none"
          title="Next month"
        >
          ›
        </button>
      </div>

      {/* Day names */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {DAY_NAMES.map((d) => (
          <div key={d} className="text-center text-xs text-text-tertiary font-medium py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0">
        {days.map((day, idx) => {
          if (day === null) {
            return <div key={`e-${idx}`} className="h-8" />;
          }
          const cellDate = new Date(viewYear, viewMonth, day);
          const selected = isSameDay(cellDate, selectedDate);
          const todayMark = isToday(cellDate);

          return (
            <button
              key={day}
              onClick={() => onSelect(cellDate)}
              className={`
                h-8 w-full flex items-center justify-center text-sm rounded-full transition-colors
                ${selected
                  ? "bg-accent text-white font-semibold"
                  : todayMark
                    ? "text-accent font-semibold hover:bg-bg-hover"
                    : "text-text-primary hover:bg-bg-hover"
                }
              `}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Analog Clock Component ──────────────────────────────────────────────────

function AnalogClock({
  date,
  onChange,
}: {
  date: Date;
  onChange: (date: Date) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const [dragging, setDragging] = useState(false);
  const [isPM, setIsPM] = useState(date.getHours() >= 12);

  const hours = date.getHours();
  const minutes = date.getMinutes();

  // Keep isPM in sync with date prop changes (but not during drag)
  const prevHoursRef = useRef(hours);
  useEffect(() => {
    if (prevHoursRef.current !== hours && !dragging) {
      prevHoursRef.current = hours;
      setIsPM(hours >= 12);
    }
  }, [hours, dragging]);

  const center = 80;
  const minuteHandLength = 52;
  const hourHandLength = 35;

  // 12-hour display value (0-11, where 0 = 12)
  const hour12 = hours % 12;

  // Angles from 12 o'clock, clockwise
  const minuteAngle = (minutes / 60) * 360;
  const hourAngle = (hour12 / 12) * 360 + (minutes / 60) * 30;

  const getAngleFromEvent = useCallback(
    (clientX: number, clientY: number): number => {
      if (!svgRef.current) return 0;
      const rect = svgRef.current.getBoundingClientRect();
      const svgCenterX = rect.left + rect.width / 2;
      const svgCenterY = rect.top + rect.height / 2;
      const x = clientX - svgCenterX;
      const y = clientY - svgCenterY;
      let angle = Math.atan2(x, -y) * (180 / Math.PI);
      if (angle < 0) angle += 360;
      return angle;
    },
    [],
  );

  const applyAngle = useCallback(
    (clientX: number, clientY: number) => {
      const angle = getAngleFromEvent(clientX, clientY);
      const newDate = new Date(date);

      if (mode === "hour") {
        let newHour12 = Math.round(angle / 30);
        if (newHour12 === 0 && angle > 330) newHour12 = 0;
        // Convert 12-hour position to 24-hour value using isPM state
        let newHour24: number;
        if (newHour12 === 0) {
          newHour24 = isPM ? 12 : 0;
        } else {
          newHour24 = isPM ? newHour12 + 12 : newHour12;
        }
        newDate.setHours(newHour24);
      } else {
        let newMinute = Math.round(angle / 6);
        if (newMinute === 60) newMinute = 0;
        newDate.setMinutes(newMinute);
      }

      onChange(newDate);
    },
    [date, isPM, mode, getAngleFromEvent, onChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      e.preventDefault();
      applyAngle(e.clientX, e.clientY);
      setDragging(true);
    },
    [applyAngle],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!dragging) return;
      applyAngle(e.clientX, e.clientY);
    },
    [dragging, applyAngle],
  );

  const handleMouseUp = useCallback(
    (_e: React.MouseEvent<SVGSVGElement>) => {
      setDragging(false);
      // Advance mode: hour → minute → stay on minute
      if (mode === "hour") {
        setMode("minute");
      }
    },
    [mode],
  );

  // Reset mode when date changes from outside (e.g. quick-select buttons)
  // But skip reset while dragging — changes during drag are user-initiated, not external
  const prevDateRef = useRef(date);
  useEffect(() => {
    if (prevDateRef.current.getTime() !== date.getTime()) {
      prevDateRef.current = date;
      if (!dragging) {
        setMode("hour");
      }
    }
  }, [date, dragging]);

  // Hour markers
  const hourMarkers = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const angle = (i * 30 * Math.PI) / 180;
      const labelRadius = 62;
      const x = center + labelRadius * Math.sin(angle);
      const y = center - labelRadius * Math.cos(angle);
      const label = i === 0 ? 12 : i;
      return { x, y, label };
    });
  }, []);

  // Minute tick marks
  const minuteTicks = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      const angle = (i * 6 * Math.PI) / 180;
      const isHour = i % 5 === 0;
      const outerR = 72;
      const innerR = isHour ? 67 : 70;
      const x1 = center + outerR * Math.sin(angle);
      const y1 = center - outerR * Math.cos(angle);
      const x2 = center + innerR * Math.sin(angle);
      const y2 = center - innerR * Math.cos(angle);
      return { x1, y1, x2, y2, isHour };
    });
  }, []);

  const pad = (n: number) => String(n).padStart(2, "0");
  // 12-hour display: 0 becomes 12
  const displayHour = hour12 === 0 ? 12 : hour12;
  const timeDisplay = `${displayHour}:${pad(minutes)} ${isPM ? "PM" : "AM"}`;

  const toggleAMPM = useCallback(() => {
    setIsPM((pm) => {
      const newPM = !pm;
      const newDate = new Date(date);
      const current24 = newDate.getHours();
      // Convert current 24h to 12h position, then back to 24h with new AM/PM
      let hour12pos = current24 % 12;
      let new24: number;
      if (hour12pos === 0) {
        new24 = newPM ? 12 : 0;
      } else {
        new24 = newPM ? hour12pos + 12 : hour12pos;
      }
      newDate.setHours(new24);
      onChange(newDate);
      return newPM;
    });
  }, [date, onChange]);

  return (
    <div className="flex flex-col items-center">
      {/* Mode indicator */}
      <div className="text-xs text-text-tertiary mb-1 font-medium uppercase tracking-wide">
        {mode === "hour" ? "Set Hour" : "Set Minute"}
      </div>

      {/* Time display */}
      <div className="text-2xl font-bold text-text-primary mb-3 tabular-nums tracking-tight">
        {timeDisplay}
      </div>

      {/* Clock face */}
      <svg
        ref={svgRef}
        width="160"
        height="160"
        viewBox="0 0 160 160"
        className="cursor-pointer select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{ touchAction: "none" }}
      >
        {/* Outer ring */}
        <circle
          cx={center}
          cy={center}
          r={74}
          fill="none"
          stroke="var(--color-border-primary)"
          strokeWidth="1"
        />

        {/* Minute ticks */}
        {minuteTicks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={tick.isHour ? "var(--color-text-secondary)" : "var(--color-text-tertiary)"}
            strokeWidth={tick.isHour ? 1.5 : 0.5}
            opacity={tick.isHour ? 0.6 : 0.3}
          />
        ))}

        {/* Hour labels */}
        {hourMarkers.map((m) => (
          <text
            key={m.label}
            x={m.x}
            y={m.y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-text-secondary"
            style={{ fontSize: "10px", fontWeight: 500 }}
          >
            {m.label}
          </text>
        ))}

        {/* Hour hand */}
        <line
          x1={center}
          y1={center}
          x2={center + hourHandLength * Math.sin((hourAngle * Math.PI) / 180)}
          y2={center - hourHandLength * Math.cos((hourAngle * Math.PI) / 180)}
          stroke={mode === "hour" ? "var(--color-accent)" : "var(--color-text-primary)"}
          strokeWidth={mode === "hour" ? 3.5 : 3}
          strokeLinecap="round"
        />

        {/* Minute hand */}
        <line
          x1={center}
          y1={center}
          x2={center + minuteHandLength * Math.sin((minuteAngle * Math.PI) / 180)}
          y2={center - minuteHandLength * Math.cos((minuteAngle * Math.PI) / 180)}
          stroke={mode === "minute" ? "var(--color-accent)" : "var(--color-text-secondary)"}
          strokeWidth={mode === "minute" ? 2.5 : 2}
          strokeLinecap="round"
        />

        {/* Center dot */}
        <circle
          cx={center}
          cy={center}
          r="3"
          fill="var(--color-accent)"
        />
        <circle
          cx={center}
          cy={center}
          r="1.5"
          fill="white"
        />
      </svg>

      {/* AM/PM toggle + Quick minute buttons */}
      <div className="flex flex-col items-center gap-2 mt-3">
        <button
          type="button"
          onClick={toggleAMPM}
          className={`px-3 py-1 text-sm font-semibold rounded-lg transition-colors ${
            isPM
              ? "bg-accent text-white"
              : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary border border-border-primary"
          }`}
        >
          {isPM ? "PM" : "AM"}
        </button>
        <div className="flex gap-1 flex-wrap justify-center max-w-[160px]">
          {[0, 15, 30, 45].map((m) => (
            <button
              key={m}
              onClick={() => {
                const newDate = new Date(date);
                newDate.setMinutes(m);
                onChange(newDate);
              }}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                minutes === m
                  ? "bg-accent text-white"
                  : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              :{pad(m)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Month/Year Quick Picker ─────────────────────────────────────────────────

function MonthYearPicker({
  selectedDate,
  onSelect,
}: {
  selectedDate: Date;
  onSelect: (date: Date) => void;
}) {
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());

  useEffect(() => {
    setViewYear(selectedDate.getFullYear());
  }, [selectedDate]);

  const handleMonthSelect = (month: number) => {
    const newDate = new Date(selectedDate);
    newDate.setFullYear(viewYear);
    newDate.setMonth(month);
    // Clamp day
    const maxDay = getDaysInMonth(viewYear, month);
    if (newDate.getDate() > maxDay) newDate.setDate(maxDay);
    onSelect(newDate);
  };

  return (
    <div className="px-3 pt-2">
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          onClick={() => setViewYear((y) => y - 1)}
          className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors text-sm"
        >
          ‹
        </button>
        <span className="text-sm font-semibold text-text-primary">{viewYear}</span>
        <button
          onClick={() => setViewYear((y) => y + 1)}
          className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors text-sm"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {MONTH_NAMES_SHORT.map((name, idx) => {
          const selected = selectedDate.getMonth() === idx && selectedDate.getFullYear() === viewYear;
          return (
            <button
              key={name}
              onClick={() => handleMonthSelect(idx)}
              className={`py-2 text-sm rounded-lg transition-colors ${
                selected
                  ? "bg-accent text-white font-semibold"
                  : "text-text-primary hover:bg-bg-hover"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main DateTimePicker Component ───────────────────────────────────────────

export function DateTimePicker({ label, value, onChange, hideTime = false }: DateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"date" | "time">("date");
  const [dateValue, setDateValue] = useState(parseLocalISO(value));
  const [dateView, setDateView] = useState<"calendar" | "monthYear">("calendar");

  // Keep internal state in sync with prop
  useEffect(() => {
    setDateValue(parseLocalISO(value));
  }, [value]);

  const handleDateSelect = useCallback(
    (newDate: Date) => {
      const merged = new Date(dateValue);
      merged.setFullYear(newDate.getFullYear());
      merged.setMonth(newDate.getMonth());
      merged.setDate(newDate.getDate());
      setDateValue(merged);
      onChange(toLocalISOString(merged));
    },
    [dateValue, onChange],
  );

  const handleTimeSelect = useCallback(
    (newDate: Date) => {
      const merged = new Date(dateValue);
      merged.setHours(newDate.getHours());
      merged.setMinutes(newDate.getMinutes());
      setDateValue(merged);
      onChange(toLocalISOString(merged));
    },
    [dateValue, onChange],
  );

  const pad = (n: number) => String(n).padStart(2, "0");
  const dateDisplay = `${dateValue.getFullYear()}-${pad(dateValue.getMonth() + 1)}-${pad(dateValue.getDate())}`;
  const timeDisplay = `${pad(dateValue.getHours())}:${pad(dateValue.getMinutes())}`;

  return (
    <div>
      <label className="text-xs text-text-secondary block mb-1">{label}</label>

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-sm text-text-primary text-left hover:border-accent transition-colors focus:outline-none focus:border-accent"
      >
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="tabular-nums">{hideTime ? dateDisplay : `${dateDisplay}  ${timeDisplay}`}</span>
        </div>
      </button>

      {/* Picker popup */}
      {isOpen && (
        <div className="fixed inset-0 z-[60]" onClick={() => setIsOpen(false)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/10" />

          {/* Panel */}
          <div
            className="absolute bottom-0 left-0 right-0 md:relative md:inset-auto md:left-0 md:mt-2 md:w-[320px] bg-bg-primary border border-border-primary rounded-xl shadow-lg glass-modal p-1"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mode tabs */}
            {!hideTime && (
              <div className="flex border-b border-border-secondary mb-1">
                <button
                  type="button"
                  onClick={() => setMode("date")}
                  className={`flex-1 py-2 text-sm font-medium transition-colors border-b-2 ${
                    mode === "date"
                      ? "border-accent text-accent"
                      : "border-transparent text-text-tertiary hover:text-text-primary"
                  }`}
                >
                  Date
                </button>
                <button
                  type="button"
                  onClick={() => setMode("time")}
                  className={`flex-1 py-2 text-sm font-medium transition-colors border-b-2 ${
                    mode === "time"
                      ? "border-accent text-accent"
                      : "border-transparent text-text-tertiary hover:text-text-primary"
                  }`}
                >
                  Time
                </button>
              </div>
            )}

            {/* Content */}
            {hideTime || mode === "date" ? (
              dateView === "calendar" ? (
                <>
                  <CalendarGrid selectedDate={dateValue} onSelect={handleDateSelect} />
                  <div className="px-3 pt-2 pb-1">
                    <button
                      type="button"
                      onClick={() => setDateView("monthYear")}
                      className="text-xs text-accent hover:text-accent-hover transition-colors font-medium"
                    >
                      Jump to month/year
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <MonthYearPicker selectedDate={dateValue} onSelect={handleDateSelect} />
                  <div className="px-3 pt-1 pb-1">
                    <button
                      type="button"
                      onClick={() => setDateView("calendar")}
                      className="text-xs text-accent hover:text-accent-hover transition-colors font-medium"
                    >
                      Back to calendar
                    </button>
                  </div>
                </>
              )
            ) : (
              <div className="py-3">
                <AnalogClock date={dateValue} onChange={handleTimeSelect} />
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-between items-center px-3 pt-2 pb-2 border-t border-border-secondary mt-1">
              <div className="text-xs text-text-tertiary tabular-nums">
                {hideTime ? dateDisplay : `${dateDisplay} ${timeDisplay}`}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
