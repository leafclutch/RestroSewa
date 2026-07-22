import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // MIDDLEWARE IS A REDIRECT OPTIMISATION, NEVER AN AUTHORISATION DECISION.
  //
  // All it asks is "is there any valid session at all" — it never reads role, restaurant
  // or permissions. Every /admin and /employee page then calls a guard that queries
  // `restaurant_users` live (is_active, deleted_at) on every render, and THAT is the
  // authority. Keep it that way: the one thing local verification cannot know is whether
  // the employee was deactivated ten seconds ago.
  //
  // `getClaims()` verifies the JWT signature locally against the cached JWKS instead of
  // making an HTTP round-trip to Supabase Auth on every single request. It still calls
  // getSession() underneath, so the cookie refresh below still happens — do not "simplify"
  // the setAll closure, it is how a refreshed token gets written back.
  const t0 = performance.now();
  const { data: claims, error } = await supabase.auth.getClaims();
  // A verification error is a failure to answer, not an answer of "no session". Treating
  // it as "no session" would bounce the whole floor to /login on a transient JWKS blip.
  const user = claims?.claims?.sub ? { id: claims.claims.sub } : null;
  const authMs = performance.now() - t0;

  const { pathname } = request.nextUrl;

  const isTenantProtected =
    pathname.startsWith("/admin") || pathname.startsWith("/employee");

  const isSuperAdminProtected =
    pathname.startsWith("/superadmin") && pathname !== "/superadmin/login";

  // Only redirect when we're certain there is no session.
  // If getUser() returned an error (network/transient failure), pass through —
  // the page-level guards will enforce auth correctly on the next render.
  if (!error && !user) {
    if (isTenantProtected) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (isSuperAdminProtected) {
      return NextResponse.redirect(new URL("/superadmin/login", request.url));
    }
  }

  // Readable in any browser's devtools (Network → Timing) with no tooling and no log
  // drain, so a tablet on the floor can be screenshotted when someone says "it's slow
  // right now". `mw` is the auth check; the region tells us which side of the world the
  // function ran on, which is the other half of the latency story.
  supabaseResponse.headers.set(
    "Server-Timing",
    `mw;dur=${authMs.toFixed(1)}, region;desc="${process.env.VERCEL_REGION ?? "local"}"`
  );

  return supabaseResponse;
}

export const proxyConfig = {
  // The PWA's static surface is excluded alongside _next/static for the same
  // reason: every path that reaches this proxy costs an auth round-trip to
  // Supabase. The service worker precaches the icon set and 28 splash images on
  // install, and none of those bytes depend on who is signed in — running the
  // session lookup 30-odd times to hand back a PNG is pure latency. `sw.js` and
  // the manifest must be reachable with no session at all, which they now
  // demonstrably are.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|c/|sw\\.js|manifest\\.webmanifest|icons/|splash/).*)",
  ],
};
