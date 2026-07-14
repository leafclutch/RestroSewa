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
    if (!("serviceWorker" in navigator)) return;
    // Registering from a dev build would cache assets that Turbopack rewrites on
    // every keystroke, and then serve them back — the classic "why isn't my edit
    // showing up" afternoon.
    if (process.env.NODE_ENV !== "production") return;

    let registration: ServiceWorkerRegistration | null = null;

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
      } catch {
        // An unregistrable worker must not take the app down with it. The site
        // works perfectly well without one — it just isn't installable-offline.
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
