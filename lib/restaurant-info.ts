import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { tenantCache, revalidateTenant, CACHE } from "@/lib/cache/tenant-cache";

/**
 * The restaurant's own header/config, cached across requests.
 *
 * This row is read on the session screen, the room folio, every printed document and on
 * the path of opening a table — and it changes when an admin edits Settings, i.e. roughly
 * never. It was costing a full network round trip every single time.
 *
 * TTL IS 60s, NOT 5 MINUTES, and the reason is money: `tax_percent` and
 * `service_charge_percent` end up on a printed customer receipt. Every write path calls
 * `revalidateRestaurantInfo`, so 60s is only the backstop for a mutation someone forgets
 * to wire up — short enough that the wrong tax rate can't outlive a single table's meal.
 *
 * `discount_pin_hash` NEVER leaves this function. It is collapsed to a boolean here, so a
 * password hash cannot end up in Vercel's Data Cache (shared across regions, persists
 * across deploys) nor be serialised toward a client component.
 */
export type RestaurantConfig = {
  name: string;
  address: string | null;
  contact_phone: string | null;
  pan_vat_number: string | null;
  logo_url: string | null;
  qr_mode: string;
  paper_width_mm: 58 | 80;
  bill_number_pad: number;
  bill_number_label: "bill" | "order";
  tax_percent: number | undefined;
  service_charge_percent: number | undefined;
  /** Whether an admin has set a discount PIN. The hash itself never leaves the server. */
  discountEnabled: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function numFromSettings(settings: any, ...keys: string[]): number | undefined {
  if (!settings || typeof settings !== "object") return undefined;
  for (const k of keys) {
    const v = Number(settings[k]);
    if (!Number.isNaN(v) && v > 0) return v;
  }
  return undefined;
}

export async function getRestaurantConfig(restaurantId: string): Promise<RestaurantConfig> {
  return tenantCache(
    CACHE.restaurantInfo,
    restaurantId,
    async () => {
      const service = createServiceClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rest } = await (service as any)
        .from("restaurants")
        .select("name, address, contact_phone, pan_vat_number, logo_url, settings, qr_mode, discount_pin_hash")
        .eq("id", restaurantId)
        .maybeSingle();

      const s = rest?.settings;
      return {
        name: rest?.name ?? "Restaurant",
        address: rest?.address ?? null,
        contact_phone: rest?.contact_phone ?? null,
        pan_vat_number: rest?.pan_vat_number ?? null,
        logo_url: rest?.logo_url ?? null,
        qr_mode: rest?.qr_mode ?? "ordering_enabled",
        paper_width_mm: s?.print_paper_width === "58" ? 58 : 80,
        bill_number_pad: Number.isFinite(Number(s?.bill_number_pad)) ? Number(s?.bill_number_pad) : 0,
        bill_number_label: s?.bill_number_label === "order" ? "order" : "bill",
        tax_percent: numFromSettings(s, "tax_percent", "tax_rate", "gst_percent"),
        service_charge_percent: numFromSettings(s, "service_charge_percent", "service_charge"),
        discountEnabled: !!rest?.discount_pin_hash,
      } satisfies RestaurantConfig;
    },
    { revalidate: 60 }
  );
}

/**
 * Call from EVERY write that touches a field selected above. Complete list as audited:
 * settings.ts (billing settings, business day, discount PIN), branding.ts (logo set +
 * clear, via revalidateBranding), restaurants.ts (create/activate/update),
 * workstations.ts (paper width).
 *
 * NOTE the field list is doing real work. `bill_number_next` is deliberately NOT selected,
 * which is why the trigger that bumps it on EVERY SINGLE ORDER
 * (20260716140000_session_bill_number.sql) needs no invalidation and cannot thrash this
 * cache. Three of the five DB functions that write to `restaurants` touch only that
 * column. If you ever add `bill_number_next` here, that stops being true and the cache
 * becomes worse than useless.
 *
 * The one write that ISN'T a `.from("restaurants").update(` is `set_discount_pin`, an RPC
 * — so a grep alone would have missed it. Grep for `update restaurants` in
 * supabase/migrations too when adding fields.
 */
export function revalidateRestaurantInfo(restaurantId: string): void {
  revalidateTenant(CACHE.restaurantInfo, restaurantId);
}
