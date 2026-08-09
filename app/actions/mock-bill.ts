"use server";

import { requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { verifySecurityPin, logSecurityEvent } from "@/lib/security/authorize";

/**
 * ── THE ENTIRE SERVER SURFACE OF THE MOCK BILL FEATURE ────────────────────────
 *
 * One function, and all it does is check a PIN.
 *
 * That is the isolation guarantee, stated as code rather than as a promise. A mock bill
 * must never deduct stock, create an order or a KOT/BOT, book a sale, move finance, touch
 * a customer or vendor balance, burn a bill or OT number, ring a push or land in the daily
 * email. The reliable way to ensure that is not to audit a large module for stray writes —
 * it is for the module to have no way to write at all. So this file:
 *
 *   • constructs no Supabase client, and calls no RPC;
 *   • imports nothing from `app/actions/pos|stock|finance|purchases|credits|notifications`;
 *   • exports exactly one function, which returns a boolean-shaped result.
 *
 * `lib/mock-bill/isolation.test.ts` asserts each of those against this file's source, so a
 * later edit that reaches for the POS fails verification instead of quietly shipping.
 *
 * The only row this feature ever writes is an audit row in `security_audit_log` — a table
 * no financial, stock or sales report reads.
 */

export type UnlockResult = { ok: true } | { error: string };

/**
 * Authorize opening the Mock Billing screen.
 *
 * The gate is deliberately the same reusable Security-PIN service that authorizes editing a
 * completed payment (`decisions.md` → "Security PIN & sensitive edits"): a mock bill prints
 * indistinguishably from a real one, so producing one is a trusted act even though it
 * changes nothing.
 *
 * Three checks, all server-side and all audited:
 *   1. an active staff session (the layout's guard, re-run here — client gating is only
 *      ever convenience in this codebase);
 *   2. `print_mock_bills`, this feature's own permission (granted per staff member in the
 *      super-admin surface, and off every job preset on purpose);
 *   3. the restaurant's Security PIN. **No PIN ⇒ no mock bills** — the same "no un-gated
 *      path" rule the discount PIN and the sensitive-edit flows follow.
 */
export async function unlockMockBill(pin: string): Promise<UnlockResult> {
  const { restaurantUser } = await requireRestaurantStaff();

  // Its OWN permission, not a rider on close_bills: producing a receipt indistinguishable
  // from a real one is a distinct act from settling a real table, and a demo/sales account
  // should be grantable with this and nothing else. Logged as `blocked` (not `failure`) so
  // the audit distinguishes "wrong PIN" from "right PIN, wrong person".
  if (!hasPermission(restaurantUser, PERMISSIONS.PRINT_MOCK_BILLS)) {
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "open_mock_bill",
      targetType: "mock_bill",
      targetId: null,
      outcome: "blocked",
      detail: { reason: "missing_print_mock_bills" },
    });
    return { error: "You don't have permission to open mock billing." };
  }

  const config = await getRestaurantConfig(restaurantUser.restaurant_id);
  if (!config.securityEnabled) {
    return { error: "Mock billing is off. Ask your admin to set a Security PIN in Settings." };
  }

  // Verifies against the bcrypt hash inside the DB and writes the `failure` audit row
  // itself when the PIN is wrong or absent.
  const ok = await verifySecurityPin(restaurantUser, "open_mock_bill", pin, {
    type: "mock_bill",
    id: null,
  });
  if (!ok) return { error: "That Security PIN is not correct." };

  // Success is logged here rather than inside an RPC because there IS no RPC — nothing is
  // written, so there is no transaction to be atomic with. (Contrast the payment/purchase
  // edits, whose success row is written inside their own edit function.)
  await logSecurityEvent({
    restaurantId: restaurantUser.restaurant_id,
    actor: restaurantUser,
    operation: "open_mock_bill",
    targetType: "mock_bill",
    targetId: null,
    outcome: "success",
  });

  return { ok: true };
}
