"use client";

import { useEffect, useState } from "react";

/**
 * True when the app is running as an INSTALLED app rather than in a browser tab.
 *
 * Two ways to be installed, and they disagree:
 *   • everyone else — the `display-mode: standalone` media query
 *   • iOS Safari    — a non-standard `navigator.standalone`, because Apple shipped
 *                     home-screen apps years before the spec existed and never
 *                     retired the old flag
 *
 * Always false on the first client render, then corrected in an effect. Reading
 * either signal during render would produce markup the server could not have
 * produced (it has no window), which is a hydration mismatch.
 */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");

    const sync = () =>
      setStandalone(
        mq.matches ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (navigator as any).standalone === true
      );

    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return standalone;
}
