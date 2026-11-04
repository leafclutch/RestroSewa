"use client";

import { useEffect } from "react";

/**
 * Fades `[data-reveal]` elements up as they scroll into view. Arms itself by adding `js-reveal`
 * to <html> (so with no JS nothing is ever hidden), reveals each element once, and removes the
 * class again when the landing page unmounts so other pages are unaffected.
 */
export function Reveal() {
  useEffect(() => {
    const root = document.documentElement;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!("IntersectionObserver" in window) || els.length === 0) return;

    root.classList.add("js-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.setAttribute("data-revealed", "");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));

    return () => {
      io.disconnect();
      root.classList.remove("js-reveal");
    };
  }, []);

  return null;
}
