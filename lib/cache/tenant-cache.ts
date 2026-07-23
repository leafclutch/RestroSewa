import "server-only";
import { unstable_cache, revalidateTag, updateTag } from "next/cache";

/**
 * Cross-request caching for slow-changing, tenant-scoped configuration.
 *
 * WHY unstable_cache AND NOT `"use cache"`. The `"use cache"` directive needs
 * `cacheComponents: true` in next.config.ts, which flips the WHOLE app to cache-by-default
 * with explicit dynamic opt-outs. In a POS where nearly every read must be strongly
 * consistent, that is an enormous behavioural change bought for the sake of three cached
 * functions. This gets the same benefit with a blast radius you can see.
 *
 * WHY A WRAPPER AND NOT unstable_cache DIRECTLY. Every key and every tag in a multi-tenant
 * app must carry the restaurant id. Forget it in the KEY and one restaurant is served
 * another's menu; forget it in the TAG and one restaurant's edit silently revalidates
 * another's cache. Both are near-invisible in review and catastrophic in production, so
 * the id is not something a caller can leave out — it is the first argument, and this
 * function is the only way in.
 *
 * WHAT MUST NEVER GO THROUGH HERE: anything a human reads as a live number or that money
 * depends on — sessions, orders, tickets, payments, credits, stock, room stays, table
 * state, and `restaurant_users` (the only live check that an employee still works here).
 * Vercel's Data Cache is shared across regions and survives deploys; there is no staleness
 * bound you could honestly quote to a restaurant owner.
 */
export function tenantCache<T>(
  name: string,
  restaurantId: string,
  fn: () => Promise<T>,
  opts: { revalidate: number }
): Promise<T> {
  if (!restaurantId) {
    // A blank id would collapse every tenant onto one shared key. Fail loudly rather than
    // serve the wrong restaurant's configuration.
    throw new Error(`tenantCache("${name}") called without a restaurantId`);
  }
  return unstable_cache(fn, [name, restaurantId], {
    tags: [tenantTag(name, restaurantId)],
    revalidate: opts.revalidate,
  })();
}

/** The one place a tag string is built, so reads and invalidations cannot drift apart. */
export function tenantTag(name: string, restaurantId: string): string {
  return `${name}:${restaurantId}`;
}

/**
 * Drop one cached entry for one restaurant. Call from every mutation that invalidates it.
 *
 * `updateTag`, NOT `revalidateTag(tag, "max")`. In Next 16 those are different promises:
 * `revalidateTag` marks the entry stale and serves the OLD value while refreshing in the
 * background, whereas `updateTag` expires it immediately — read-your-own-writes. An admin
 * who changes the tax rate and then prints a bill must get the new rate on that bill, not
 * one receipt later. Stale-while-revalidate is the right default for a blog and the wrong
 * one for money.
 *
 * `updateTag` is only callable from a Server Action. Every caller today is one. The
 * fallback exists so that if some future caller isn't, a settings save still succeeds and
 * the cache still clears — just a beat later — instead of throwing in the user's face.
 */
export function revalidateTenant(name: string, restaurantId: string): void {
  if (!restaurantId) return;
  const tag = tenantTag(name, restaurantId);
  try {
    updateTag(tag);
  } catch {
    revalidateTag(tag, "max");
  }
}

/** Cache names, enumerated so a typo can't silently create a second, never-invalidated key. */
export const CACHE = {
  restaurantInfo: "restaurant-info",
  workstations: "workstations",
  menu: "menu",
} as const;

/**
 * Call from every mutation of `workstations`, including the OT-numbering form.
 *
 * Lives HERE and not next to `getWorkstations` because that file carries `"use server"`,
 * and Next requires every export of such a module to be an async function — a synchronous
 * helper there compiles under tsc and then fails the build with "Server Actions must be
 * async functions". Invalidation helpers are not actions, so they belong outside.
 */
export function revalidateWorkstations(restaurantId: string): void {
  revalidateTenant(CACHE.workstations, restaurantId);
}
