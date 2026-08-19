import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirect WITHOUT throwing away the cookies the auth adapter just wrote.
 *
 * `NextResponse.redirect()` builds a brand-new response, so every `Set-Cookie` accumulated
 * on `supabaseResponse` by the `setAll` closure above — including a token that was just
 * REFRESHED on this very request — is discarded. That happened on exactly the hop that
 * sends someone to /login, i.e. the one request where losing the refreshed token turns a
 * recoverable session into a sign-out. Carry them across.
 */
function redirectKeepingCookies(
  target: string,
  request: NextRequest,
  carrying: NextResponse
) {
  const response = NextResponse.redirect(new URL(target, request.url));
  carrying.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}

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
      // Send them back to THEIR restaurant's sign-in, never the generic admin form.
      //
      // This is the moment that hurt most: a session ends mid-shift, and the person is
      // dropped on an email/password screen they have no credentials for and no route off.
      // Inside an installed PWA there is not even a URL bar to fix it with, which is what
      // made "delete the app and reinstall" look like the only way back.
      //
      // The slug goes in the URL rather than being left to the cookie fallback on /login,
      // so the destination survives even if the cookie is evicted a moment later — which
      // on iOS is a real possibility, not a hypothetical.
      const slug = request.cookies.get("rs_last_slug")?.value;
      const target = slug
        ? `/login?mode=staff&slug=${encodeURIComponent(slug)}`
        : "/login";
      return redirectKeepingCookies(target, request, supabaseResponse);
    }
    if (isSuperAdminProtected) {
      return redirectKeepingCookies("/superadmin/login", request, supabaseResponse);
    }
  }

  // Remember the restaurant the moment its sign-in link is OPENED — before any login.
  //
  // This is what makes an installed PWA land on the right restaurant. The web app manifest
  // is fetched at install time, and the install happens on this screen while the staff
  // member is still signed out, so waiting until a successful PIN login would be too late
  // for the manifest to know which restaurant to start on. Writing it here also means a
  // manager's link only has to be followed once per device, ever.
  //
  // Harmless if forged: it selects which sign-in screen to show, and a PIN is still
  // required. `getRestaurantStaff` validates the slug before anything is rendered.
  if (pathname === "/login" && request.nextUrl.searchParams.get("mode") === "staff") {
    const slug = request.nextUrl.searchParams.get("slug");
    if (slug && slug.length <= 100) {
      supabaseResponse.cookies.set("rs_last_slug", slug, {
        path: "/",
        maxAge: 400 * 24 * 60 * 60,
        sameSite: "lax",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      });
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

// MUST be named exactly `config`. Next reads `extractExportedConstValue(ast, "config")` and
// nothing else — an export called `proxyConfig` typechecks, ships, and is silently ignored,
// which is what it did until 2026-08-18: the built matcher was `^.*$`, so every static chunk,
// every RSC payload and every /api call paid a Supabase auth check. Confirm after a build with
// `.next/server/functions-config-manifest.json` — `/_middleware` must NOT read `^.*$`.
export const config = {
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
