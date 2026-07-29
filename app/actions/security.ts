"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { requireRestaurantAdmin, requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { revalidateRestaurantInfo } from "@/lib/restaurant-info";
import {
  verifySecurityPin,
  logSecurityEvent,
  getSecurityAuditRows,
  type SecurityAuditRow,
} from "@/lib/security/authorize";

export type ActionResult = { error: string } | { ok: true } | null;

// ─── Security PIN (Admin → Settings) ──────────────────────────────────────────
// Independent of the discount PIN. Belongs only to the restaurant admin; it is never
// shared with staff and gates sensitive financial edits. Write-only: hashed in the DB,
// never read back — this form can only SET a new one or REMOVE it.

export async function getSecurityPinStatus(): Promise<{ securityPinSet: boolean }> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("security_pin_hash")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();
  // Collapsed to a boolean HERE, server-side — the hash must never reach the client.
  return { securityPinSet: !!data?.security_pin_hash };
}

export async function updateSecurityPin(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const clearing = formData.get("clear_pin") === "1";
  const pin = ((formData.get("security_pin") as string) || "").trim();

  if (!clearing) {
    // Same 4-digit shape as the staff-login and discount PINs.
    if (!/^\d{4}$/.test(pin)) return { error: "The Security PIN must be exactly 4 digits." };
    const confirm = ((formData.get("security_pin_confirm") as string) || "").trim();
    if (confirm !== pin) return { error: "The two PINs don't match." };
  }

  // Straight into set_security_pin, which hashes it (bcrypt) inside the DB. Never stored,
  // logged or returned in plaintext.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("set_security_pin", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_pin: clearing ? null : pin,
  });
  if (error) return { error: "Could not save the Security PIN. Please try again." };

  // Written by the DB function, not a .update() — so it's the invalidation a grep for
  // `.from("restaurants").update(` would miss. Setting/clearing flips `securityEnabled`,
  // which the edit surfaces read to decide whether the Edit action can work at all.
  revalidateRestaurantInfo(restaurantUser.restaurant_id);
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function getSecurityAuditLog(limit = 50): Promise<SecurityAuditRow[]> {
  const { restaurantUser } = await requireRestaurantAdmin();
  return getSecurityAuditRows(restaurantUser.restaurant_id, limit);
}

// ─── Gated edits ──────────────────────────────────────────────────────────────
// Each sensitive edit is admin-only (requireRestaurantAdmin) AND Security-PIN-gated. The
// PIN is verified first (logging a failure if wrong); on success the op's RPC performs the
// change and logs the success snapshot atomically; a post-auth refusal is logged as blocked.

// Friendly text for the bare coded errors the edit RPCs raise.
const EDIT_ERRORS: Record<string, string> = {
  PAYMENT_NOT_FOUND: "That payment no longer exists.",
  CANNOT_EDIT_CREDIT_PAYMENT: "Credit bills are settled in the Credits screen, not here.",
  SPLIT_MISMATCH: "The cash, online and card amounts must add up to the bill total.",
  INVALID_AMOUNT: "Amounts can't be negative.",
  PURCHASE_NOT_FOUND: "That purchase no longer exists.",
  VENDOR_NOT_FOUND: "That vendor no longer exists.",
  VENDOR_INACTIVE: "That vendor is inactive — reactivate it first.",
  NO_ITEMS: "Add at least one item.",
  INVALID_QUANTITY: "Every item needs a quantity greater than zero.",
  INVALID_UNIT_COST: "Unit cost can't be negative.",
  PRODUCT_NOT_FOUND: "One of the products no longer exists.",
  INVALID_TOTAL: "The purchase total must be greater than zero.",
  INVALID_METHOD: "Choose a valid payment method.",
  NOTHING_ON_CREDIT: "A credit purchase must leave something owing — reduce the amount paid now.",
  VENDOR_BALANCE_NEGATIVE:
    "This change would leave the vendor overpaid — you've already paid more toward this vendor than the new amount owed. Adjust the vendor's payments first.",
};

function friendlyEditError(raw: string | undefined): string {
  const msg = raw ?? "";
  for (const code of Object.keys(EDIT_ERRORS)) {
    if (msg.includes(code)) return EDIT_ERRORS[code];
  }
  return "Could not save the change. Please try again.";
}

export type PaymentTender = {
  total: number;
  cash: number;
  online: number;
  card: number;
  method: string;
};

// The current tender of a completed payment, for prefilling the edit dialog. Billing staff
// (process_payments) and admins — same gate as saving the edit below.
export async function getPaymentTender(
  paymentId: string
): Promise<PaymentTender | { error: string }> {
  const { restaurantUser } = await requireRestaurantStaff();
  if (!hasPermission(restaurantUser, PERMISSIONS.PROCESS_PAYMENTS)) {
    return { error: "You don't have permission to edit payments." };
  }
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("payments")
    .select("amount, total_amount, cash_amount, online_amount, card_amount, payment_method")
    .eq("id", paymentId)
    .eq("restaurant_id", restaurantUser.restaurant_id)
    .maybeSingle();

  if (!data) return { error: "That payment no longer exists." };
  return {
    total: Number(data.total_amount ?? data.amount ?? 0),
    cash: Number(data.cash_amount ?? 0),
    online: Number(data.online_amount ?? 0),
    card: Number(data.card_amount ?? 0),
    method: data.payment_method,
  };
}

// Editing HOW a completed bill was paid (the cash/online/card split). Open to billing staff
// (process_payments), not just the admin — but still gated by the Security PIN, and every
// attempt (including a wrong PIN) is logged with the actor. Admin passes the permission check.
export async function updatePaymentTender(
  pin: string,
  paymentId: string,
  split: { cash: number; online: number; card: number }
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantStaff();
  if (!hasPermission(restaurantUser, PERMISSIONS.PROCESS_PAYMENTS)) {
    return { error: "You don't have permission to edit payments." };
  }

  const authorized = await verifySecurityPin(restaurantUser, "edit_payment_tender", pin, {
    type: "payment",
    id: paymentId,
  });
  if (!authorized) return { error: "Incorrect Security PIN." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("edit_payment_tender", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_actor_id: restaurantUser.id,
    p_actor_name: restaurantUser.display_name ?? null,
    p_payment_id: paymentId,
    p_cash: split.cash,
    p_online: split.online,
    p_card: split.card,
  });

  if (error) {
    // PIN was right but the edit was refused — record the attempt.
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "edit_payment_tender",
      targetType: "payment",
      targetId: paymentId,
      outcome: "blocked",
      detail: { code: error.message },
    });
    return { error: friendlyEditError(error.message) };
  }

  for (const p of ["/admin/finance", "/admin/dashboard", "/employee/sales", "/employee/dashboard"]) {
    revalidatePath(p);
  }
  return { ok: true };
}

export type PurchaseEditInput = {
  vendorId: string;
  method: "cash" | "online" | "credit" | "mixed";
  cash: number;
  online: number;
  items: { product_id: string; quantity: number; unit_cost: number }[];
  notes: string | null;
};

export async function updatePurchase(
  pin: string,
  purchaseId: string,
  input: PurchaseEditInput
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();

  const authorized = await verifySecurityPin(restaurantUser, "edit_purchase", pin, {
    type: "purchase",
    id: purchaseId,
  });
  if (!authorized) return { error: "Incorrect Security PIN." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("edit_purchase", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_actor_id: restaurantUser.id,
    p_actor_name: restaurantUser.display_name ?? null,
    p_purchase_id: purchaseId,
    p_vendor_id: input.vendorId,
    p_method: input.method,
    p_cash: input.cash,
    p_online: input.online,
    p_items: input.items,
    p_notes: input.notes,
  });

  if (error) {
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "edit_purchase",
      targetType: "purchase",
      targetId: purchaseId,
      outcome: "blocked",
      detail: { code: error.message },
    });
    return { error: friendlyEditError(error.message) };
  }

  for (const p of ["/admin/purchases", "/admin/stock", "/admin/finance", "/admin/dashboard"]) {
    revalidatePath(p);
  }
  return { ok: true };
}
