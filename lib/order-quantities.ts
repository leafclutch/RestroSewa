// The three counts on an order line, in one place.
//
// WHY THIS FILE EXISTS
// A line used to have exactly one quantity, so every consumer could read `quantity`
// and be right. Unit-wise cancellation gives it three, and they are not
// interchangeable:
//
//   ordered    what the guest asked for. Immutable. What an already-printed ticket
//              says, so what a REPRINT of that ticket must say.
//   cancelled  units taken back off — the sum of the line's cancellation events.
//   active     ordered − cancelled. What is BILLED, what still has to be cooked,
//              and what every money figure must use.
//   served     units that reached the guest. A served unit was genuinely consumed,
//              so its stock stays deducted and it can never be cancelled.
//
// Reaching for `ordered` where `active` was meant overcharges the guest; reaching
// for it on a reprint is correct. Both mistakes look identical in review, which is
// why the derivations live here with names that say what they are, rather than being
// re-spelled as `a - b` at thirty call sites.
//
// ZERO RUNTIME IMPORTS, deliberately: `node --test` resolves neither the `@/` alias
// nor an extensionless TS specifier, so a module that imports anything cannot be
// unit-tested in this repo.

export type LineCounts = {
  quantity: number;
  cancelled_quantity?: number | null;
  served_quantity?: number | null;
  /** The DB's generated column. Recomputed here when absent so older shapes still work. */
  active_quantity?: number | null;
};

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** What the guest asked for. Never changes after the order is placed. */
export function orderedQuantity(item: LineCounts): number {
  return Math.max(0, n(item.quantity));
}

export function cancelledQuantity(item: LineCounts): number {
  return Math.max(0, n(item.cancelled_quantity));
}

export function servedQuantity(item: LineCounts): number {
  return Math.max(0, n(item.served_quantity));
}

/**
 * What is still on the bill: ordered − cancelled.
 *
 * Prefers the stored generated column, so this can never disagree with what the
 * database itself computed, and falls back to the subtraction for callers that did
 * not select it.
 */
export function activeQuantity(item: LineCounts): number {
  const stored = item.active_quantity;
  if (stored != null && Number.isFinite(Number(stored))) return Math.max(0, Number(stored));
  return Math.max(0, orderedQuantity(item) - cancelledQuantity(item));
}

/**
 * How many units may still be cancelled: active − served.
 *
 * ⚠️ NOT `ordered − cancelled`. A line of 3 with 2 served has 1 cancellable unit, and
 * offering to cancel 3 is how eaten food gets put back on the shelf.
 */
export function cancellableQuantity(item: LineCounts): number {
  return Math.max(0, activeQuantity(item) - servedQuantity(item));
}

/** This line's share of the bill. Always the ACTIVE units. */
export function lineTotal(item: LineCounts & { item_price: number | string }): number {
  return Number(item.item_price ?? 0) * activeQuantity(item);
}

/** True once every ordered unit has been cancelled — the line is off the bill entirely. */
export function isFullyCancelled(item: LineCounts): boolean {
  return orderedQuantity(item) > 0 && activeQuantity(item) === 0;
}

/** True when SOME but not all of the line was cancelled — the case worth showing staff. */
export function isPartiallyCancelled(item: LineCounts): boolean {
  return cancelledQuantity(item) > 0 && activeQuantity(item) > 0;
}

/**
 * The counts a staff member needs to read at a glance, or null when the line is
 * unremarkable (nothing cancelled, nothing half-served) and the plain "×3" says it all.
 */
export function describeLine(item: LineCounts): string | null {
  const ordered = orderedQuantity(item);
  const cancelled = cancelledQuantity(item);
  const served = servedQuantity(item);
  const active = activeQuantity(item);

  const partlyServed = served > 0 && served < active;
  if (cancelled === 0 && !partlyServed) return null;

  const parts = [`Ordered ${ordered}`];
  if (cancelled > 0) parts.push(`Cancelled ${cancelled}`);
  if (partlyServed) parts.push(`Served ${served}`);
  parts.push(`Remaining ${active}`);
  return parts.join(" · ");
}
