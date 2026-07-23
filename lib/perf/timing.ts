import "server-only";
import { cache } from "react";

/**
 * Per-request timing spans.
 *
 * WHY THIS EXISTS. Profiling said the database is not slow — every query in this app
 * executes in under a millisecond. What costs time is the NUMBER of sequential network
 * hops between the Vercel function and Supabase, and that number is invisible from the
 * outside: a 2-second page and a 200ms page look identical in a stack trace. This gives
 * each hop a name and a duration so the next optimisation is chosen from evidence rather
 * than from a hunch.
 *
 * HOW IT'S FREE WHEN OFF. `span()` checks one boolean and calls through. No allocation,
 * no timer, nothing in the log. Leave it in production permanently.
 *
 * HOW IT'S FREE WHEN ON. React's `cache()` is already how this codebase memoises the auth
 * chain per request (see lib/auth/current-user.ts), so the collector rides the same
 * mechanism: one object per request, discarded with it. Cost is two performance.now()
 * calls and an array push per span.
 *
 * SCOPE LIMIT, and it matters: `cache()` is only valid inside a React request — RSC render
 * and server actions. It does NOT work in middleware (`proxy.ts`) or Route Handlers, which
 * run outside React entirely. Those measure explicitly and set a Server-Timing header
 * instead; see proxy.ts.
 */

const ON = process.env.PERF_LOG === "1";

type Span = { n: string; ms: number };

const store = cache((): { spans: Span[] } => ({ spans: [] }));

/** Time one awaited step. A passthrough unless PERF_LOG=1. */
export async function span<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!ON) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    // `finally`, so a throwing step is still measured — a slow failure is a slow request.
    store().spans.push({ n: name, ms: +(performance.now() - t0).toFixed(1) });
  }
}

/**
 * Emit this request's spans as ONE json line.
 *
 * One line rather than one per span because Vercel's log viewer filters by substring: a
 * single object keyed `"evt":"perf"` is greppable, and the whole request's shape arrives
 * together instead of interleaved with other concurrent requests.
 *
 * Deliberately carries no ids, no names, no row data — a log drain is a third party.
 */
export function flushPerf(route: string): void {
  if (!ON) return;
  const { spans } = store();
  if (spans.length === 0) return;
  const total = +spans.reduce((s, x) => s + x.ms, 0).toFixed(1);
  console.log(
    JSON.stringify({
      evt: "perf",
      route,
      region: process.env.VERCEL_REGION ?? "local",
      total,
      waves: spans.length,
      spans,
    })
  );
  // Reset so an action that flushes mid-request doesn't double-count into the page's line.
  spans.length = 0;
}

/** Whether timing is on — for callers that want to skip building a label. */
export const perfEnabled = ON;
