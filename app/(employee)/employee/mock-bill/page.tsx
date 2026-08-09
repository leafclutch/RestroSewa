import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type { MockBillSeed } from "@/lib/mock-bill/draft";
import { MockBillClient } from "./_components/mock-bill-client";

// A REAL route, unlike /employee/sales and the other /employee/* stubs that now redirect
// into the single-page dashboard. Mock billing is a full-screen workspace with its own
// scroll, its own print modal and no relationship to the live floor — folding it into the
// dashboard would put a demo tool in the middle of the working board.
//
// This page renders only the LOCKED shell. The editor itself is mounted by client state
// that nothing but a server-verified Security PIN can set, so there is no URL — this one
// included — that reaches the editor without the PIN.

export default async function MockBillPage() {
  const { restaurantUser } = await requireRestaurantStaff();
  const config = await getRestaurantConfig(restaurantUser.restaurant_id);

  // Two gates before the PIN is even offered, both re-checked inside `unlockMockBill`:
  // this feature's own permission, and the standing "no PIN ⇒ no gated path" rule shared
  // with the discount PIN and the sensitive-edit flows.
  if (!hasPermission(restaurantUser, PERMISSIONS.PRINT_MOCK_BILLS) || !config.securityEnabled) {
    redirect("/employee/dashboard");
  }

  // The restaurant's REAL header/settings, used only to pre-fill the editor so a demo
  // starts out looking like this restaurant's own bill. Everything is editable after that.
  const seed: MockBillSeed = {
    name: config.name,
    address: config.address,
    contact_phone: config.contact_phone,
    pan_vat_number: config.pan_vat_number,
    paper_width_mm: config.paper_width_mm,
    bill_number_label: config.bill_number_label,
    tax_percent: config.tax_percent,
    service_charge_percent: config.service_charge_percent,
  };

  return <MockBillClient seed={seed} staffName={restaurantUser.display_name} />;
}
