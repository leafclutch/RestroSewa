"use client";

import type { ShiftKind } from "@/lib/rota";

// Shared look for the rota screens. Every colour is a theme token (or a tint of
// one), so the board, editor and wage sheet follow the dashboard's dark mode
// instead of carrying hard-coded light-theme hex values.

/** A translucent tint of a token — the app's usual way to fill a pill or a chip. */
export const tint = (color: string, pct: number) =>
  `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export const KIND_COLOR: Record<ShiftKind, string> = {
  shift: "var(--color-primary)",
  holiday: "var(--color-success)",
  sick: "var(--color-danger)",
  off: "var(--color-ink-mute)",
};

export const labelCls = "text-xs uppercase tracking-wide";
export const labelStyle = { color: "var(--color-ink-mute)", letterSpacing: "0.06em" } as const;

/** A pill-shaped single choice (Shift/Holiday/…, Unpaid/Paid, Rota/Wages). */
export function Segmented<T extends string | boolean>({
  options,
  value,
  onChange,
  label,
  full = false,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** Stretch the options to fill the row. */
  full?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`${full ? "flex w-full" : "inline-flex"} rounded-lg p-0.5 gap-0.5`}
      style={{ background: "var(--color-canvas-soft)", border: "1px solid var(--color-hairline)" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`${full ? "flex-1" : ""} inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30`}
            style={{
              background: active ? "var(--color-canvas)" : "transparent",
              color: active ? "var(--color-ink)" : "var(--color-ink-mute)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              fontWeight: active ? 500 : 400,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
