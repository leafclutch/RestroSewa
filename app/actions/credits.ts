"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { NAV_ACCESS, STOCK_ACCESS, hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { computeCreditStats } from "@/lib/credits";
import { resolveSplit } from "@/lib/payment-split";
import { businessPeriodBounds } from "@/lib/business-day";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import type { CreditStats, CreditStatus } from "@/lib/credits";

export type ActionResult = { error: string } | null;

// ─── Types ────────────────────────────────────────────────────────────────────
// The ACCOUNT is the unit now, not the bill. One customer, one Credit ID, one
// balance — however many unpaid bills sit under it.

export type CreditCustomer = {
  id: string;
  /** CRD-00001 — the customer's ONE credit id, reused for every future bill. */
  customer_code: string;
  name: string;
  phone: string | null;
  /** What they owe right now, across all their bills. */
  balance: number;
  is_active: boolean;
  created_at: string;
  /** How many credit bills they've run up. */
  bill_count: number;
  /** When they last put something on credit. */
  last_bill_at: string | null;
};

/** One credit bill under the account. */
export type CreditBill = {
  id: string;
  credit_number: string;
  bill_amount: number;
  down_payment: number;
  paid_amount: number;
  balance: number;
  status: CreditStatus;
  notes: string | null;
  created_at: string;
  payment_id: string | null;
  location: string;
};

/** One payment received against the account. */
export type CreditPaymentEntry = {
  id: string;
  amount: number;
  discount_amount: number;
  method: string;
  notes: string | null;
  staff_name: string | null;
  discount_by_name: string | null;
  created_at: string;
};

export type CreditCustomerDetail = CreditCustomer & {
  /** Total billed to this customer on credit, all time. */
  total_billed: number;
  /** Total collected from them, all time (down payments + repayments). */
  total_paid: number;
  bills: CreditBill[];
  payments: CreditPaymentEntry[];
};

export type CreditFilter = "all" | "owing" | "settled";

// PostgREST's `or()` is a comma-separated filter list, so commas/parens/wildcards
// in a raw search term would change the query's meaning. Strip them.
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
}

const RPC_ERRORS: Record<string, string> = {
  CUSTOMER_NOT_FOUND: "Customer not found.",
  CUSTOMER_NAME_REQUIRED: "Enter the customer's name.",
  INVALID_AMOUNT: "Enter a payment amount greater than zero.",
  NOTHING_OWED: "This customer is already fully settled — nothing is owed.",
  AMOUNT_EXCEEDS_BALANCE:
    "That's more than the outstanding balance. Enter the balance or less.",
  ALREADY_IMPORTED:
    "This customer already has an imported opening balance. Record a repayment instead, or edit the existing account.",
  FUTURE_DATE: "The credit date can't be in the future.",
};

function rpcError(message: string, fallback: string): string {
  for (const [code, text] of Object.entries(RPC_ERRORS)) {
    if (message.includes(code)) return text;
  }
  return fallback;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function locationOf(session: any): string {
  if (session?.restaurant_tables?.number) return `Table ${session.restaurant_tables.number}`;
  if (session?.rooms?.number) return `Room ${session.rooms.number}`;
  if (session?.type === "walk_in") return "Walk-in";
  return "—";
}

const ACCOUNT_SELECT =
  "id, customer_code, name, phone, balance, is_active, created_at, credits ( id, created_at )";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAccount(c: any): CreditCustomer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bills = (Array.isArray(c.credits) ? c.credits : []) as any[];
  const last = bills
    .map((b) => b.created_at)
    .sort()
    .pop();
  return {
    id: c.id,
    customer_code: c.customer_code,
    name: c.name,
    phone: c.phone ?? null,
    balance: Number(c.balance),
    is_active: c.is_active,
    created_at: c.created_at,
    bill_count: bills.length,
    last_bill_at: last ?? null,
  };
}

// ─── List / search accounts ───────────────────────────────────────────────────

export async function getCredits(params?: {
  search?: string | null;
  status?: CreditFilter;
}): Promise<CreditCustomer[]> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (service as any)
    .from("credit_customers")
    .select(ACCOUNT_SELECT)
    .eq("restaurant_id", ru.restaurant_id);

  const status = params?.status ?? "all";
  if (status === "owing") query = query.gt("balance", 0);
  else if (status === "settled") query = query.eq("balance", 0);

  const search = sanitizeSearch(params?.search ?? "");
  if (search) {
    // Phone first — it's the identifier a cashier actually has.
    query = query.or(
      `phone.ilike.%${search}%,name.ilike.%${search}%,customer_code.ilike.%${search}%`
    );
  }

  const { data } = await query.limit(200);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data ?? []) as any[]).map(toAccount);

  // Customers who owe money first — they're the ones needing chasing.
  return rows.sort((a, b) => {
    if ((b.balance > 0 ? 1 : 0) !== (a.balance > 0 ? 1 : 0)) {
      return (b.balance > 0 ? 1 : 0) - (a.balance > 0 ? 1 : 0);
    }
    return b.balance - a.balance || a.name.localeCompare(b.name);
  });
}

/**
 * Live search for the billing screen. Phone is the preferred lookup; a name
 * match also works. Returns the accounts the cashier can pick from so a
 * returning customer is never given a second Credit ID.
 */
export async function searchCreditCustomers(
  query: string
): Promise<CreditCustomer[]> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) return [];

  const search = sanitizeSearch(query);
  if (search.length < 2) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("credit_customers")
    .select(ACCOUNT_SELECT)
    .eq("restaurant_id", ru.restaurant_id)
    .eq("is_active", true)
    .or(`phone.ilike.%${search}%,name.ilike.%${search}%,customer_code.ilike.%${search}%`)
    .limit(8);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(toAccount);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const EMPTY_STATS: CreditStats = {
  outstanding: 0,
  collected: 0,
  created: 0,
  pendingCount: 0,
  fullyPaidCount: 0,
  openCount: 0,
};

export async function getCreditSummary(): Promise<CreditStats> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) return EMPTY_STATS;

  const service = createServiceClient();
  const [accountsRes, billsRes, paymentsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("credit_customers")
      .select("balance")
      .eq("restaurant_id", ru.restaurant_id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("credits")
      .select("bill_amount, down_payment, created_at")
      .eq("restaurant_id", ru.restaurant_id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("credit_payments")
      .select("amount, created_at")
      .eq("restaurant_id", ru.restaurant_id),
  ]);

  // "Today" here means the current BUSINESS day, so credit taken at 1am on a
  // 3am-closing restaurant counts against the night it was actually taken.
  const startOfToday = businessPeriodBounds("today", ru.closingHour).from.getTime();

  return computeCreditStats(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (accountsRes.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (billsRes.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (paymentsRes.data ?? []) as any[],
    startOfToday,
    Infinity
  );
}

// ─── Account detail: bills + payments ─────────────────────────────────────────

export async function getCreditDetail(
  customerId: string
): Promise<CreditCustomerDetail | { error: string }> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) {
    return { error: "You don't have permission to view credits." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: c } = await (service as any)
    .from("credit_customers")
    .select(ACCOUNT_SELECT)
    .eq("id", customerId)
    .eq("restaurant_id", ru.restaurant_id) // tenant isolation
    .maybeSingle();

  if (!c) return { error: "Customer not found." };

  const [billsRes, paymentsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("credits")
      .select(
        "id, credit_number, bill_amount, down_payment, paid_amount, balance, status, notes, created_at, payment_id, sessions ( type, restaurant_tables ( number ), rooms ( number ) )"
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("credit_payments")
      .select("id, amount, discount_amount, method, notes, received_by, discount_by, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const billRows = (billsRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payRows = (paymentsRes.data ?? []) as any[];

  const staffIds = [
    ...new Set(payRows.flatMap((p) => [p.received_by, p.discount_by]).filter(Boolean)),
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

  const bills: CreditBill[] = billRows.map((b) => ({
    id: b.id,
    credit_number: b.credit_number,
    bill_amount: Number(b.bill_amount),
    down_payment: Number(b.down_payment),
    paid_amount: Number(b.paid_amount),
    balance: Number(b.balance),
    status: b.status as CreditStatus,
    notes: b.notes ?? null,
    created_at: b.created_at,
    payment_id: b.payment_id ?? null,
    location: locationOf(b.sessions),
  }));

  return {
    ...toAccount(c),
    total_billed: bills.reduce((s, b) => s + b.bill_amount, 0),
    // What they've actually handed over: the down payments taken at billing plus
    // every repayment since.
    total_paid:
      bills.reduce((s, b) => s + b.down_payment, 0) +
      payRows.reduce((s, p) => s + Number(p.amount), 0),
    bills,
    payments: payRows.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      discount_amount: Number(p.discount_amount ?? 0),
      method: p.method,
      notes: p.notes ?? null,
      staff_name: p.received_by ? names.get(p.received_by) ?? null : null,
      discount_by_name: p.discount_by ? names.get(p.discount_by) ?? null : null,
      created_at: p.created_at,
    })),
  };
}

// ─── Take a payment against the account ───────────────────────────────────────
// The balance move + ledger row + FIFO allocation across the customer's open
// bills all happen inside `record_credit_payment`, so two cashiers taking money
// from the same customer at once can't both write from a stale balance.

const REPAYMENT_METHODS = new Set(["cash", "online", "card", "mixed"]);

export async function addCreditPayment(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) {
    return { error: "You don't have permission to record credit payments." };
  }

  const customerId = formData.get("customer_id") as string;
  const amountRaw = formData.get("amount") as string;
  const discountRaw = formData.get("discount") as string;
  const method = ((formData.get("method") as string) || "cash").toLowerCase();
  const notes = ((formData.get("notes") as string) || "").trim();

  const amount = amountRaw === "" || amountRaw == null ? 0 : parseFloat(amountRaw);
  const discount = discountRaw === "" || discountRaw == null ? 0 : parseFloat(discountRaw);

  if (!customerId) return { error: "Customer not found." };
  if (isNaN(amount) || amount < 0) {
    return { error: "Enter an amount received of zero or more." };
  }
  if (isNaN(discount) || discount < 0) {
    return { error: "The discount cannot be negative." };
  }
  if (amount + discount <= 0) {
    return { error: "Enter a payment amount or a discount greater than zero." };
  }
  if (!REPAYMENT_METHODS.has(method)) return { error: "Invalid payment method." };

  if (discount > 0) {
    if (!hasPermission(ru, PERMISSIONS.APPLY_DISCOUNTS)) {
      return { error: "You don't have permission to apply a discount." };
    }
    const pin = ((formData.get("discount_pin") as string) || "").trim();
    if (!pin) return { error: "Enter the discount PIN to apply a discount." };

    const service = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pinOk, error: pinErr } = await (service as any).rpc("verify_discount_pin", {
      p_restaurant_id: ru.restaurant_id,
      p_pin: pin,
    });
    if (pinErr || pinOk !== true) {
      return { error: "Incorrect discount PIN. The discount was not applied." };
    }
  }

  const split = resolveSplit(
    method,
    amount,
    formData.get("cash_amount") as string | null,
    formData.get("online_amount") as string | null
  );
  if (!split.ok) return { error: split.error };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("record_credit_payment", {
    p_restaurant_id: ru.restaurant_id, // tenant scope re-checked inside the RPC
    p_customer_id: customerId,
    p_amount: amount,
    p_method: method,
    p_notes: notes || null,
    p_received_by: ru.id,
    p_cash: split.cash,
    p_online: split.online,
    p_discount: discount,
    p_discount_by: discount > 0 ? ru.id : null,
  });

  if (error) {
    return { error: rpcError(error.message ?? "", "Could not record the payment. Please try again.") };
  }

  revalidatePath("/employee/credits");
  revalidatePath("/employee/dashboard");
  revalidatePath("/employee/sales");
  // Credits live only on the staff surface — there is no /admin/credits route.
  // A repayment does move Finance, though: the receivable falls, and a write-off
  // lands in the Discounts block.
  revalidatePath("/admin/finance");
  return null;
}

// ─── Credit receipt ───────────────────────────────────────────────────────────

export type CreditReceipt = {
  customer: CreditCustomerDetail;
  restaurant: {
    name: string;
    address: string | null;
    contact_phone: string | null;
    pan_vat_number: string | null;
    /** Thermal roll width. Without it the receipt silently printed at 80mm on every
     *  restaurant configured for 58mm — see getCreditReceipt. */
    paper_width_mm: 58 | 80;
  };
};

export async function getCreditReceipt(
  customerId: string
): Promise<CreditReceipt | { error: string }> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canManageCredits(ru)) {
    return { error: "You don't have permission to view credits." };
  }

  const customer = await getCreditDetail(customerId);
  if ("error" in customer) return customer;

  // Use the shared, cached config rather than a private query. The private one selected
  // four columns and so never saw `settings.print_paper_width` — which is exactly how this
  // receipt ended up printing at 80mm for restaurants set to 58mm while all their other
  // tickets were right. Going through getRestaurantConfig also means it now picks up a
  // settings change through the same invalidation path as every other printed document.
  const rest = await getRestaurantConfig(ru.restaurant_id);

  return {
    customer,
    restaurant: {
      name: rest.name,
      address: rest.address,
      contact_phone: rest.contact_phone,
      pan_vat_number: rest.pan_vat_number,
      paper_width_mm: rest.paper_width_mm,
    },
  };
}

// ─── Import a credit that predates this system ────────────────────────────────
// A restaurant arrives with a paper book of who owes what. Those debts must be
// chaseable here, but they are NOT sales this system made — so the import writes
// ONE credit account with an opening balance and no bill, leaving Sales
// untouched. See supabase/migrations/20260721200000_import_credit_customer.sql.
//
// Gated like the opening-balance seed on the same screen rather than like an
// ordinary credit action: this conjures a receivable out of nothing, which is a
// books-opening decision, not day-to-day cashiering.

export async function importCreditCustomer(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru) || !STOCK_ACCESS.canViewFinance(ru)) {
    return { error: "You don't have permission to import customer credits." };
  }

  const name = ((formData.get("name") as string) || "").trim();
  const phone = ((formData.get("phone") as string) || "").trim();
  const notes = ((formData.get("notes") as string) || "").trim();
  const amountRaw = ((formData.get("amount") as string) || "").trim();
  const dateRaw = ((formData.get("credit_date") as string) || "").trim();

  if (!name) return { error: "Enter the customer's name." };

  const amount = amountRaw === "" ? NaN : parseFloat(amountRaw);
  if (isNaN(amount) || amount <= 0) {
    return { error: "Enter the amount they owe — greater than zero." };
  }
  if (!dateRaw) return { error: "Choose the date the credit was given." };

  // Parsed as LOCAL midnight: `new Date("YYYY-MM-DD")` is UTC and would shift
  // the debt to the previous day for anyone east of Greenwich.
  const when = new Date(`${dateRaw}T00:00:00`);
  if (isNaN(when.getTime())) return { error: "Invalid date." };
  if (when.getTime() > Date.now()) return { error: "The credit date can't be in the future." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("import_credit_customer", {
    p_restaurant_id: ru.restaurant_id, // tenant scope re-checked inside the RPC
    p_name: name,
    p_phone: phone || null,
    p_amount: amount,
    p_created_at: when.toISOString(),
    p_notes: notes || null,
    p_created_by: ru.id,
  });

  if (error) {
    return {
      error: rpcError(
        error.message ?? "",
        "Could not import the credit. Please try again."
      ),
    };
  }

  revalidatePath("/admin/finance");
  revalidatePath("/employee/credits");
  revalidatePath("/employee/dashboard");
  return null;
}
