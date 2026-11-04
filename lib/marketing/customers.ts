import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export type LiveCustomer = { name: string; logoUrl: string | null; type: string | null };

/**
 * Paying, active restaurants for the public landing page's "who uses it" strip.
 *
 * `free` tier accounts are test/demo installs and are deliberately excluded, as are deactivated
 * ones. Only the public-facing bits (name, logo, type) are selected — nothing else about a tenant
 * ever reaches the marketing page. A failure returns an empty list so the landing page still
 * renders (the strip just hides) rather than erroring for every visitor.
 */
export async function getLiveCustomers(): Promise<LiveCustomer[]> {
  try {
    const service = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (service as any)
      .from("restaurants")
      .select("name, logo_url, type")
      .eq("is_active", true)
      .in("subscription_tier", ["basic", "pro"])
      .order("created_at", { ascending: true })
      .limit(60);
    if (error) return [];
    return ((data ?? []) as Array<{ name: string; logo_url: string | null; type: string | null }>).map((r) => ({
      name: r.name,
      logoUrl: r.logo_url,
      type: r.type,
    }));
  } catch {
    return [];
  }
}
