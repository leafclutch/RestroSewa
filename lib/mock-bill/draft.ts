import type { BillItem } from "@/app/(employee)/employee/_components/bill-ticket";

/**
 * ── THE MOCK BILL'S STATE, AND NOTHING ELSE ───────────────────────────────────
 *
 * A mock bill is a demo/training/preview document. It must print byte-for-byte like a
 * real one and touch NOTHING — not stock, not finance, not sales, not a bill number, not
 * an OT number, no push, no email.
 *
 * That guarantee is structural rather than policed, and this file is where it starts:
 * everything here is PURE — it has no runtime imports at all, only an erased type import.
 * No Supabase client, no server action, no RPC, no fetch. A
 * mock bill exists only as the `MockBillDraft` object below, held in React state on the
 * editor screen, and is gone when the tab closes. There is no `mock_bills` table on
 * purpose — every figure in this app is DERIVED from `payments` / `session_order_items` /
 * `purchases` / `stock_adjustments`, so a mock row that is never written can never need a
 * "and exclude the mock ones" clause in a report someone writes two years from now.
 *
 * `lib/mock-bill/isolation.test.ts` asserts that invariant against this file's source.
 *
 * NOTE the seed type below is a structural copy of the fields we want out of
 * `RestaurantConfig`, NOT an import of it: `lib/restaurant-info.ts` is `server-only`, and
 * this module is reached from a client component.
 */

/** The restaurant's real settings, used only to PRE-FILL the editor. */
export type MockBillSeed = {
  name: string;
  address: string | null;
  contact_phone: string | null;
  pan_vat_number: string | null;
  paper_width_mm: 58 | 80;
  bill_number_label: "bill" | "order";
  tax_percent: number | undefined;
  service_charge_percent: number | undefined;
};

export type MockBillLine = {
  id: string;
  name: string;
  qty: number;
  price: number;
};

/**
 * How the mock bill was "settled".
 *
 * Two of these are not tenders at all, and they are different documents:
 *  • `unpaid` — the PRE-payment bill, printed before the cashier has taken anything
 *    ("Status: UNPAID"). This is what a table's Print Bill button produces.
 *  • `credit` — an **unpaid bill** in this app's own sense: the bill was CLOSED with money
 *    still owed, so it prints ON CREDIT / PARTIALLY PAID with a Credit ID and BALANCE DUE.
 *    A credit bill is billed in full and settled later (the accrual model in
 *    `modules/finance.md`), which is why it can also carry a down payment.
 */
export type MockPaymentMethod = "cash" | "online" | "card" | "mixed" | "credit" | "unpaid";

/** How a credit bill's down payment was handed over at billing time. */
export type MockDownTender = "cash" | "online" | "mixed";

export type MockBillDraft = {
  // Header — seeded from the restaurant but editable, so a demo can be given under any name.
  restaurantName: string;
  address: string;
  panVat: string;
  phone: string;
  paperWidthMm: 58 | 80;

  // Bill identity.
  location: string;
  billNo: string;
  billLabel: "bill" | "order";
  /** Local wall-clock in the `YYYY-MM-DDTHH:mm` shape `<input type="datetime-local">` speaks. */
  at: string;

  // Customer block (printed only when something in it is filled in).
  customerName: string;
  customerPhone: string;

  lines: MockBillLine[];

  // Money.
  discount: number;
  taxPercent: number;
  servicePercent: number;
  /** `null` derives the total; a number replaces the printed TOTAL outright. */
  totalOverride: number | null;

  // Tender.
  method: MockPaymentMethod;
  cash: number;
  online: number;
  card: number;
  cashier: string;

  // Credit ("unpaid bill") — used only when `method === "credit"`.
  creditNumber: string;
  /** The account the debt sits against. Printed as "Credit a/c", NOT as "Customer" — on a
   *  real bill the two are deliberately distinct, because a company account can settle for
   *  a guest. */
  creditAccount: string;
  creditPhone: string;
  /** Handed over at billing time. The rest becomes the balance due. */
  tendered: number;
  tenderedAs: MockDownTender;

  /** Scratch space for the person giving the demo. NEVER printed — a real bill has no
   *  notes line, and the whole point of this feature is that the paper is indistinguishable. */
  notes: string;
};

// ── the verification mark ─────────────────────────────────────────────────────

/**
 * The one thing that separates a mock bill from a real one on paper.
 *
 * Deliberately a bare "M" appended to the bill number ("1024 · M") rather than a
 * watermark or a "DEMO" banner: a customer looking at the receipt reads it as part of the
 * number, while staff who know the system can spot it at a glance.
 *
 * It is applied HERE, by the caller, as a plain string — `BillTicket` is handed
 * `billNo="1024 · M"` and never learns that mock bills exist. That is what keeps the
 * shared print component free of any mock-awareness that could leak onto a real receipt.
 */
export const MOCK_MARK = "M";

export const markBillNumber = (billNo: string) => `${billNo.trim()} · ${MOCK_MARK}`;

// ── construction ──────────────────────────────────────────────────────────────

// Line ids only have to be unique within one draft (React keys + reorder), so a counter
// is enough — and unlike `crypto.randomUUID()` it needs no platform check.
let seq = 0;
const nextLineId = () => `ml-${++seq}`;

export function newLine(partial: Partial<Omit<MockBillLine, "id">> = {}): MockBillLine {
  return { id: nextLineId(), name: partial.name ?? "", qty: partial.qty ?? 1, price: partial.price ?? 0 };
}

/** `YYYY-MM-DDTHH:mm` for a Date, in LOCAL time — what the datetime input round-trips. */
export function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Parse the editor's datetime back to a Date.
 *
 * `new Date("2026-08-07T14:30")` — no timezone suffix — is parsed as LOCAL time, which is
 * what the cashier typed and what the bill should print. An invalid/half-typed value falls
 * back to now rather than printing "Invalid Date" onto a customer's receipt.
 */
export function parseLocalInputValue(v: string): Date {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** A fresh draft, pre-filled from the restaurant's real settings so a demo starts realistic. */
export function emptyDraft(seed: MockBillSeed): MockBillDraft {
  return {
    restaurantName: seed.name,
    address: seed.address ?? "",
    panVat: seed.pan_vat_number ?? "",
    phone: seed.contact_phone ?? "",
    paperWidthMm: seed.paper_width_mm,

    location: "Table 1",
    billNo: "1001",
    billLabel: seed.bill_number_label,
    at: toLocalInputValue(new Date()),

    customerName: "",
    customerPhone: "",

    lines: [newLine()],

    discount: 0,
    taxPercent: seed.tax_percent ?? 0,
    servicePercent: seed.service_charge_percent ?? 0,
    totalOverride: null,

    method: "cash",
    cash: 0,
    online: 0,
    card: 0,
    cashier: "",

    creditNumber: "CR-0001",
    creditAccount: "",
    creditPhone: "",
    tendered: 0,
    tenderedAs: "cash",

    notes: "",
  };
}

// ── derivation ────────────────────────────────────────────────────────────────

export type MockBillTotals = {
  subtotal: number;
  taxable: number;
  tax: number;
  service: number;
  /** What the bill would total on its own. */
  computedTotal: number;
  /** What actually prints — the override when one is set. */
  total: number;
  overridden: boolean;
};

/**
 * MIRRORS `BillTicket`'s own arithmetic exactly, including the rule that the discount
 * comes off BEFORE tax and service (you are not taxed on money you did not pay).
 *
 * It exists so the editor's on-screen summary can never disagree with the paper. If
 * `BillTicket` ever changes how it totals a bill, this changes with it — that is the
 * whole contract, and it is worth a moment's checking rather than a silent drift.
 */
export function deriveTotals(draft: MockBillDraft): MockBillTotals {
  const subtotal = draft.lines.reduce((s, l) => s + num(l.price) * num(l.qty), 0);
  const taxable = Math.max(0, subtotal - num(draft.discount));
  const tax = taxable * (num(draft.taxPercent) / 100);
  const service = taxable * (num(draft.servicePercent) / 100);
  const computedTotal = taxable + tax + service;
  const overridden = draft.totalOverride != null;
  return {
    subtotal,
    taxable,
    tax,
    service,
    computedTotal,
    total: overridden ? num(draft.totalOverride) : computedTotal,
    overridden,
  };
}

const num = (v: number | null | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ── mapping onto the SHARED bill component's props ────────────────────────────
//
// These adapters are the entire bridge between the mock editor and `BillTicket`. Keeping
// them here (rather than inline in the editor) means the mapping is testable and there is
// exactly one place that decides how a draft becomes a printed bill.

/** Blank lines are dropped: an empty row in the editor is a row not yet filled in. */
export function toBillItems(draft: MockBillDraft): BillItem[] {
  return draft.lines
    .filter((l) => l.name.trim() !== "")
    .map((l) => ({ id: l.id, item_name: l.name.trim(), item_price: num(l.price), quantity: num(l.qty) }));
}

/** The tender as facts. `null` is a bill printed before anything was taken. */
export type MockTender = {
  method: "cash" | "online" | "card" | "mixed";
  cashier: string | null;
  cash: number;
  online: number;
  card: number;
};

/**
 * The tender split, or `null` for an unpaid bill — which is what makes `BillTicket` print
 * "Status: UNPAID", exactly as a real pre-payment bill does.
 *
 * A single-tender bill puts the whole total on that tender and zeroes the others, so
 * `BillTicket` sees one non-zero part and omits the split line — the same output a real
 * cash bill produces. Only `mixed` shows "Cash ₹x · Online ₹y".
 *
 * A CREDIT bill still returns a tender, but for its **down payment** rather than the total:
 * a credit bill is billed in full and may have had something handed over at billing time.
 * With nothing handed over every part is 0, so no split line prints and `BillTicket` reads
 * "ON CREDIT".
 *
 * It returns the method KEY, not its printed spelling. How a method is worded on a bill
 * belongs to `lib/billing/payment-method.ts` and is applied at the render site, which is
 * also what keeps this module free of runtime imports — see the header.
 */
export function toTender(draft: MockBillDraft, total: number): MockTender | null {
  if (draft.method === "unpaid") return null;
  const cashier = draft.cashier.trim() || null;

  if (draft.method === "credit") {
    if (draft.tenderedAs === "mixed") {
      return { method: "mixed", cashier, cash: num(draft.cash), online: num(draft.online), card: 0 };
    }
    const paid = num(draft.tendered);
    return {
      method: draft.tenderedAs,
      cashier,
      cash: draft.tenderedAs === "cash" ? paid : 0,
      online: draft.tenderedAs === "online" ? paid : 0,
      card: 0,
    };
  }

  if (draft.method === "mixed") {
    return { method: "mixed", cashier, cash: num(draft.cash), online: num(draft.online), card: num(draft.card) };
  }
  return {
    method: draft.method,
    cashier,
    cash: draft.method === "cash" ? total : 0,
    online: draft.method === "online" ? total : 0,
    card: draft.method === "card" ? total : 0,
  };
}

/** The credit block — a bill closed with money still owed. */
export type MockCredit = {
  credit_number: string;
  customer_name: string;
  customer_phone: string | null;
  /** Handed over at billing time. */
  tendered: number;
  /** Still owed. */
  balance: number;
};

/**
 * The ON CREDIT / PARTIALLY PAID block, or `null` for any other kind of bill.
 *
 * `tendered` is DERIVED from the tender split rather than read straight off the draft, which
 * is how the real bill does it (`paid-bill.tsx` computes `cash + online + card`). That means
 * a mixed down payment can never disagree with the two amounts printed beside it — the bug
 * that shape of code exists to prevent.
 *
 * The balance floors at zero: over-tendering is a mistake, not a negative debt.
 */
export function toCredit(draft: MockBillDraft, total: number): MockCredit | null {
  if (draft.method !== "credit") return null;
  const t = toTender(draft, total);
  const tendered = t ? t.cash + t.online + t.card : 0;
  return {
    credit_number: draft.creditNumber.trim() || "—",
    // Falls back to the customer block so a half-filled demo still prints something sensible.
    customer_name: draft.creditAccount.trim() || draft.customerName.trim() || "—",
    customer_phone: draft.creditPhone.trim() || null,
    tendered,
    balance: Math.max(0, total - tendered),
  };
}

// ── list operations (pure, so the editor stays declarative) ───────────────────

export function moveLine(lines: MockBillLine[], index: number, delta: number): MockBillLine[] {
  const to = index + delta;
  if (index < 0 || index >= lines.length || to < 0 || to >= lines.length) return lines;
  const next = [...lines];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
