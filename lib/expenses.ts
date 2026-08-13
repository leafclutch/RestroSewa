// The Extra Expenses vocabulary — overheads that are neither stock nor people.
//
// Lives outside the "use server" action file so the form, the Finance report, the
// CSV export and the emailed PDF all name a category identically. Four surfaces
// inventing four spellings of "electricity" is how a category report stops
// meaning anything.
//
// THE KEYS ARE DELIBERATELY SINGLE WORDS.
// `finance_transactions` labels a ledger row with `initcap(category)` in SQL. A
// key of `licenses` therefore renders "Licenses" on the ledger and must render
// "Licenses" here too — so a label like "Licenses & Taxes" would silently make
// the same expense read two different ways on two screens. Keeping every label
// equal to `initcap(key)` means the two cannot drift, with no label map in SQL.

/**
 * What money was spent ON. These are the categories the expense form offers.
 *
 * `saving` is deliberately NOT here — see `EXPENSE_CATEGORIES` below.
 */
export const SPENDING_CATEGORIES = [
  "rent",
  "electricity",
  "water",
  "gas",
  "internet",
  "maintenance",
  "marketing",
  "licenses",
  "transport",
  "other",
] as const;

/**
 * Every category that can appear on a row, spending plus `saving`.
 *
 * A saving IS an extra expense — same table, same tender split, same effect on
 * cash and bank, and it reaches Finance as one more category with no code at all.
 * What makes it different is that it carries a TITLE (the pot it went into), and
 * a DB constraint makes that an equivalence: only a saving may have a title, and
 * every saving must have one.
 *
 * It is excluded from `SPENDING_CATEGORIES` because a saving is recorded from the
 * Saving section, where a pot can be chosen — picking "Saving" from the ordinary
 * expense form would produce a row with nowhere to file it.
 */
export const EXPENSE_CATEGORIES = [...SPENDING_CATEGORIES, "saving"] as const;

export type SpendingCategory = (typeof SPENDING_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Display order on the form: the ones a restaurant pays every month first. */
export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  rent: "Rent",
  electricity: "Electricity",
  water: "Water",
  gas: "Gas",
  internet: "Internet",
  maintenance: "Maintenance",
  marketing: "Marketing",
  licenses: "Licenses",
  transport: "Transport",
  other: "Other",
  saving: "Saving",
};

/** Narrows an untrusted string from a form post. The DB CHECK is the backstop. */
export function isExpenseCategory(v: string): v is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(v);
}

/** As above, but rejects `saving` — which the ordinary expense form must not post. */
export function isSpendingCategory(v: string): v is SpendingCategory {
  return (SPENDING_CATEGORIES as readonly string[]).includes(v);
}

/** A category label from a raw DB value, tolerating anything unexpected. */
export function expenseCategoryLabel(v: string): string {
  return isExpenseCategory(v)
    ? EXPENSE_CATEGORY_LABEL[v]
    : v.charAt(0).toUpperCase() + v.slice(1);
}

/** One recorded expense, as the page and the actions pass it around. */
export type ExtraExpense = {
  id: string;
  category: ExpenseCategory;
  categoryLabel: string;
  note: string | null;
  amount: number;
  /** cash | online | mixed */
  method: string;
  cash: number;
  online: number;
  createdAt: string;
  createdByName: string | null;
  /** Null until an admin corrects the row behind the Security PIN. */
  updatedAt: string | null;
  /** Set on savings only, and on savings always — enforced by a DB constraint. */
  savingTitleId: string | null;
  savingTitleName: string | null;
};

/**
 * A savings pot.
 *
 * A record rather than free text so a pot can be RENAMED without rewriting the
 * history filed under it, and so its all-time total is exact — free text would
 * let "Emergency Fund", "emergency fund" and "Emergency" become three pots that
 * never add up. `total` is ALL-TIME, because a pot's size is not a period
 * concept: what the period picker shows is spending, not what you have put by.
 */
export type SavingTitle = {
  id: string;
  name: string;
  /**
   * What the pot holds: `openingAmount + Σ its saving rows` (withdrawals are
   * negative rows, so they are already netted).
   *
   * ⚠️ This does NOT equal `cash + online`, and must not. The opening amount is
   * money set aside before the app was tracking it — no tender, because nothing
   * moved. The split below describes only what the app itself recorded.
   */
  total: number;
  /**
   * The balance the pot started with, outside the app's accounting entirely.
   * It moves no cash, writes no ledger row and does not touch profit — see
   * migration 20260817000000.
   */
  openingAmount: number;
  /** Cash the app has recorded into this pot. See the warning on `total`. */
  cash: number;
  /** Online/bank the app has recorded into this pot. */
  online: number;
  entryCount: number;
  createdAt: string;
  /**
   * Set when the viewer may only see TODAY's activity (the add-only permission).
   * `total` then carries today's net contribution and `openingAmount` is 0 —
   * the running balance is never computed for them, let alone sent.
   */
  todayOnly?: boolean;
};

/**
 * One line of the per-category breakdown on the Finance report.
 *
 * Built by `finance_report` as jsonb rather than a second RPC: this app is
 * latency-bound, not query-bound, so a round trip costs more than the payload.
 * Categories with no spend in the period are absent — a quiet day stays short
 * instead of printing ten zeroes.
 */
export type ExpenseCategoryTotal = {
  category: string;
  label: string;
  cash: number;
  online: number;
  total: number;
};
