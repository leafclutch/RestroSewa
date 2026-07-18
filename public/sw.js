/* eslint-disable no-undef */
//
// HRestroSewa service worker.
//
// Hand-written on purpose. The usual move is Workbox (via next-pwa / Serwist), and
// its default posture is "precache everything and serve it from cache first" —
// which for a point-of-sale is not a convenience, it is a defect. A cashier shown a
// cached table map is shown a LIE: the table may have been billed and cleared two
// minutes ago. Stale menu prices get charged to real customers. So this worker is
// deliberately small and its default is the opposite: NOTHING is cached unless it
// is provably immutable, and anything that carries live restaurant state goes to
// the network every single time.
//
// What is cached:
//   • /_next/static/*  — content-hashed by the build, so a URL's bytes never change
//   • /icons, /splash  — our own generated art
//   • /offline         — the fallback page, which contains no data at all
//
// What is NEVER cached, and never even intercepted:
//   • /api/*           — including /api/realtime, which is a long-lived SSE stream.
//                        Passing a stream through a fetch handler is a good way to
//                        buffer it into oblivion; it must reach the network untouched.
//   • RSC payloads     — per-user, per-render. One staff member's dashboard payload
//                        served to another is a data leak, not a cache hit.
//   • any POST         — every mutation in this app is a server action.
//
// Bump VERSION to retire the old caches on the next activation.

const VERSION = "v2";
const STATIC_CACHE = `hrestrosewa-static-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // ── This try/catch is load-bearing. ──────────────────────────────────────
      //
      // An install handler that REJECTS kills the worker: the browser marks it
      // `redundant` and throws it away. Not "installs without a cache" — throws the
      // whole thing away. And a worker that does not exist cannot receive a push.
      //
      // So the original code, which awaited `cache.add()` bare, had precaching the
      // offline page — a nicety — holding a loaded gun to the head of push, which is
      // the entire point of this file. Any hiccup in CacheStorage (a full disk, a
      // corrupt profile, a browser in a mood, private mode on some platforms) took
      // notifications down with it. Silently. The only symptom is a phone that never
      // rings, which looks exactly like a feature nobody built.
      //
      // Observed for real: `caches.open()` failing with "Unexpected internal error"
      // left the worker redundant, so the app had no service worker, so the push
      // toggle had nothing to attach to, so nobody could ever subscribe.
      //
      // Push must survive the cache failing. The offline page is allowed to be
      // missing; the worker is not.
      try {
        const cache = await caches.open(STATIC_CACHE);
        // `cache: "reload"` so installing a new worker cannot pick the offline page
        // up out of the HTTP cache and bake a stale copy in for the next release.
        await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      } catch (err) {
        console.error(
          "[sw] could not precache the offline page — carrying on without it. " +
            "Offline navigation will fall back to a plain message; push is unaffected.",
          err
        );
      }

      // Take over as soon as we're ready. A half-updated app — new HTML asking an
      // old worker for assets it no longer knows about — is worse than a swap.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Same reasoning as install: sweeping old caches is housekeeping, and
      // housekeeping is not allowed to cost us the worker.
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            // Both prefixes: purge the pre-rebrand `restrosewa-` caches AND any older
            // `hrestrosewa-` ones, leaving only the current STATIC_CACHE.
            .filter((k) => (k.startsWith("restrosewa-") || k.startsWith("hrestrosewa-")) && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        );
      } catch (err) {
        console.error("[sw] could not sweep old caches", err);
      }

      await self.clients.claim();
    })()
  );
});

/** Content-hashed or shipped-by-us: safe to serve from cache forever. */
function isImmutable(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/splash/") ||
    /\.(?:png|jpg|jpeg|svg|webp|avif|ico|woff2?)$/.test(url.pathname)
  );
}

async function cacheFirst(request) {
  // A broken CacheStorage must degrade to "no cache", never to "no asset". Falling
  // through to the network is always a correct answer; throwing is not.
  try {
    const cache = await caches.open(STATIC_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;

    const response = await fetch(request);
    // Only store a real, complete, same-origin 200. Caching an opaque or partial
    // response means caching a failure and replaying it until the next release.
    if (response.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return fetch(request);
  }
}

async function networkOnlyWithOfflinePage(request) {
  try {
    return await fetch(request);
  } catch {
    // The network is gone. We do NOT have a cached copy of this screen and that is
    // the point — see the header. Say so honestly instead of showing yesterday's
    // floor plan.
    try {
      const cache = await caches.open(STATIC_CACHE);
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
    } catch {
      // No cache available — fall through to the plain message below rather than
      // turning "you are offline" into an unhandled rejection.
    }

    return new Response(
      "You are offline. HRestroSewa needs a connection — reopen once you are back.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Server routes and the SSE stream: hands off entirely.
  if (url.pathname.startsWith("/api/")) return;

  // React Server Component payloads. Next asks for these with an RSC header (and,
  // on prefetch, an `_rsc` query param); they are specific to one user and one
  // render, so they must never be served to anyone else.
  if (url.searchParams.has("_rsc") || request.headers.get("RSC") === "1") return;

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // A navigation is the only other thing worth handling — so that losing the
  // network produces the offline screen rather than the browser's dinosaur.
  if (request.mode === "navigate") {
    event.respondWith(networkOnlyWithOfflinePage(request));
  }

  // Everything else: not intercepted. The browser fetches it normally.
});

// Lets the page tell a waiting worker to take over immediately (used by the update
// prompt in components/pwa/register-sw.tsx).
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// ═══ WEB PUSH ═══════════════════════════════════════════════════════════════════
//
// This is the half that runs when the app is CLOSED. There is no page, no React, no
// session — the browser wakes this worker, hands it a decrypted payload, and gives
// it a few seconds to put something on screen before killing it again.
//
// The one iron rule: a push event MUST result in a visible notification. Chrome and
// Firefox permit a handful of silent pushes and then revoke the site's permission
// outright — so a `return` on a payload we don't understand is not a harmless no-op,
// it is a slow way to lose push for that user entirely. Hence the fallback below.

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Malformed or non-JSON payload. We still have to show SOMETHING — see above.
  }

  const title = payload.title || "HRestroSewa";
  const body = payload.body || "You have a new alert.";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      // The little monochrome glyph Android draws in the status bar. Without it you
      // get a grey square.
      badge: "/icons/maskable-192.png",
      // Same tag ⇒ replaces the previous alert instead of stacking a duplicate.
      tag: payload.tag || "hrestrosewa",
      renotify: Boolean(payload.tag),
      // Service calls stay on screen until dealt with, rather than fading out while
      // the waiter's hands are full.
      requireInteraction: payload.requireInteraction === true,
      // A short double-buzz — enough to feel through an apron pocket.
      vibrate: [100, 50, 100],
      data: {
        // The dashboard is the one workspace; `?focus=notifications` opens the bell
        // dropdown where the actions live. Only a fallback — every real payload
        // carries its own url.
        url: payload.url || "/employee/dashboard?focus=notifications",
        notificationId: payload.notificationId || null,
      },
      actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : [],
    })
  );
});

/** Bring the app to the screen at `url`, reusing an open window if there is one. */
async function openApp(url) {
  const clients = await self.clients.matchAll({
    type: "window",
    // Without this, a client that exists but isn't "controlled" yet is invisible to
    // us, and we'd open a SECOND window on top of the app the staff member already
    // has open.
    includeUncontrolled: true,
  });

  // Tapping an alert should take you to the screen inside the app you already have
  // running — not launch a duplicate copy of the POS, which is both disorienting and
  // a second live SSE connection.
  for (const client of clients) {
    if ("focus" in client) {
      await client.focus();
      if ("navigate" in client) {
        try {
          await client.navigate(url);
        } catch {
          // A client that refuses navigation — focusing it is still better than
          // nothing.
        }
      }
      return;
    }
  }

  await self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const url = data.url || "/employee/dashboard?focus=notifications";
  const notificationId = data.notificationId;
  const action = event.action; // "" when the body was tapped rather than a button

  event.notification.close();

  // Body tap: just take them there.
  if (!action || !notificationId) {
    event.waitUntil(openApp(url));
    return;
  }

  // A button was pressed — Approve, Reject, On my way — with the app closed.
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch("/api/push/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Same-origin, so this carries the staff member's session cookie. That is
          // what lets the server re-derive who is acting and re-check that they are
          // allowed to act on this table — the notification itself is NOT a
          // capability, and the id in it grants nothing on its own.
          credentials: "include",
          body: JSON.stringify({ notificationId, action }),
        });

        const result = await res.json().catch(() => ({ ok: false }));

        if (result.ok) {
          // Deliberately silent on success. The alert is already gone from the tray,
          // which IS the confirmation; a second notification saying "approved!" is
          // one more thing to swipe away mid-service. Any open window updates itself
          // — the database write fires the existing realtime event.
          return;
        }

        // It failed. The staff member believes they just approved a table, and a
        // guest is waiting on it — so silence here is the worst possible outcome.
        // Put it back in front of them, honestly, with a way to finish the job.
        await self.registration.showNotification("Couldn't complete that", {
          body: result.error || "Open HRestroSewa to deal with this request.",
          icon: "/icons/icon-192.png",
          badge: "/icons/maskable-192.png",
          tag: `failed-${notificationId}`,
          requireInteraction: true,
          data: { url },
        });
      } catch {
        // Offline, or the session expired. Same reasoning as above: never let a
        // failed action look like a successful one.
        await self.registration.showNotification("You're offline", {
          body: "That action didn't go through. Open HRestroSewa to try again.",
          icon: "/icons/icon-192.png",
          badge: "/icons/maskable-192.png",
          tag: `offline-${notificationId}`,
          requireInteraction: true,
          data: { url },
        });
      }
    })()
  );
});
