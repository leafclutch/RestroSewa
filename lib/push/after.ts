import { after } from "next/server";

/**
 * Run something once the response has gone back to the user.
 *
 * A thin wrapper over Next's `after()`, and the try/catch is the entire point.
 *
 * `after()` THROWS when there is no request scope — from a script, a background job, a
 * test, or any future caller that isn't a server action. And every emit in lib/notify
 * is called from inside a write path: `emitNewOrder` runs in the middle of creating an
 * order. So an unguarded `after()` means a throw from the PUSH layer propagates up and
 * fails the ORDER — a guest's food never reaches the kitchen because a notification
 * helper was called from the wrong kind of context.
 *
 * That is exactly backwards. Push is a courtesy layer on top of the real feature and
 * is not allowed to take it down. So: defer when we can, run inline when we can't, and
 * swallow the failure either way. The notification row is already committed and the
 * panel will still show it; the worst case here is a phone that doesn't buzz.
 */
export function afterResponse(fn: () => Promise<void>): void {
  try {
    after(fn);
  } catch {
    // No request scope. Do the work now rather than dropping it, but never let it
    // reach the caller.
    void fn().catch((err) => console.error("[push] deferred task failed:", err));
  }
}
