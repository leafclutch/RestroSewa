"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Drag down from the top of the page to refetch.
 *
 * Why hand-rolled rather than left to the browser: in an INSTALLED app there is no
 * browser pull-to-refresh to inherit. iOS standalone has never had one, and we
 * switched Chrome's off in globals.css (`overscroll-behavior-y: none`) because its
 * rubber-band exposes a blank strip where the address bar used to be. So without
 * this, the one gesture every phone user reaches for by reflex — pull down to see
 * if anything changed — does nothing at all. On a floor where the answer changes
 * every thirty seconds, that is the gesture that matters most.
 *
 * It refreshes through `router.refresh()`, which refetches the server components on
 * the current route. So it goes through the same permission-checked server actions
 * as every other read: pulling cannot show a staff member anything they could not
 * already see, and there is no second data path to keep in sync.
 */

const THRESHOLD = 70; // px of pull before it commits
const MAX_PULL = 110; // past this the rubber band stops giving

/** Would this touch scroll something else? Then it isn't a page pull. */
function insideScrolledContainer(start: EventTarget | null): boolean {
  let node = start instanceof Element ? start : null;

  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const scrolls = /(auto|scroll)/.test(style.overflowY);
    // Only a container that is scrolled AWAY from its own top steals the gesture.
    // One already at the top (the notification list, say) should hand the pull up
    // to the page, exactly as a native scroll view would.
    if (scrolls && node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return false;
}

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pull, setPull] = useState(0);

  // Touch bookkeeping lives in refs: it changes on every frame of a drag, and
  // re-rendering the whole page sixty times a second to track a finger would make
  // the gesture stutter — which is precisely the thing it exists to avoid.
  const startY = useRef(0);
  const dragging = useRef(false);
  const armed = useRef(false);

  // The window listeners below are bound ONCE — re-binding them on every frame of a
  // drag would be absurd — so the touchend handler closes over the `pull` from the
  // render that created it, which is always 0. This ref is how it reads the pull
  // distance as it actually stands when the finger lifts.
  const pullRef = useRef(0);
  pullRef.current = pull;

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      // Only a pull that begins at the very top of the page is a refresh. Anywhere
      // else it's an ordinary scroll.
      if (window.scrollY > 0) return;
      if (insideScrolledContainer(e.target)) return;
      if (e.touches.length !== 1) return;

      startY.current = e.touches[0].clientY;
      dragging.current = true;
      armed.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;

      const dy = e.touches[0].clientY - startY.current;

      // Dragging UP, or the page has scrolled under us mid-gesture: not a pull.
      if (dy <= 0 || window.scrollY > 0) {
        dragging.current = false;
        setPull(0);
        return;
      }

      // Now we're sure. Claim the gesture so the page doesn't also scroll.
      // (Requires the listener to be non-passive — see addEventListener below.)
      if (e.cancelable) e.preventDefault();
      armed.current = true;

      // Resistance: the further you pull the less it gives, so the band has an end
      // you can feel rather than sliding forever.
      const eased = MAX_PULL * (1 - Math.exp(-dy / MAX_PULL));
      setPull(eased);
    };

    const onTouchEnd = () => {
      if (!dragging.current) return;
      dragging.current = false;

      const committed = armed.current && pullRef.current >= THRESHOLD;
      setPull(0);
      if (committed) refresh();
    };

    // `passive: false` is the whole trick. Touch listeners default to passive,
    // and a passive listener is FORBIDDEN from calling preventDefault — so without
    // this the page would scroll underneath the gesture and the pull would never
    // take hold.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refresh]);

  const active = pull > 0 || pending;
  const ready = pull >= THRESHOLD;

  return (
    <>
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 flex justify-center pointer-events-none pt-safe"
        style={{
          transform: `translateY(${pending ? 20 : Math.max(0, pull - 24)}px)`,
          opacity: active ? 1 : 0,
          transition: pull === 0 ? "transform 220ms ease, opacity 220ms ease" : "none",
        }}
      >
        <div
          className="flex items-center justify-center w-9 h-9 rounded-full shadow-lg"
          style={{ background: "var(--color-canvas)", border: "1px solid var(--color-hairline)" }}
        >
          <RefreshCw
            size={16}
            className={pending ? "animate-spin" : undefined}
            style={{
              color: ready || pending ? "var(--color-primary)" : "var(--color-ink-mute)",
              // Before it commits, the icon winds up with the pull — so the gesture
              // tells you how much further to go without any text.
              transform: pending ? undefined : `rotate(${(pull / THRESHOLD) * 270}deg)`,
              transition: "color 120ms ease",
            }}
          />
        </div>
      </div>

      <div
        style={{
          transform: pull > 0 ? `translateY(${pull * 0.4}px)` : undefined,
          transition: pull === 0 ? "transform 220ms cubic-bezier(0.22,0.61,0.36,1)" : "none",
        }}
      >
        {children}
      </div>
    </>
  );
}
