"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, and keeps it from going stale.
 *
 * A service worker is sticky in a way nothing else on the web is: once installed it
 * keeps serving the app across relaunches, so a bad one is not a bad deploy — it is
 * a bad deploy that reinstalls itself. Two guards against that:
 *
 *   • `updateViaCache: "none"` — never let the HTTP cache answer for sw.js itself,
 *     or a worker can outlive the release that replaced it.
 *   • an update check when the app is brought back to the foreground, so a device
 *     that lives in a waiter's pocket for a week still picks up a new version.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      console.warn("[pwa] this browser has no service worker support — no offline, no push");
      return;
    }

    // Registering from a dev build would cache assets that Turbopack rewrites on
    // every keystroke, and then serve them back — the classic "why isn't my edit
    // showing up" afternoon.
    //
    // Say so out loud. Silence here is indistinguishable from a broken build, and it
    // is the first thing anyone should check when push "doesn't work".
    if (process.env.NODE_ENV !== "production") {
      console.info(
        "[pwa] service worker not registered: this is a development build. " +
          "Push and offline need `npm run build && npm start`."
      );
      return;
    }

    let registration: ServiceWorkerRegistration | null = null;

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        console.info("[pwa] service worker registered — push and offline are available");
      } catch (err) {
        // An unregistrable worker must not take the app down with it: the site works
        // perfectly well without one, it just isn't installable or offline-capable.
        //
        // But it must not fail SILENTLY either. The original version swallowed this
        // whole, which meant a worker that never registered produced no error, no
        // warning, and a Notifications screen with no button on it — and the only
        // symptom anyone ever saw was a phone that stayed quiet.
        console.error(
          "[pwa] service worker registration FAILED — push and offline will not work:",
          err
        );
      }
    };

    const checkForUpdate = () => {
      if (document.visibilityState !== "visible") return;
      registration?.update().catch(() => {});
    };

    void register();
    document.addEventListener("visibilitychange", checkForUpdate);

    return () => document.removeEventListener("visibilitychange", checkForUpdate);
  }, []);

  return null;
}
