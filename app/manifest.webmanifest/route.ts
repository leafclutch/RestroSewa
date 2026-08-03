import type { MetadataRoute } from "next";
import { cookies } from "next/headers";

// Served by Next at /manifest.webmanifest.
//
// DYNAMIC, because `start_url` has to carry the restaurant. A staff member installs the app
// from their manager's `?mode=staff&slug=…` link while still signed out; if the installed
// app then started on the bare /login it would show the admin email form, with no route to
// their own name-picker and PIN pad — the "rejoin the restaurant" complaint. `proxy.ts`
// writes `rs_last_slug` the moment that link is opened, so by the time the browser fetches
// this manifest to install, the restaurant is already known and gets baked into the app.
//
// This only works because the manifest link carries `crossorigin="use-credentials"` (see
// app/layout.tsx). Manifests are fetched WITHOUT cookies by default, and without that
// attribute this function would never see the cookie and would silently fall back.
async function buildManifest(): Promise<MetadataRoute.Manifest> {
  const slug = (await cookies()).get("rs_last_slug")?.value;
  const startUrl = slug ? `/login?mode=staff&slug=${encodeURIComponent(slug)}` : "/login";

  return {
    id: "/",
    name: "HRestroSewa — Hospitality Management",
    short_name: "HRestroSewa",
    description:
      "Run the floor from your pocket: tables, rooms, orders, billing and live service alerts.",

    // Launching the installed app lands on /login, which is NOT a login wall —
    // it already redirects a signed-in user to the dashboard their role belongs
    // to (super admin, restaurant admin or staff). So a staff member with a live
    // session taps the icon and goes straight to work; only an expired session
    // ever actually sees the form. That is the whole of "stay signed in after
    // reopening the app", and it falls out of routing we already had.
    start_url: startUrl,
    scope: "/",

    display: "standalone",
    // If a browser ever refuses standalone, fall back to a chrome-less-ish window
    // rather than all the way back to a full browser tab.
    display_override: ["standalone", "minimal-ui"],

    // Both match --color-canvas-soft, the app's own background. A theme colour
    // that differs from the page paints a visible seam under the status bar; this
    // way the app appears to run edge-to-edge with no band of colour above it.
    background_color: "#f6f9fc",
    theme_color: "#f6f9fc",

    orientation: "portrait-primary",
    categories: ["business", "food", "productivity"],
    lang: "en",
    dir: "ltr",

    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-256.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/icons/icon-384.png", sizes: "384x384", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Kept as separate entries rather than purpose: "any maskable". A single icon
      // claiming both gets used as-is on desktop AND cropped on Android, so it is
      // either padded and tiny in one place or clipped in the other.
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],

    // Long-press the installed icon. Everything is the one dashboard now, so these
    // deep-link into it (?focus opens the bell / scrolls to a section) rather than
    // pointing at the old standalone pages — which still exist only to redirect here.
    // /employee/* admits restaurant_admin as well as employees, so they work for both.
    // (A manifest is per-origin and cannot vary by role.)
    shortcuts: [
      {
        name: "Notifications",
        short_name: "Alerts",
        description: "Waiter calls, bill requests and table activations waiting on you",
        url: "/employee/dashboard?focus=notifications",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Orders",
        short_name: "Orders",
        description: "The live order queue",
        url: "/employee/dashboard?focus=orders",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Tables & Rooms",
        short_name: "Tables",
        description: "Floor and room overview",
        url: "/employee/dashboard",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}

/**
 * A ROUTE HANDLER, not `app/manifest.ts`.
 *
 * The metadata convention makes Next inject its own
 * `<link rel="manifest" href="/manifest.webmanifest">` — with no `crossorigin` — and it
 * lands EARLIER in <head> than ours, so the browser used it and fetched the manifest
 * anonymously. The cookie was then invisible and every install silently fell back to the
 * generic login. Serving the same URL from a route handler means the only manifest link on
 * the page is the credentialed one in app/layout.tsx.
 */
export async function GET() {
  return Response.json(await buildManifest(), {
    headers: {
      "Content-Type": "application/manifest+json",
      // Per-device content, so it must never be shared by a CDN.
      "Cache-Control": "private, no-store",
    },
  });
}
