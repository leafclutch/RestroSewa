"use client";

import type { WorkstationRow } from "@/app/actions/workstations";
import { ALL_STATIONS, NO_STATION, stationColor } from "@/lib/workstations/stations";

/**
 * The All · <station> · Unassigned filter row, shared by Stock, Purchases and
 * Waste.
 *
 * One component rather than three copies because the chips are the feature's
 * only affordance: if one screen offered a station the others didn't, or
 * dropped "Unassigned", the same question would get different answers on
 * different pages.
 *
 * Renders NOTHING when the restaurant has no stations — a single-station
 * business should never see a filter with one option in it.
 */
export function StationChips({
  stations,
  value,
  onChange,
  className = "",
}: {
  stations: WorkstationRow[];
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  if (stations.length === 0) return null;

  const chips = [
    { key: ALL_STATIONS, label: "All", color: "var(--color-primary)" },
    ...stations.map((w) => ({ key: w.id, label: w.name, color: stationColor(w) })),
    { key: NO_STATION, label: "Unassigned", color: "var(--color-ink-mute)" },
  ];

  return (
    <div
      className={`flex gap-2 overflow-x-auto ${className}`}
      style={{ scrollbarWidth: "none" }}
      role="group"
      aria-label="Filter by workstation"
    >
      {chips.map((c) => {
        const active = value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c.key)}
            className="shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors"
            style={{
              borderColor: active ? c.color : "var(--color-hairline)",
              background: active
                ? `color-mix(in srgb, ${c.color} 13%, transparent)`
                : "var(--color-canvas)",
              color: active ? c.color : "var(--color-ink)",
            }}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
