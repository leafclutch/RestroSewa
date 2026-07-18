"use client";

import { useEffect, useState } from "react";
import { PlatformLogo, PlatformWordmark, PoweredBy } from "@/components/branding/platform-logo";

const HOLD_MS = 1200; // the branded beat
const FADE_MS = 400; // …then it dissolves into the menu

/**
 * The branded moment between scanning the QR code and seeing the menu.
 *
 * It is an OVERLAY, not a separate route with a redirect. The menu is already
 * rendering underneath while this is on screen, so the splash spends time the
 * page was going to take anyway rather than adding a gate in front of it — a
 * redirect would have made the guest wait for a second navigation.
 *
 * Shown once per tab (sessionStorage): a guest who orders, browses back to the
 * menu and orders again should not sit through it every time.
 */
export function QrSplash({ slug }: { slug: string }) {
  // Start hidden. The very first paint must not flash the splash for a guest who
  // has already seen it — `null` means "haven't checked yet".
  const [show, setShow] = useState<boolean | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const key = `rs-splash:${slug}`;

    let seen = false;
    try {
      seen = sessionStorage.getItem(key) === "1";
    } catch {
      // Private mode / storage disabled — show it, never crash the menu over it.
    }

    if (seen) {
      setShow(false);
      return;
    }

    setShow(true);
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      /* not fatal */
    }

    const fade = setTimeout(() => setLeaving(true), HOLD_MS);
    const done = setTimeout(() => setShow(false), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [slug]);

  if (!show) return null;

  return (
    <div
      // aria-hidden: this is decoration. A screen-reader user should land on the
      // menu itself, not be read a loading screen that is about to vanish.
      aria-hidden="true"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center"
      style={{
        background: "linear-gradient(140deg, var(--color-brand-dark), var(--color-primary) 160%)",
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
        // Once it starts fading it must not swallow a tap meant for the menu.
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
@keyframes rs-splash-in   { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
@keyframes rs-splash-bar  { 0% { transform:translateX(-100%) } 100% { transform:translateX(100%) } }
@media (prefers-reduced-motion: reduce) {
  .rs-splash-mark, .rs-splash-bar { animation: none !important }
}`,
        }}
      />

      <div
        className="rs-splash-mark flex flex-col items-center gap-4"
        style={{ animation: "rs-splash-in .5s cubic-bezier(.2,.8,.2,1) both" }}
      >
        <PlatformLogo size={84} priority />
        <PlatformWordmark size="clamp(30px, 9vw, 44px)" letterSpacing="-0.8px" />
      </div>

      {/* An indeterminate sweep rather than a spinner — it reads as "loading"
          without pretending to know a percentage. */}
      <div
        className="mt-6 overflow-hidden rounded-full"
        style={{ width: 132, height: 3, background: "rgba(255,255,255,0.16)" }}
      >
        <div
          className="rs-splash-bar h-full rounded-full"
          style={{
            width: "60%",
            background: "rgba(255,255,255,0.85)",
            animation: "rs-splash-bar 1.1s ease-in-out infinite",
          }}
        />
      </div>

      <div className="absolute bottom-8">
        <PoweredBy height={16} tone="light" />
      </div>
    </div>
  );
}
