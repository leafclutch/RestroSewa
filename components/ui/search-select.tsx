"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

export type SearchSelectOption = {
  value: string;
  label: string;
  /** Small muted text on the right of the option (a unit, a category …). */
  hint?: string;
};

/**
 * A <select> you can type into: filters the options by name as you type, arrow keys +
 * Enter to pick, Esc to close. For pickers whose lists are long enough that scrolling a
 * native <select> to find "Paneer" or "Momo · Chicken" is the slow part.
 *
 * Enter never submits the surrounding form — it only ever picks.
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  emptyText = "Nothing matches",
}: {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);
  const matches = useMemo(() => {
    // Every word must appear somewhere, in any order — "chi mo" finds "Momo · Chicken".
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.hint ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [options, query]);

  const pick = (o: SearchSelectOption) => {
    onChange(o.value);
    setOpen(false);
    setQuery("");
  };

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  return (
    <div className="relative w-full min-w-0">
      <Search
        size={14}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: "var(--color-ink-mute)" }}
      />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : selected?.label ?? ""}
        onFocus={() => { setOpen(true); setQuery(""); setHighlight(0); }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { setQuery(e.target.value); setHighlight(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && matches[highlight]) pick(matches[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="w-full text-sm rounded-lg border pl-8 pr-2.5 py-1.5"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
      />
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto thin-scrollbar rounded-lg border py-1"
          style={{
            background: "var(--color-canvas)",
            borderColor: "var(--color-hairline-input)",
            boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
          }}
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm" style={{ color: "var(--color-ink-mute)" }}>
              {emptyText}
              {query.trim() ? ` “${query.trim()}”` : ""}
            </li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                // mousedown, not click: it fires before the input's blur closes the list.
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setHighlight(i)}
                className="px-3 py-1.5 text-sm cursor-pointer flex items-center justify-between gap-2"
                style={{
                  background: i === highlight ? "var(--color-canvas-soft)" : "transparent",
                  color: "var(--color-ink)",
                  fontWeight: o.value === value ? 600 : 400,
                }}
              >
                <span className="truncate">{o.label}</span>
                {o.hint && (
                  <span className="text-xs shrink-0" style={{ color: "var(--color-ink-mute)" }}>{o.hint}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
