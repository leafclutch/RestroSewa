"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

/**
 * The section menu for phones and tablets (the full link row only fits from `lg`). Closes when a
 * link is chosen, on Esc, and when the viewport grows past the breakpoint.
 */
export function MobileMenu({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const mq = window.matchMedia("(min-width: 1024px)");
    const onMq = () => mq.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex size-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10"
      >
        {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>

      {open && (
        <div
          id="mobile-menu"
          className="absolute inset-x-0 top-full border-b border-white/10 bg-[#0b1230]/98 shadow-2xl shadow-black/40 backdrop-blur"
        >
          <ul className="mx-auto flex max-w-6xl flex-col px-4 py-3 sm:px-6">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-3 text-[15px] text-white/85 transition-colors hover:bg-white/5 hover:text-white"
                >
                  {l.label}
                </a>
              </li>
            ))}
            <li className="mt-2 border-t border-white/10 pt-3 sm:hidden">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-3 text-[15px] text-white/85 hover:bg-white/5 hover:text-white"
              >
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
