"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { NAV_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { computeCreditStats } from "@/lib/credits";
import type { CreditStats, CreditStatus } from "@/lib/credits";

export type ActionResult = { error: string } | null;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreditListItem = {
  id: string;
  credit_number: string;
  customer_name: string;
  customer_phone: string | null;
  bill_amount: number;
  paid_amount: number;
  balance: number;
  status: CreditStatus;
  notes: string | null;
  created_at: string;
  settled_at: string | null;
  /** Where the original bill was run — "Table 4", "Room 2", "Walk-in". */
  location: string;
};

/** One line of a credit's payment history. */
export type CreditPaymentEntry = {
  id: string;
  amount: number;
  method: string;
  notes: string | null;
  staff_name: string | null;
  created_at: string;
  /** True for the down payment taken when the bill was closed (not a repayment). */
  at_billing: boolean;
};

export type CreditDetail = CreditListItem & {
  down_payment: number;
  created_by_name: string | null;
  session_id: string | null;
  payment_id: string | null;
  history: CreditPaymentEntry[];
};

export type CreditFilter = "all" | CreditStatus;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// PostgREST's `or()` takes a comma-separated filter list, so a raw search term
// containing commas, parens or wildcards would change the meaning of the query.
// Strip those rather than trying to escape them — none are meaningful in a name,
// phone number or credit id.
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function locationOf(session: any): string {
  if (session?.restaurant_tables?.number) return `Table ${session.restaurant_tables.number}`;
  if (session?.rooms?.number) return `Room ${session.rooms.number}`;
  if (session?.type === "walk_in") return "Walk-in";
  return "—";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toListItem(c: any): CreditListItem {
  return {
    id: c.id,
    credit_number: c.credit_number,
    customer_name: c.customer_name,
    customer_phone: c.customer_phone ?? null,
    bill_amount: Number(c.bill_amount),
    paid_amount: Number(c.paid_amount),
    balance: Number(c.balance),
    status: c.status as CreditStatus,
    notes: c.notes ?? null,
    created_at: c.created_at,
    settled_at: c.settled_at ?? null,
    location: locationOf(c.sessions),
  };
}

const CREDIT_SELECT =
  "id, credit_number, customer_name, customer_phone, bill_amount, paid_amount, balance, status, notes, created_at, settled_at, session_id, payment_id, down_payment, created_by, sessions ( type, restaurant_tables ( number ), rooms ( number ) )";

// ─── List / Search ────────────────────────────────────────────────────────────
// Self-authing so the Credits screen can re-query on every keystroke / filter
// change without ever trusting a restaurant id from the client.

export async function getCredits(params?: {
  search?: string | null;
  status?: CreditFilter;
}): Promise<CreditListItem[]> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) return [];

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (service as any)
    .from("credits")
    .select(CREDIT_SELECT)
    .eq("restaurant_id", ru.restaurant_id);

  const status = params?.status ?? "all";
  if (status !== "all") query = query.eq("status", status);

  const search = sanitizeSearch(params?.search ?? "");
  if (search) {
    // Credit ID, customer name or phone — the three things a cashier has to hand.
    query = query.or(
      `credit_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`
    );
  }

  // Open credits first (they need chasing), then most recent.
  const { data } = await query.order("created_at", { ascending: false }).limit(200);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data ?? []) as any[]).map(toListItem);
  return rows.sort((a, b) => {
    const aOpen = a.status !== "fully_paid" ? 0 : 1;
    const bOpen = b.status !== "fully_paid" ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

// ─── Summary (the Credits screen's stat tiles) ────────────────────────────────
// Outstanding and the status counts are "as of now"; `collected` and `created`
// are scoped to today, which is what a cashier on shift actually wants to see.

const EMPTY_STATS: CreditStats = {
  outstanding: 0,
  collected: 0,
  created: 0,
  pendingCount: 0,
  partiallyPaidCount: 0,
  fullyPaidCount: 0,
  openCount: 0,
};

export async function getCreditSummary(): Promise<CreditStats> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) return EMPTY_STATS;

  const service = createServiceClient();
  const [creditsRes, repaymentsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("credits")
      .select("bill_amount, down_payment, paid_amount, status, created_at")
      .eq("restaurant_id", ru.restaurant_id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("credit_payments")
      .select("amount, created_at")
      .eq("restaurant_id", ru.restaurant_id),
  ]);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  return computeCreditStats(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (creditsRes.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (repaymentsRes.data ?? []) as any[],
    startOfToday,
    Infinity
  );
}

// ─── Detail (with full payment history) ───────────────────────────────────────

export async function getCreditDetail(
  creditId: string
): Promise<CreditDetail | { error: string }> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) {
    return { error: "You don't have permission to view credits." };
  }

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: c } = await (service as any)
    .from("credits")
    .select(CREDIT_SELECT)
    .eq("id", creditId)
    .eq("restaurant_id", ru.restaurant_id) // tenant isolation
    .maybeSingle();

  if (!c) return { error: "Credit not found." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: repayments } = await (service as any)
    .from("credit_payments")
    .select("id, amount, method, notes, received_by, created_at")
    .eq("credit_id", creditId)
    .order("created_at", { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repayRows = (repayments ?? []) as any[];

  // Resolve every staff id involved (who took each payment, who opened the
  // credit) to a display name in a single lookup.
  const staffIds = [
    ...new Set([...repayRows.map((r) => r.received_by), c.created_by].filter(Boolean)),
  ] as string[];
  const names = new Map<string, string>();
  if (staffIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: users } = await (service as any)
      .from("restaurant_users")
      .select("id, display_name")
      .in("id", staffIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of (users ?? []) as any[]) names.set(u.id, u.display_name);
  }

  const downPayment = Number(c.down_payment ?? 0);
  const history: CreditPaymentEntry[] = [];

  // The down payment isn't a repayment — it was banked on the original bill — but
  // it IS part of what this customer has paid, so it opens the history.
  if (downPayment > 0) {
    // Recover the tender used at billing from the bill's own split.
    let method = "cash";
    if (c.payment_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: p } = await (service as any)
        .from("payments")
        .select("cash_amount, online_amount, card_amount")
        .eq("id", c.payment_id)
        .maybeSingle();
      if (p) {
        const parts = [
          { m: "cash", v: Number(p.cash_amount ?? 0) },
          { m: "online", v: Number(p.online_amount ?? 0) },
          { m: "card", v: Number(p.card_amount ?? 0) },
        ].filter((x) => x.v > 0);
        if (parts.length === 1) method = parts[0].m;
        else if (parts.length > 1) method = "mixed";
      }
    }
    history.push({
      id: `${c.id}-down`,
      amount: downPayment,
      method,
      notes: null,
      staff_name: c.created_by ? names.get(c.created_by) ?? null : null,
      created_at: c.created_at,
      at_billing: true,
    });
  }

  for (const r of repayRows) {
    history.push({
      id: r.id,
      amount: Number(r.amount),
      method: r.method,
      notes: r.notes ?? null,
      staff_name: r.received_by ? names.get(r.received_by) ?? null : null,
      created_at: r.created_at,
      at_billing: false,
    });
  }

  return {
    ...toListItem(c),
    down_payment: downPayment,
    created_by_name: c.created_by ? names.get(c.created_by) ?? null : null,
    session_id: c.session_id ?? null,
    payment_id: c.payment_id ?? null,
    history,
  };
}

// ─── Record a repayment ───────────────────────────────────────────────────────
// The balance move + ledger append happen inside `record_credit_payment`, so two
// cashiers taking money for the same credit at once can't both write from the
// same stale balance (the row is locked for the transaction).

const REPAYMENT_METHODS = new Set(["cash", "online", "card"]);

// The RPC signals refusals with a bare error code; turn those into something a
// cashier can act on rather than leaking a Postgres exception.
const RPC_ERRORS: Record<string, string> = {
  CREDIT_NOT_FOUND: "Credit not found.",
  INVALID_AMOUNT: "Enter a payment amount greater than zero.",
  ALREADY_SETTLED: "This credit is already fully paid.",
  AMOUNT_EXCEEDS_BALANCE: "That's more than the remaining balance. Enter the balance or less.",
};

function rpcError(message: string, fallback: string): string {
  for (const [code, text] of Object.entries(RPC_ERRORS)) {
    if (message.includes(code)) return text;
  }
  return fallback;
}

export async function addCreditPayment(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) {
    return { error: "You don't have permission to record credit payments." };
  }

  const creditId = formData.get("credit_id") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const method = ((formData.get("method") as string) || "cash").toLowerCase();
  const notes = (formData.get("notes") as string) || null;

  if (!creditId) return { error: "Credit not found." };
  if (isNaN(amount) || amount <= 0) {
    return { error: "Enter a payment amount greater than zero." };
  }
  if (!REPAYMENT_METHODS.has(method)) return { error: "Invalid payment method." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("record_credit_payment", {
    p_restaurant_id: ru.restaurant_id, // tenant scope is enforced inside the RPC too
    p_credit_id: creditId,
    p_amount: amount,
    p_method: method,
    p_notes: notes,
    p_received_by: ru.id,
  });

  if (error) {
    return { error: rpcError(error.message ?? "", "Could not record the payment. Please try again.") };
  }

  revalidatePath("/employee/credits");
  revalidatePath("/employee/sales");
  revalidatePath("/employee/dashboard");
  return null;
}

// ─── Credit receipt ───────────────────────────────────────────────────────────
// Reassembled from the existing credit + its ledger — creates nothing.

export type CreditReceipt = {
  credit: CreditDetail;
  restaurant: {
    name: string;
    address: string | null;
    contact_phone: string | null;
    pan_vat_number: string | null;
  };
};

export async function getCreditReceipt(
  creditId: string
): Promise<CreditReceipt | { error: string }> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) {
    return { error: "You don't have permission to view credits." };
  }

  const credit = await getCreditDetail(creditId);
  if ("error" in credit) return credit;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("name, address, contact_phone, pan_vat_number")
    .eq("id", ru.restaurant_id)
    .maybeSingle();

  return {
    credit,
    restaurant: {
      name: rest?.name ?? "Restaurant",
      address: rest?.address ?? null,
      contact_phone: rest?.contact_phone ?? null,
      pan_vat_number: rest?.pan_vat_number ?? null,
    },
  };
}
