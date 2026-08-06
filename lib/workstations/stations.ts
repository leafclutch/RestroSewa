// Shared vocabulary for filtering anything BY WORKSTATION — products, purchase
// lines, waste. Kept out of the `"use server"` action files (and out of any one
// screen) so Stock, Purchases and Waste cannot drift on what "Bar" or
// "Unassigned" means.
//
// The mapping itself is `product_workstations`, and it is metadata only: it
// groups and filters, and never takes part in what a sale deducts. See
// `memory-bank/decisions.md`.

import type { WorkstationRow } from "@/app/actions/workstations";

/**
 * The two sentinel filter values. Deliberately not uuids, so neither can ever
 * collide with a real workstation id.
 */
export const ALL_STATIONS = "all";
export const NO_STATION = "none";

/** A station's own colour, with a fallback for one that has none set. */
export const stationColor = (w: WorkstationRow) => w.display_color ?? "var(--color-primary)";

/**
 * Does a thing carrying `ids` belong to the selected station?
 *
 * The ONE definition of the rule, so a product, a purchase line and a waste row
 * are all filtered identically:
 *   · `all`  — everything
 *   · `none` — only things with no station at all ("Unassigned")
 *   · a uuid — things holding that station, INCLUDING things that also hold
 *     others (a product on Bar + Kitchen belongs to both, not to neither).
 */
export function matchesStation(ids: string[], station: string): boolean {
  if (station === ALL_STATIONS) return true;
  if (station === NO_STATION) return ids.length === 0;
  return ids.includes(station);
}

/**
 * The stations worth offering as a filter: every active one, plus any inactive
 * one still referenced by something on screen — otherwise a product (or a
 * purchase line) tagged to a station that was later deactivated sits where no
 * filter can reach it.
 */
export function filterableStations(
  workstations: WorkstationRow[],
  referenced: Iterable<string>
): WorkstationRow[] {
  const held = new Set(referenced);
  return workstations.filter((w) => w.is_active || held.has(w.id));
}
