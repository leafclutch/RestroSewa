"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { isCategory } from "@/lib/push/categories";
import type { NotificationCategory } from "@/lib/push/categories";

// The browser hands us this after the user grants permission. It is the address the
// push service will deliver to, plus the keys payloads are encrypted to.
export type BrowserSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Register THIS browser to receive push for the signed-in staff member.
 *
 * The caller is never trusted for identity: the restaurant and the staff row are
 * derived from the session, so a client cannot subscribe someone else's device, or
 * attach a device to a restaurant it doesn't belong to.
 */
export async function subscribeToPush(
  sub: BrowserSubscription,
  userAgent?: string
): Promise<{ ok: boolean }> {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // Upsert on the endpoint, which is the browser's own identity for this
  // subscription. The same device re-subscribing (a re-grant, a reinstall, a routine
  // key rotation by the push service) must UPDATE its row, not accumulate a second
  // one — otherwise every alert eventually arrives two or three times and staff start
  // ignoring them.
  //
  // Re-pointing restaurant_user_id also matters: on a shared till, staff member B
  // signing in on the device staff member A used must take ownership of that
  // endpoint, or B's alerts would keep going to a row that says "A".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("push_subscriptions").upsert(
    {
      restaurant_id: ru.restaurant_id,
      restaurant_user_id: ru.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: userAgent?.slice(0, 300) ?? null,
      last_seen_at: new Date().toISOString(),
      failure_count: 0,
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    console.error("[push] subscribe failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/** Turn push off for this browser. */
export async function unsubscribeFromPush(endpoint: string): Promise<{ ok: boolean }> {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // Scoped to the caller's own row. Without the restaurant_user_id predicate, a bare
  // endpoint would let any signed-in user unsubscribe anyone else's device — you'd
  // only need to know the string.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("restaurant_user_id", ru.id);

  if (error) {
    console.error("[push] unsubscribe failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Is this browser's subscription known to us, and does it belong to the person
 * currently signed in?
 *
 * The second half is the interesting one. A browser can hold a perfectly valid push
 * subscription that we have no row for (database reset) or that belongs to whoever
 * used the device before (a shared till). Either way the toggle must read as OFF, so
 * that switching it on re-registers it against the right person.
 */
export async function isPushSubscribed(endpoint: string): Promise<boolean> {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", endpoint)
    .eq("restaurant_user_id", ru.id)
    .maybeSingle();

  return Boolean(data);
}

// ─── Notification preferences ────────────────────────────────────────────────
// Per USER, not per device: muting Finance means you meant it, and shouldn't have to
// mean it again on the till.

/**
 * The caller's muted categories.
 *
 * Returns only what they have switched OFF. Everything else is on — the table stores
 * exceptions, not state, so a category nobody has ever touched simply isn't in here.
 */
export async function getMutedCategories(): Promise<NotificationCategory[]> {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("notification_preferences")
    .select("category")
    .eq("restaurant_user_id", ru.id)
    .eq("enabled", false);

  return ((data ?? []) as { category: string }[])
    .map((r) => r.category)
    // A row for a category that no longer exists in the code is ignored rather than
    // returned — the app owns the taxonomy, the table just remembers opinions about it.
    .filter(isCategory);
}

/** Switch one category on or off for the signed-in staff member. */
export async function setCategoryEnabled(
  category: string,
  enabled: boolean
): Promise<{ ok: boolean }> {
  if (!isCategory(category)) return { ok: false };

  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("notification_preferences").upsert(
    {
      restaurant_user_id: ru.id,
      category,
      enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "restaurant_user_id,category" }
  );

  if (error) {
    console.error("[push] preference update failed:", error.message);
    return { ok: false };
  }

  revalidatePath("/employee/notifications");
  return { ok: true };
}
