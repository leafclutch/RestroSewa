"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { resolveSplit, WITH_MIXED } from "@/lib/payment-split";

export type ActionResult = { error: string } | null;

// ─── Types ────────────────────────────────────────────────────────────────────

export type VendorRow = {
  id: string;
  vendor_code: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  opening_credit: number;
  /** What we still owe this vendor right now. */
  credit_balance: number;
  is_active: boolean;
  created_at: string;
};

/**
 * One line of a vendor's account history. `opening` and `purchase` RAISE what we
 * owe; `payment` lowers it — so the three together always explain the balance.
 */
export type VendorLedgerEntry = {
  id: string;
  kind: "opening" | "purchase" | "payment";
  amount: number;
  method: string | null;
  notes: string | null;
  staff_name: string | null;
  created_at: string;
  /** Set on `purchase` entries — the bill this debt came from. */
  purchase_code?: string;
};

export type VendorDetail = VendorRow & {
  created_by_name: string | null;
  /** Total paid to this vendor, all time. */
  total_paid: number;
  /** Total ever bought from them, at bill value (cash + online + credit). */
  total_purchased: number;
  history: VendorLedgerEntry[];
};

export type VendorFilter = "all" | "owing" | "settled" | "inactive";

export type VendorSummary = {
  total: number;
  activeCount: number;
  /** Total owed across every active vendor. */
  outstanding: number;
  owingCount: number;
};

const VENDOR_SELECT =
  "id, vendor_code, name, phone, address, notes, opening_credit, credit_balance, is_active, created_at, created_by";

// PostgREST's `or()` is a comma-separated filter list, so commas/parens/wildcards
// in a raw search term would change the query's meaning. Strip them — none are
// meaningful in a supplier name, phone number or vendor code.
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(s: any): VendorRow {
  return {
    id: s.id,
    vendor_code: s.vendor_code,
    name: s.name,
    phone: s.phone ?? null,
    address: s.address ?? null,
    notes: s.notes ?? null,
    opening_credit: Number(s.opening_credit),
    credit_balance: Number(s.credit_balance),
    is_active: s.is_active,
    created_at: s.created_at,
  };
}

// ─── List / Search ────────────────────────────────────────────────────────────
// Self-authing: derives the restaurant from the session, so the client can
// re-query on every keystroke without ever supplying a restaurant id.

export async function getVendors(params?: {
  search?: string | null;
  filter?: VendorFilter;
}): Promise<VendorRow[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewStock(ru)) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (service as any)
    .from("vendors")
    .select(VENDOR_SELECT)
    .eq("restaurant_id", ru.restaurant_id);

  const filter = params?.filter ?? "all";
  if (filter === "owing") query = query.eq("is_active", true).gt("credit_balance", 0);
  else if (filter === "settled") query = query.eq("is_active", true).eq("credit_balance", 0);
  else if (filter === "inactive") query = query.eq("is_active", false);
  else query = query.eq("is_active", true); // "all" = all ACTIVE vendors

  const search = sanitizeSearch(params?.search ?? "");
  if (search) {
    query = query.or(
      `vendor_code.ilike.%${search}%,name.ilike.%${search}%,phone.ilike.%${search}%`
    );
  }

  const { data } = await query.order("name").limit(500);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data ?? []) as any[]).map(toRow);

  // Vendors we owe money to float to the top — they're the ones needing action.
  return rows.sort((a, b) => {
    if ((b.credit_balance > 0 ? 1 : 0) !== (a.credit_balance > 0 ? 1 : 0)) {
      return (b.credit_balance > 0 ? 1 : 0) - (a.credit_balance > 0 ? 1 : 0);
    }
    return a.name.localeCompare(b.name);
  });
}

export async function getVendorSummary(): Promise<VendorSummary> {
  const ru = await getRestaurantUser();
  const empty = { total: 0, activeCount: 0, outstanding: 0, owingCount: 0 };
  if (!STOCK_ACCESS.canViewStock(ru)) return empty;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("vendors")
    .select("credit_balance, is_active")
    .eq("restaurant_id", ru.restaurant_id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  const summary = { ...empty, total: rows.length };
  for (const s of rows) {
    if (!s.is_active) continue;
    summary.activeCount += 1;
    const bal = Number(s.credit_balance);
    if (bal > 0) {
      summary.outstanding += bal;
      summary.owingCount += 1;
    }
  }
  return summary;
}

// ─── Detail (full account history) ────────────────────────────────────────────

export async function getVendorDetail(
  vendorId: string
): Promise<VendorDetail | { error: string }> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewStock(ru)) {
    return { error: "You don't have permission to view vendors." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: s } = await (service as any)
    .from("vendors")
    .select(VENDOR_SELECT)
    .eq("id", vendorId)
    .eq("restaurant_id", ru.restaurant_id) // tenant isolation
    .maybeSingle();

  if (!s) return { error: "Vendor not found." };

  const [paymentsRes, purchasesRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("vendor_payments")
      .select("id, amount, method, notes, paid_by, created_at")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true }),
    // Purchases are the other half of the account: a credit purchase is what
    // RAISED the balance, so the history is unreadable without them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("purchases")
      .select("id, purchase_code, payment_method, total_amount, credit_amount, notes, created_by, created_at")
      .eq("vendor_id", vendorId)
      .eq("restaurant_id", ru.restaurant_id)
      .order("created_at", { ascending: true }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payRows = (paymentsRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buyRows = (purchasesRes.data ?? []) as any[];

  const staffIds = [
    ...new Set(
      [
        ...payRows.map((p) => p.paid_by),
        ...buyRows.map((b) => b.created_by),
        s.created_by,
      ].filter(Boolean)
    ),
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

  const row = toRow(s);
  const history: VendorLedgerEntry[] = [];

  // Dues carried over from the paper ledger open the account.
  if (row.opening_credit > 0) {
    history.push({
      id: `${row.id}-opening`,
      kind: "opening",
      amount: row.opening_credit,
      method: null,
      notes: "Dues carried over when the vendor was added",
      staff_name: s.created_by ? names.get(s.created_by) ?? null : null,
      created_at: row.created_at,
    });
  }

  // Only the CREDIT part of a purchase moves this account — a cash purchase was
  // settled on the spot and owes nothing, so it must not appear as a debt.
  for (const b of buyRows) {
    const owed = Number(b.credit_amount);
    if (owed <= 0) continue;
    history.push({
      id: b.id,
      kind: "purchase",
      amount: owed,
      method: b.payment_method,
      notes: b.notes ?? null,
      staff_name: b.created_by ? names.get(b.created_by) ?? null : null,
      created_at: b.created_at,
      purchase_code: b.purchase_code,
    });
  }

  for (const p of payRows) {
    history.push({
      id: p.id,
      kind: "payment",
      amount: Number(p.amount),
      method: p.method,
      notes: p.notes ?? null,
      staff_name: p.paid_by ? names.get(p.paid_by) ?? null : null,
      created_at: p.created_at,
    });
  }

  // One chronological account, oldest first — opening, then every purchase and
  // payment interleaved, so the running balance can be followed down the page.
  history.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return {
    ...row,
    created_by_name: s.created_by ? names.get(s.created_by) ?? null : null,
    total_paid: payRows.reduce((sum, p) => sum + Number(p.amount), 0),
    total_purchased: buyRows.reduce((sum, b) => sum + Number(b.total_amount), 0),
    history,
  };
}

// ─── Create ───────────────────────────────────────────────────────────────────

// The RPCs signal refusals with bare codes; turn those into something the admin
// can act on rather than leaking a Postgres exception.
const RPC_ERRORS: Record<string, string> = {
  VENDOR_EXISTS:
    "A vendor with this name already exists. Reuse that account for this purchase instead of creating a second one.",
  NAME_REQUIRED: "Enter the vendor's name.",
  INVALID_OPENING_CREDIT: "Opening credit cannot be negative.",
  VENDOR_NOT_FOUND: "Vendor not found.",
  INVALID_AMOUNT: "Enter a payment amount greater than zero.",
  NOTHING_OWED: "This vendor is already fully settled — nothing is owed.",
  AMOUNT_EXCEEDS_BALANCE:
    "That's more than the outstanding balance. Enter the balance or less.",
};

function rpcError(message: string, fallback: string): string {
  for (const [code, text] of Object.entries(RPC_ERRORS)) {
    if (message.includes(code)) return text;
  }
  return fallback;
}

export async function createVendor(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru)) {
    return { error: "You don't have permission to manage vendors." };
  }

  const name = ((formData.get("name") as string) || "").trim();
  const phone = ((formData.get("phone") as string) || "").trim();
  const address = ((formData.get("address") as string) || "").trim();
  const notes = ((formData.get("notes") as string) || "").trim();
  const openingRaw = (formData.get("opening_credit") as string) || "";
  const openingCredit = openingRaw === "" ? 0 : parseFloat(openingRaw);

  if (!name) return { error: "Enter the vendor's name." };
  if (isNaN(openingCredit) || openingCredit < 0) {
    return { error: "Opening credit must be zero or more." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("create_vendor", {
    p_restaurant_id: ru.restaurant_id,
    p_name: name,
    p_phone: phone || null,
    p_address: address || null,
    p_notes: notes || null,
    p_opening_credit: openingCredit,
    p_created_by: ru.id,
  });

  if (error) {
    return { error: rpcError(error.message ?? "", "Could not create the vendor. Please try again.") };
  }

  revalidatePath("/admin/vendors");
  return null;
}

// ─── Update ───────────────────────────────────────────────────────────────────
// Contact details only. The credit balance is never editable by hand — it moves
// solely through purchases and payments, so the audit trail always explains it.

export async function updateVendor(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru)) {
    return { error: "You don't have permission to manage vendors." };
  }

  const id = formData.get("id") as string;
  const name = ((formData.get("name") as string) || "").trim();
  const phone = ((formData.get("phone") as string) || "").trim();
  const address = ((formData.get("address") as string) || "").trim();
  const notes = ((formData.get("notes") as string) || "").trim();

  if (!id) return { error: "Vendor not found." };
  if (!name) return { error: "Enter the vendor's name." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("vendors")
    .update({
      name,
      phone: phone || null,
      address: address || null,
      notes: notes || null,
    })
    .eq("id", id)
    .eq("restaurant_id", ru.restaurant_id); // tenant isolation

  if (error) {
    // The unique index on (restaurant_id, lower(name)) fired.
    if (error.code === "23505") {
      return { error: "Another vendor already uses this name." };
    }
    return { error: "Could not update the vendor. Please try again." };
  }

  revalidatePath("/admin/vendors");
  return null;
}

// ─── Deactivate / reactivate ──────────────────────────────────────────────────
// Vendors are never deleted — purchases reference them, and deleting one would
// tear a hole in the purchase history. Deactivating just hides them from pickers.

export async function setVendorActive(
  vendorId: string,
  isActive: boolean
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru)) {
    return { error: "You don't have permission to manage vendors." };
  }

  const service = createServiceClient();

  if (!isActive) {
    // Hiding a vendor we still owe money to would make the debt invisible.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: s } = await (service as any)
      .from("vendors")
      .select("credit_balance")
      .eq("id", vendorId)
      .eq("restaurant_id", ru.restaurant_id)
      .maybeSingle();
    if (!s) return { error: "Vendor not found." };
    if (Number(s.credit_balance) > 0) {
      return {
        error: "This vendor still has an outstanding balance. Settle it before deactivating them.",
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("vendors")
    .update({ is_active: isActive })
    .eq("id", vendorId)
    .eq("restaurant_id", ru.restaurant_id);

  if (error) return { error: "Could not update the vendor. Please try again." };

  revalidatePath("/admin/vendors");
  return null;
}

// ─── Pay a vendor ─────────────────────────────────────────────────────────────

const PAYMENT_METHODS = new Set(WITH_MIXED);

export async function payVendor(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru)) {
    return { error: "You don't have permission to pay vendors." };
  }

  const vendorId = formData.get("vendor_id") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const method = ((formData.get("method") as string) || "cash").toLowerCase();
  const notes = ((formData.get("notes") as string) || "").trim();

  if (!vendorId) return { error: "Vendor not found." };
  if (isNaN(amount) || amount <= 0) {
    return { error: "Enter a payment amount greater than zero." };
  }
  if (!PAYMENT_METHODS.has(method as (typeof WITH_MIXED)[number])) {
    return { error: "Invalid payment method." };
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
  const { error } = await (service as any).rpc("record_vendor_payment", {
    p_restaurant_id: ru.restaurant_id, // tenant scope re-checked inside the RPC
    p_vendor_id: vendorId,
    p_amount: amount,
    p_method: method,
    p_notes: notes || null,
    p_paid_by: ru.id,
    p_cash: split.cash,
    p_online: split.online,
  });

  if (error) {
    return { error: rpcError(error.message ?? "", "Could not record the payment. Please try again.") };
  }

  revalidatePath("/admin/vendors");
  return null;
}
