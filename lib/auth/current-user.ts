import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeClosingHour } from "@/lib/business-day";
import { span } from "@/lib/perf/timing";

/** What every caller actually reads off the auth user: the id, and rarely the email. */
export type AuthIdentity = { id: string; email: string | null };

// One env flag, so the change can be turned off without a revert. Vercel reads env at
// instance boot, so flipping it needs a redeploy — it exists to make the diff obviously
// reversible, not to be fast.
const LOCAL_VERIFY = process.env.AUTH_LOCAL_VERIFY !== "0";

/**
 * Who is asking — resolved ONCE per request, and now WITHOUT a network call.
 *
 * `supabase.auth.getUser()` is not a local JWT decode. It is an HTTP round-trip to
 * Supabase Auth to validate the token (~130-300ms against a remote project), and it used
 * to sit on the critical path of literally every authenticated request — twice, because
 * `proxy.ts` pays it again in middleware.
 *
 * `getClaims()` verifies the token's signature LOCALLY with WebCrypto against the
 * project's published JWKS, which it fetches once per process and caches. Zero network
 * per request. Two things make this safe rather than clever:
 *
 *   1. It still calls `getSession()` internally, which means the @supabase/ssr cookie
 *      adapter still runs and an expired access token is still REFRESHED. Verification
 *      moving local does not move the refresh.
 *   2. While the project still signs with the legacy HS256 shared secret, the secret is
 *      not public, so `getClaims()` cannot verify locally and transparently falls back to
 *      the network. Behaviour is then byte-identical to before. That is why this can ship
 *      before the Supabase key rotation, and why the rotation carries no code risk.
 *
 * ON ERROR WE FALL BACK, WE DO NOT RETURN NULL. A returned null means "not signed in",
 * which redirects to /login. If the JWKS endpoint ever blips, returning null would sign
 * out the entire restaurant floor mid-service on a transient network fault. A
 * verification failure is a failure to ANSWER, not an answer of "no".
 *
 * React's `cache()` memoises for the lifetime of ONE server request, so every caller in a
 * render shares one result. It is not a cross-request cache — a different user, or the
 * next request, resolves afresh.
 */
export const getAuthUser = cache(async (): Promise<AuthIdentity | null> => {
  const supabase = await createClient();

  if (LOCAL_VERIFY) {
    const { data, error } = await span("auth.getClaims", () => supabase.auth.getClaims());
    if (!error) {
      const sub = data?.claims?.sub;
      if (!sub) return null; // verified, and there is genuinely no session
      return { id: sub, email: (data?.claims?.email as string | undefined) ?? null };
    }
    // Fall through to the network path rather than claiming "not signed in".
  }

  const {
    data: { user },
  } = await span("auth.getUser", () => supabase.auth.getUser());
  return user ? { id: user.id, email: user.email ?? null } : null;
});

export type StaffRow = {
  id: string;
  restaurant_id: string;
  role: string;
  display_name: string;
  permissions: string[];
  /**
   * The restaurant's business-day boundary (whole hours; 0 = midnight).
   *
   * It rides along on the staff row rather than being fetched where it's used:
   * every server action already opens with `getRestaurantUser()`, so the hour
   * arrives free inside a value the caller is holding anyway — no extra round
   * trip, and it is structurally bound to the right tenant, so a report cannot
   * accidentally be bucketed with another restaurant's boundary.
   */
  closingHour: number;
};

/** The caller's restaurant_users row, or null. Memoised per request. */
export const getStaffRow = cache(async (authUserId: string): Promise<StaffRow | null> => {
  const service = createServiceClient();
  // `restaurant_users` has exactly one FK to `restaurants`, so the embed is
  // unambiguous and costs nothing beyond one more column on the same query.
  //
  // NOT cached across requests, deliberately: `is_active` / `deleted_at` here are the
  // ONLY live check that an employee still works here. Caching this would mean
  // "deactivate that cashier right now" stops being immediate, on a system where that
  // request usually means money has gone missing.
  const { data } = await span("db.staffRow", async () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurant_users")
      .select("id, restaurant_id, role, display_name, permissions, restaurants ( settings )")
      .eq("auth_user_id", authUserId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle()
  );

  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  // PostgREST returns a to-one embed as an object, but tolerate an array so a
  // relationship-shape change can't take down every authenticated request.
  const rest = Array.isArray(raw.restaurants) ? raw.restaurants[0] : raw.restaurants;

  return {
    id: raw.id,
    restaurant_id: raw.restaurant_id,
    role: raw.role,
    display_name: raw.display_name,
    // A row predating the permissions migration can carry null.
    permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
    closingHour: normalizeClosingHour(rest?.settings?.business_closing_hour),
  };
});

/** The caller as staff, or null when not signed in / not staff. Memoised. */
export const getCurrentStaff = cache(async (): Promise<StaffRow | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  return getStaffRow(user.id);
});

/** True when the caller is a super admin. Memoised. */
export const isSuperAdmin = cache(async (authUserId: string): Promise<boolean> => {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("super_admins")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return !!data;
});
