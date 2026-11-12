import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Custom dropdown select component that replaces native <select> elements.
 * Native select dropdowns cannot be styled on webkit2gtk (Linux/Tauri) because
 * they render as OS-native widgets that ignore page CSS.
 */
export function Select({ value, options, onChange, className = "", disabled = false }: SelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selectedOption = options.find((o) => o.value === value);

  const handleToggle = useCallback(() => {
    if (!disabled) setOpen((prev) => !prev);
  }, [disabled]);

  const handleSelect = useCallback(
    (optionValue: string) => {
      onChange(optionValue);
      setOpen(false);
    },
    [onChange]
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }

      if (e.key === "ArrowDown" && !open) {
        e.preventDefault();
        setOpen(true);
        return;
      }

      if (e.key === "ArrowDown" && open) {
        e.preventDefault();
        const currentIndex = options.findIndex((o) => o.value === value);
        const nextIndex = Math.min(currentIndex + 1, options.length - 1);
        if (options[nextIndex]) {
          onChange(options[nextIndex].value);
          const items = listRef.current?.querySelectorAll<HTMLLIElement>("[role=option]");
          items?.[nextIndex]?.focus();
        }
        return;
      }

      if (e.key === "ArrowUp" && open) {
        e.preventDefault();
        const currentIndex = options.findIndex((o) => o.value === value);
        const prevIndex = Math.max(currentIndex - 1, 0);
        if (options[prevIndex]) {
          onChange(options[prevIndex].value);
          const items = listRef.current?.querySelectorAll<HTMLLIElement>("[role=option]");
          items?.[prevIndex]?.focus();
        }
        return;
      }

      if (e.key === "Enter" && open) {
        e.preventDefault();
        setOpen(false);
      }
    },
    [open, options, value, onChange]
  );

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={handleToggle}
        className={`flex items-center justify-between w-full px-3 py-1.5 text-sm rounded-md border border-border-primary bg-bg-tertiary text-text-primary outline-none focus:border-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          open ? "border-accent" : ""
        }`}
      >
        <span className="truncate">{selectedOption?.label || ""}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 ml-1 transition-transform text-text-tertiary ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 w-full bg-bg-secondary border border-border-primary rounded-md shadow-lg py-1 max-h-60 overflow-auto"
          tabIndex={-1}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => handleSelect(option.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelect(option.value);
                  }
                }}
                className={`px-3 py-1.5 text-sm cursor-pointer outline-none ${
                  isSelected
                    ? "bg-accent/10 text-text-primary font-medium"
                    : "text-text-primary hover:bg-bg-hover focus:bg-bg-hover"
                }`}
              >
                {option.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
