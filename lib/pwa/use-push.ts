"use client";

import { useCallback, useEffect, useState } from "react";
import {
  subscribeToPush,
  unsubscribeFromPush,
  isPushSubscribed,
  sendTestPush,
} from "@/app/actions/push";
import { useStandalone } from "@/lib/pwa/use-standalone";

/**
 * Everything about "does this device get alerts", in one place.
 *
 * Lives in a hook rather than a component because it is needed in TWO places, and the
 * second one is the one that matters: staff open notifications from the BELL, not from
 * the Notifications page. A switch that only exists on a page nobody visits is a switch
 * nobody ever presses — which is exactly why, in production, not one device was ever
 * subscribed. Copying the logic into the bell would have been the obvious fix and the
 * wrong one; it would drift.
 */

export type PushState =
  | "loading"
  | "insecure" // plain http — the browser refuses push outright
  | "no-sw" // no service worker (a dev build): nothing to receive a push
  | "unsupported" // a browser that genuinely cannot
  | "misconfigured" // OUR fault: the app was built without a VAPID public key
  | "ios-needs-install" // Safari only delivers push to an installed app
  | "denied" // the user said no, and cannot be asked again
  | "off"
  | "on";

/**
 * The public half of the VAPID keypair, baked into the bundle at BUILD time.
 *
 * `NEXT_PUBLIC_*` values are not read at runtime — they are substituted as literals
 * when the bundle is compiled. So a host that has the variable set but was built
 * before it existed ships `undefined` here, and no amount of restarting fixes it. It
 * has to be present when `next build` runs.
 *
 * This being missing used to surface as "this browser can't do notifications", which
 * is a lie: the browser is fine, the deployment isn't. That message sent people
 * debugging their phone for an hour. It is now its own state, with its own words.
 */
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/**
 * base64url text → the raw bytes the Push API insists on.
 *
 * Backed by an explicitly-constructed ArrayBuffer rather than `new Uint8Array(n)`.
 * Since TypeScript 5.7 the typed arrays are generic over their buffer, and the bare
 * form widens to `ArrayBufferLike` — which includes SharedArrayBuffer, which
 * `applicationServerKey` will not accept.
 */
function decodeVapidKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * `navigator.serviceWorker.ready` never rejects — if no worker is ever registered it
 * simply hangs, forever. An `await` on it is an await that never returns, which is how
 * the original toggle sat in `loading` and rendered nothing at all. Race it, and treat
 * "still not ready" as an answer rather than a state to sit in.
 */
function readyWithin(ms: number): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPad has reported itself as a Mac since iPadOS 13, so the touch check is what
  // actually distinguishes it from a desktop.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export function usePush() {
  const standalone = useStandalone();
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Read the truth. Every branch ends in a state that SAYS something — a silent
  // "render nothing" is how this feature quietly failed the first time.
  const refresh = useCallback(async () => {
    // The commonest real-world failure, and the one that looks least like one: opening
    // the app on a phone over the LAN (http://192.168.1.20:3000) is not a secure
    // context, so the browser hides the service worker and PushManager entirely.
    // Everything looks fine. Nothing works. Only `localhost` is exempt — and a phone
    // is never localhost.
    if (!window.isSecureContext) {
      setState("insecure");
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // On iPhone this is normal until the app is installed: Safari exposes no
      // PushManager to a plain tab. Saying "not supported" when the real answer is
      // "add it to your Home Screen" is the difference between a dead end and a step.
      setState(isIOS() && !standalone ? "ios-needs-install" : "unsupported");
      return;
    }

    const reg = await readyWithin(4000);
    if (!reg) {
      setState("no-sw");
      return;
    }

    // Checked HERE, before the button is offered — not on click. Presenting a switch
    // that cannot possibly work, and only admitting it after someone has pressed it
    // and granted an OS permission prompt, is a small cruelty.
    if (!VAPID_PUBLIC_KEY) {
      console.error(
        "[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing from this build. " +
          "It is inlined at build time, so it must be set BEFORE `next build` runs — " +
          "setting it on the server afterwards changes nothing."
      );
      setState("misconfigured");
      return;
    }

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      setState("off");
      return;
    }

    // The browser says it's subscribed. Only the server can say whether that
    // subscription is one WE know about, and whether it belongs to the person signed
    // in right now — on a shared till, it may be the last shift's waiter.
    setState((await isPushSubscribed(sub.endpoint)) ? "on" : "off");
  }, [standalone]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      if (!VAPID_PUBLIC_KEY) {
        // Should be unreachable — refresh() catches this before the button is shown —
        // but if it ever isn't, say the TRUE thing. This used to report "unsupported",
        // blaming the browser for our own missing key.
        setState("misconfigured");
        return;
      }

      const reg = await navigator.serviceWorker.ready;

      // An existing subscription may have been created against a DIFFERENT VAPID key
      // (if the keys were ever rotated), and re-subscribing with a new key while an old
      // one is live throws InvalidStateError. Reuse whatever is there.
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          // Non-negotiable everywhere: a push MUST show the user something. Silent push
          // is not available to websites, by design.
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(VAPID_PUBLIC_KEY),
        }));

      const json = sub.toJSON();
      const { ok } = await subscribeToPush(
        {
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        },
        navigator.userAgent
      );

      setState(ok ? "on" : "off");
    } catch (err) {
      console.error("[push] enable failed:", err);
      setState("off");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Drop our row FIRST. If the browser-side unsubscribe succeeded but the server
        // call then failed, we'd keep pushing to an endpoint that no longer exists.
        // This order fails safe in the quieter direction.
        await unsubscribeFromPush(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setTestResult(null);
    } catch (err) {
      console.error("[push] disable failed:", err);
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await sendTestPush();
      setTestResult(r.message);
      // A failure usually means the subscription died under us (browser data cleared,
      // app reinstalled). Re-read the truth rather than keep showing a switch that
      // claims to be on.
      if (!r.ok) void refresh();
    } catch {
      setTestResult("Couldn't reach the server.");
    } finally {
      setTesting(false);
    }
  }, [refresh]);

  return { state, busy, testing, testResult, enable, disable, test, refresh };
}
