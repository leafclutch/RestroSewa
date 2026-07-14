"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2, Smartphone, ShieldAlert, Send } from "lucide-react";
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed, sendTestPush } from "@/app/actions/push";
import { useStandalone } from "@/lib/pwa/use-standalone";

/**
 * The switch that decides whether this device's screen lights up when a guest calls
 * a waiter.
 *
 * The browser's push API is old and awkward in two specific ways this component has
 * to absorb:
 *
 *   • The VAPID key must be handed over as a Uint8Array of raw bytes, but it is
 *     distributed as base64url text. There is no built-in conversion.
 *   • A push subscription can exist in the BROWSER while we have no row for it (a
 *     database reset), or while it belongs to whoever used this till before. So the
 *     browser's opinion is not sufficient — the server has to confirm the
 *     subscription is ours, and mine.
 */

/**
 * base64url text → the raw bytes the Push API insists on.
 *
 * Backed by an explicitly-constructed ArrayBuffer rather than `new Uint8Array(n)`.
 * Since TypeScript 5.7 the typed arrays are generic over their buffer, and the bare
 * form widens to `ArrayBufferLike` — which includes SharedArrayBuffer, which
 * `applicationServerKey` will not accept. Allocating the buffer ourselves pins it.
 */
function decodeVapidKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

type State =
  | "loading"
  | "insecure" // served over plain http — the browser will not allow push at all
  | "no-sw" // no service worker registered (a dev build), so there is nothing to push to
  | "unsupported" // a browser that genuinely cannot do this
  | "ios-needs-install"
  | "denied"
  | "off"
  | "on";

/**
 * `navigator.serviceWorker.ready` never rejects. If no worker is ever registered it
 * simply hangs — forever — and an `await` on it is an await that never returns.
 *
 * That is not a hypothetical: it is what happens in a dev build, where we deliberately
 * skip registration. The first version of this component awaited it bare, stayed stuck
 * in `loading`, and — because `loading` rendered `null` — silently showed the staff
 * member NOTHING. No button, no error. They would go to the Notifications screen,
 * find no way to turn alerts on, and conclude the feature does not exist.
 *
 * Which is exactly what happened. So: race it, and treat "still not ready" as an
 * answer rather than a state to sit in.
 */
function readyWithin(ms: number): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export function PushToggle() {
  const standalone = useStandalone();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const isIOS = useCallback(() => {
    const ua = navigator.userAgent;
    return (
      /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    );
  }, []);

  // Read the true state: secure context, then browser support, then a live worker,
  // then OS permission, then whether the subscription this browser holds is actually
  // registered to the person signed in.
  //
  // Every branch below must end in a state that SAYS something. A silent `null` is
  // how this feature quietly failed the first time.
  const refresh = useCallback(async () => {
    // The most common real-world failure, and the one that looks least like a failure.
    // Opening the app on a phone over the LAN — http://192.168.1.20:3000 — is not a
    // secure context, so the browser hides the service worker and PushManager
    // entirely. Everything looks fine. Nothing works. Only `localhost` is exempt, and
    // a phone is never localhost.
    if (!window.isSecureContext) {
      setState("insecure");
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // On iPhone this is the normal state until the app is installed: Safari exposes
      // no PushManager to a plain tab. Telling someone "not supported" when the real
      // answer is "add it to your Home Screen first" is the difference between a dead
      // end and a next step.
      setState(isIOS() && !standalone ? "ios-needs-install" : "unsupported");
      return;
    }

    const reg = await readyWithin(4000);
    if (!reg) {
      setState("no-sw");
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
    // subscription is one we know about, and whether it belongs to THIS staff member.
    setState((await isPushSubscribed(sub.endpoint)) ? "on" : "off");
  }, [isIOS, standalone]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        console.error("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set");
        setState("unsupported");
        return;
      }

      const reg = await navigator.serviceWorker.ready;

      // An existing subscription may have been created against a DIFFERENT VAPID key
      // (if the keys were ever rotated), and re-subscribing with a new key while an
      // old one is live throws InvalidStateError. Reusing whatever is there and only
      // creating one when there isn't sidesteps that entirely.
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          // Non-negotiable on every browser: a push MUST show the user something.
          // Silent push is not available to websites, by design.
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(key),
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
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Drop our row FIRST. If the browser-side unsubscribe succeeded but the
        // server call then failed, we would keep pushing to an endpoint that no
        // longer exists — harmless, but it churns until the push service 410s it.
        // This order fails safe in the opposite, quieter direction.
        await unsubscribeFromPush(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch (err) {
      console.error("[push] disable failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const shell = "rounded-xl border px-4 py-3 mb-4 flex items-center gap-3";
  const shellStyle = {
    background: "var(--color-canvas)",
    borderColor: "var(--color-hairline)",
  };

  // A small panel that explains itself, rather than an empty space that doesn't.
  const notice = (
    tint: string,
    Icon: typeof Bell,
    title: string,
    detail: string
  ) => (
    <div className={shell} style={shellStyle}>
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: tint + "18" }}
      >
        <Icon size={16} style={{ color: tint }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {title}
        </p>
        <p className="text-xs mt-0.5 leading-relaxed break-words" style={{ color: "var(--color-ink-mute)" }}>
          {detail}
        </p>
      </div>
    </div>
  );

  // Still working it out. Show a placeholder, not a hole — otherwise the panel pops
  // into existence a beat later and the layout jumps under the staff member's thumb.
  if (state === "loading") {
    return (
      <div className={shell} style={{ ...shellStyle, opacity: 0.6 }}>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
             style={{ background: "var(--color-ink-mute)" + "15" }}>
          <Loader2 size={16} className="animate-spin" style={{ color: "var(--color-ink-mute)" }} />
        </div>
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
          Checking alerts…
        </p>
      </div>
    );
  }

  // THE one that bit us. Served over plain http, so the browser refuses to expose a
  // service worker at all — and every symptom of that looks like "the feature is
  // missing" rather than "the connection is wrong".
  if (state === "insecure") {
    return notice(
      "var(--color-ruby)",
      ShieldAlert,
      "Alerts need a secure (https) connection",
      "This page is being served over plain http, so the browser blocks notifications " +
        "entirely. Open the app over https — a phone on your local network cannot use " +
        "localhost, so it needs a real https address or a tunnel."
    );
  }

  // A dev build: registration is skipped on purpose, so there is no worker to receive
  // a push. Say so, rather than presenting a button that cannot work.
  if (state === "no-sw") {
    return notice(
      "var(--color-lemon)",
      ShieldAlert,
      "Alerts are off in development",
      "The service worker isn't registered in a dev build, so nothing can receive a " +
        "push. Run a production build (npm run build, then npm start) to turn alerts on."
    );
  }

  if (state === "unsupported") {
    return notice(
      "var(--color-ink-mute)",
      BellOff,
      "This browser can't do notifications",
      "Alerts need a browser that supports web push — try Chrome or Edge on Android, " +
        "or install the app on iPhone."
    );
  }

  if (state === "ios-needs-install") {
    return (
      <div className={shell} style={shellStyle}>
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--color-lemon)" + "18" }}
        >
          <Smartphone size={16} style={{ color: "var(--color-lemon)" }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            Add to Home Screen to get alerts
          </p>
          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--color-ink-mute)" }}>
            On iPhone and iPad, Safari only delivers notifications to an installed app.
            Tap Share → Add to Home Screen, then open RestroSewa from your home screen.
          </p>
        </div>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className={shell} style={shellStyle}>
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--color-ruby)" + "15" }}
        >
          <BellOff size={16} style={{ color: "var(--color-ruby)" }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            Notifications are blocked
          </p>
          {/* Permission cannot be re-requested once denied — the browser will not even
              show the prompt again. Only the user can undo it, from browser settings,
              so saying "try again" would be a lie. */}
          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--color-ink-mute)" }}>
            You blocked notifications for this site. Re-enable them in your browser or
            phone settings — the app can no longer ask.
          </p>
        </div>
      </div>
    );
  }

  const on = state === "on";

  return (
    <div
      className="rounded-xl border mb-4 overflow-hidden"
      style={shellStyle}
    >
      <div className="px-4 py-3 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: (on ? "var(--color-primary)" : "var(--color-ink-mute)") + "15" }}
        >
          {on ? (
            <BellRing size={16} style={{ color: "var(--color-primary)" }} />
          ) : (
            <Bell size={16} style={{ color: "var(--color-ink-mute)" }} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {on ? "Alerts on for this device" : "Turn on alerts for this device"}
          </p>
          <p className="text-xs mt-0.5 break-words" style={{ color: "var(--color-ink-mute)" }}>
            {on
              ? "Waiter calls and bill requests will reach you even when the app is closed."
              : "Get woken for waiter calls and bill requests, even with the app closed."}
          </p>
        </div>

        <button
          type="button"
          onClick={on ? disable : enable}
          disabled={busy}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg text-xs font-medium border disabled:opacity-60"
          style={
            on
              ? { background: "var(--color-canvas)", color: "var(--color-ink-mute)", borderColor: "var(--color-hairline)" }
              : { background: "var(--color-primary)", color: "#fff", borderColor: "transparent" }
          }
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {busy ? "…" : on ? "Turn off" : "Turn on"}
        </button>
      </div>

      {/* Once it's on, the only question left is "did it actually work?" — and before
          this the only way to find out was to persuade a guest to tap "call waiter" and
          then hope. A quiet phone looks exactly the same whether the setup is broken or
          the feature was never built. */}
      {on && (
        <div
          className="px-4 py-2.5 border-t flex items-center justify-between gap-3"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
        >
          <p className="text-xs min-w-0 break-words" style={{ color: testResult ? "var(--color-ink)" : "var(--color-ink-mute)" }}>
            {testResult ?? "Not sure it's working? Send yourself one."}
          </p>
          <button
            type="button"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              setTestResult(null);
              try {
                const r = await sendTestPush();
                setTestResult(r.message);
                // A failure usually means the subscription died under us (cleared
                // browser data, reinstall). Re-read the truth rather than keep showing
                // a switch that says "on".
                if (!r.ok) void refresh();
              } catch {
                setTestResult("Couldn't reach the server.");
              } finally {
                setTesting(false);
              }
            }}
            className="shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg text-xs font-medium border disabled:opacity-60"
            style={{ background: "var(--color-canvas)", color: "var(--color-primary)", borderColor: "var(--color-hairline)" }}
          >
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {testing ? "Sending…" : "Test"}
          </button>
        </div>
      )}
    </div>
  );
}
