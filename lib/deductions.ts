// Shared Deduction Report vocabulary. Lives OUTSIDE the `"use server"` action
// file, the same way `lib/stock.ts` and `lib/finance.ts` do, so the screen and
// the report compute "value removed" with one definition — and so the screen can
// re-total after filtering by station without a round trip for arithmetic.
//
// (A sync helper exported from a `"use server"` module 500s at runtime: every
// export there must be an async function. That rule is why this file exists as
// much as the sharing is.)

/**
 * One manual stock movement — waste, damage, kitchen usage, a staff meal, or a
 * correction.
 *
 * These rows have always existed (`stock_adjustments`, written by the Manual
 * Deduction form) but were only ever readable ONE PRODUCT AT A TIME through
 * `product_history`. There was no way to ask "what did we throw away this
 * month", let alone "what did the Bar throw away".
 */
export type DeductionRow = {
  id: string;
  at: string;
  product_id: string;
  product_name: string;
  unit: string;
  /** The reason picked at deduction time: waste, damage, kitchen_usage, … */
  kind: string;
  /** Signed, as stored: negative removed stock, positive put it back. */
  qty: number;
  /** |qty| × the product's LAST PURCHASE PRICE. An estimate — see the note the
   *  screen prints: it values yesterday's loss at today's cost, because a
   *  historical cost per movement is not recorded anywhere. */
  value: number;
  notes: string | null;
  staff_name: string | null;
  /** Stations holding this row's PRODUCT. Empty ⇒ Unassigned. */
  workstation_ids: string[];
};

export type DeductionSummary = {
  /** Value of everything REMOVED in the period (a positive number). */
  valueRemoved: number;
  /** Value put back by corrections. Kept apart so a +5 correction cannot
   *  silently cancel a −5 wastage and report that nothing was lost. */
  valueAdded: number;
  /** Movements counted, both directions. */
  movements: number;
  /** Value removed, split by reason — the breakdown the report exists for. */
  byReason: { kind: string; value: number; movements: number }[];
};

export const EMPTY_DEDUCTION_SUMMARY: DeductionSummary = {
  valueRemoved: 0,
  valueAdded: 0,
  movements: 0,
  byReason: [],
};

/**
 * Total a set of rows. Called by the action for the period, and again by the
 * screen after a station filter — so the headline always describes exactly the
 * rows on screen.
 */
export function summariseDeductions(rows: DeductionRow[]): DeductionSummary {
  const byReason = new Map<string, { value: number; movements: number }>();
  let valueRemoved = 0;
  let valueAdded = 0;

  for (const r of rows) {
    if (r.qty < 0) {
      valueRemoved += r.value;
      const b = byReason.get(r.kind) ?? { value: 0, movements: 0 };
      b.value += r.value;
      b.movements += 1;
      byReason.set(r.kind, b);
    } else {
      // A correction that ADDS stock is not waste and must never net against it.
      valueAdded += r.value;
    }
  }

  return {
    valueRemoved,
    valueAdded,
    movements: rows.length,
    byReason: [...byReason.entries()]
      .map(([kind, b]) => ({ kind, ...b }))
      .sort((a, b) => b.value - a.value),
  };
}
