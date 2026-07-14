"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2, Smartphone } from "lucide-react";
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from "@/app/actions/push";
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

type State = "loading" | "unsupported" | "ios-needs-install" | "denied" | "off" | "on";

export function PushToggle() {
  const standalone = useStandalone();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  const isIOS = useCallback(() => {
    const ua = navigator.userAgent;
    return (
      /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    );
  }, []);

  // Read the true state: browser support, then OS permission, then whether the
  // subscription this browser holds is actually registered to the person signed in.
  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // On iPhone this is the normal state until the app is installed: Safari exposes
      // no PushManager to a plain tab. Telling someone "not supported" when the real
      // answer is "add it to your Home Screen first" is the difference between a dead
      // end and a next step.
      setState(isIOS() && !standalone ? "ios-needs-install" : "unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    const reg = await navigator.serviceWorker.ready;
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

  if (state === "loading" || state === "unsupported") return null;

  const shell = "rounded-xl border px-4 py-3 mb-4 flex items-center gap-3";
  const shellStyle = {
    background: "var(--color-canvas)",
    borderColor: "var(--color-hairline)",
  };

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
    <div className={shell} style={shellStyle}>
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
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
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
  );
}
