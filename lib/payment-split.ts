// Parsing and validating a cash/online split, shared by every payment action.
//
// The DB has the final say — each table carries a
// `check (cash_amount + online_amount = amount)` — but a constraint violation
// surfaces as an opaque Postgres error. Validating here turns it into a sentence
// a cashier can act on, and keeps all four screens agreeing on what "valid"
// means instead of each inventing its own tolerance.

export const SINGLE_TENDER = ["cash", "online"] as const;
export const WITH_MIXED = ["cash", "online", "mixed"] as const;

export type SplitResult =
  | { ok: true; cash: number | null; online: number | null }
  | { ok: false; error: string };

/**
 * Resolve the split for a payment of `amount` made by `method`.
 *
 * A non-mixed method returns nulls, which the DB functions read as "derive it
 * from the method" — i.e. the behaviour they had before splits existed.
 */
export function resolveSplit(
  method: string,
  amount: number,
  rawCash: string | null,
  rawOnline: string | null
): SplitResult {
  if (method !== "mixed") return { ok: true, cash: null, online: null };

  const cash = parseFloat((rawCash ?? "").trim());
  const online = parseFloat((rawOnline ?? "").trim());

  if (isNaN(cash) || isNaN(online)) {
    return { ok: false, error: "Enter both the cash and the online amount." };
  }
  if (cash < 0 || online < 0) {
    return { ok: false, error: "Amounts cannot be negative." };
  }
  // 0.01 matches the picker's tolerance, so the button and the server never
  // disagree about whether a split is acceptable.
  if (Math.abs(cash + online - amount) > 0.01) {
    return {
      ok: false,
      error: `Cash and online together must equal ₹${amount.toFixed(2)}.`,
    };
  }
  // Send an exact pair: the caller's two figures may each be rounded, and the
  // CHECK constraint compares exactly. Anchor on online, absorb the remainder
  // into cash — the same rule the DB functions apply.
  return { ok: true, cash: Math.round((amount - online) * 100) / 100, online };
}
