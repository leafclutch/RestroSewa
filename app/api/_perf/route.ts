import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, isSuperAdmin } from "@/lib/auth/current-user";
import { timingSafeEqual } from "node:crypto";

// A long-lived probe with real network calls: Node runtime, never prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the time actually goes, measured FROM PRODUCTION.
 *
 * Profiling from a laptop in Nepal says round trips cost ~130ms — but what matters is the
 * distance between the Vercel function and Supabase, which nobody can observe from
 * outside. This answers that: it times each layer from inside a real deployment and
 * reports which region it ran in, so "co-locate the two" can be decided on evidence.
 *
 * SAFE TO LEAVE DEPLOYED. It returns durations, a region name and a hostname — no rows,
 * no ids, no emails, no token. It answers 404 (not 401) to anyone unauthorised, so it
 * isn't discoverable by probing.
 *
 *   curl -H "x-perf-token: $PERF_TOKEN" https://<domain>/api/_perf
 *
 * Read the numbers with `x-vercel-id` (which region served it) and Vercel Observability
 * (p75 per route). If `auth_getClaims_warm` is not ~0ms, the project is still signing
 * HS256 and the JWT key rotation hasn't taken effect yet.
 */

const RUNS = 8;

function authorisedByToken(req: Request): boolean {
  const expected = process.env.PERF_TOKEN;
  if (!expected) return false;
  const given = req.headers.get("x-perf-token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // Length must match before timingSafeEqual, and comparing lengths first leaks only the
  // length — which is not the secret.
  return a.length === b.length && timingSafeEqual(a, b);
}

async function stats(label: string, fn: () => Promise<unknown>) {
  const ms: number[] = [];
  let error: string | null = null;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    try {
      await fn();
    } catch (e) {
      error = e instanceof Error ? e.name : "error";
    }
    ms.push(performance.now() - t0);
  }
  ms.sort((x, y) => x - y);
  const at = (p: number) => +ms[Math.min(ms.length - 1, Math.floor(ms.length * p))].toFixed(1);
  return { label, min: +ms[0].toFixed(1), p50: at(0.5), p95: at(0.95), ...(error ? { error } : {}) };
}

export async function GET(req: Request) {
  const user = await getAuthUser();
  const bySession = user ? await isSuperAdmin(user.id) : false;
  if (!authorisedByToken(req) && !bySession) {
    return new Response("Not found", { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(supabaseUrl).hostname;
    } catch {
      return "unknown";
    }
  })();

  const service = createServiceClient();
  const ssr = await createClient();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const probes = [
    // A fresh TCP+TLS handshake every time — the cost a cold lambda pays on its first call.
    await stats("connect_cold", () =>
      fetch(`${supabaseUrl}/auth/v1/health`, { headers: { Connection: "close" }, cache: "no-store" })
    ),
    // The same request over a warm keep-alive socket. The gap between these two IS the
    // handshake cost, and it is what a cold start pays on every layer at once.
    await stats("connect_warm", () => fetch(`${supabaseUrl}/auth/v1/health`, { cache: "no-store" })),
    // The JWKS document getClaims() verifies against. Fetched once per process, so this is
    // a cold-start cost, not a per-request one — but if it is slow or failing, local
    // verification is silently falling back to the network on every request.
    await stats("jwks_fetch", () =>
      fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, { cache: "no-store" })
    ),
    // One trivial row through PostgREST — the floor for any query, i.e. pure round trip.
    // `async () =>` rather than a bare arrow: PostgrestFilterBuilder is thenable but not a
    // Promise, so it needs awaiting inside to be timed at all.
    await stats("pg_trivial", async () => {
      await service.from("restaurants").select("id").limit(1);
    }),
    // Shaped like the real hot read: a session with its orders and items nested.
    await stats("pg_representative", async () => {
      await service
        .from("sessions")
        .select("id, session_orders ( id, session_order_items ( id ) )")
        .eq("status", "active")
        .limit(5);
    }),
    // The per-request auth cost. With asymmetric JWT keys this should be ~0ms and never
    // touch the network; if it matches auth_getUser, the rotation hasn't landed.
    await stats("auth_getClaims", () => ssr.auth.getClaims()),
    // The old cost, kept for comparison so the win is visible rather than asserted.
    await stats("auth_getUser", () => ssr.auth.getUser()),
  ];

  return Response.json(
    {
      // Compare `region` against the Supabase project's region. If they differ, that gap
      // is multiplied by every round trip on every page.
      region: process.env.VERCEL_REGION ?? "local",
      env: process.env.VERCEL_ENV ?? "development",
      deployment: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      supabase_host: host,
      node: process.version,
      runs: RUNS,
      probes,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Server-Timing": probes.map((p) => `${p.label};dur=${p.p50}`).join(", "),
      },
    }
  );
}
