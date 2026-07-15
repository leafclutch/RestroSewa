import type { MetadataRoute } from "next";

// Served by Next at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "RestroSewa — Hospitality Management",
    short_name: "RestroSewa",
    description:
      "Run the floor from your pocket: tables, rooms, orders, billing and live service alerts.",

    // Launching the installed app lands on /login, which is NOT a login wall —
    // it already redirects a signed-in user to the dashboard their role belongs
    // to (super admin, restaurant admin or staff). So a staff member with a live
    // session taps the icon and goes straight to work; only an expired session
    // ever actually sees the form. That is the whole of "stay signed in after
    // reopening the app", and it falls out of routing we already had.
    start_url: "/login",
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
