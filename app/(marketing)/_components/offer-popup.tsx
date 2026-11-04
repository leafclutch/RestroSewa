"use client";

import { useEffect, useRef } from "react";
import { Check, Sparkles, X } from "lucide-react";

export type PopupPlan = {
  name: string;
  tables: string;
  listPrice: string;
  offerPrice: string;
  saving: string;
  renewal: string;
  featured?: boolean;
};

const STORAGE_KEY = "hrs_offer_popup_dismissed_at";
const SNOOZE_MS = 24 * 60 * 60 * 1000; // show again after a day, not on every visit
const OPEN_DELAY_MS = 1700; // after the page loader has faded

/**
 * The festive-offer popup shown shortly after the landing page opens. A native <dialog> opened
 * with showModal(), so focus is trapped inside, Esc closes it, and the page behind is inert —
 * no hand-rolled focus management. Dismissal is remembered per browser for a day.
 */
export function OfferPopup({ offerName, plans, claimHref }: { offerName: string; plans: PopupPlan[]; claimHref: string }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let dismissedAt = 0;
    try {
      dismissedAt = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
    } catch {
      /* storage blocked — just show it */
    }
    if (Date.now() - dismissedAt < SNOOZE_MS) return;

    const t = window.setTimeout(() => {
      const d = ref.current;
      if (d && !d.open) d.showModal();
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  function remember() {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  function close() {
    ref.current?.close();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="offer-popup-title"
      onClose={remember}
      // A click on the backdrop lands on the <dialog> element itself, not its content.
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-lg overflow-y-auto rounded-3xl bg-[var(--l-surface)] p-0 text-[var(--l-ink)] shadow-2xl backdrop:bg-[#0b1230]/70 backdrop:backdrop-blur-sm open:animate-[offer-pop_0.35s_cubic-bezier(0.22,1,0.36,1)]"
    >
      <style>{`
        @keyframes offer-pop { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { dialog[open] { animation: none !important; } }
      `}</style>

      <div className="relative bg-gradient-to-br from-[#c2410c] via-[#ea580c] to-[#d97706] px-5 pb-6 pt-7 text-white sm:px-8 sm:pb-7 sm:pt-8">
        <button
          type="button"
          onClick={close}
          aria-label="Close offer"
          className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <X className="size-4" aria-hidden />
        </button>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
          <Sparkles className="size-3.5" aria-hidden /> Limited festive offer
        </p>
        <h2 id="offer-popup-title" className="mt-4 pr-8 text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[32px]">
          {offerName}
        </h2>
        <p className="mt-2 text-[15px] text-white/90">
          Celebrate Dashain and Tihar with a new system for your restaurant or hotel — and save on your first year.
        </p>
      </div>

      <div className="px-5 pb-6 pt-5 sm:px-8 sm:pb-7 sm:pt-6">
        <ul className="grid grid-cols-2 gap-2 sm:gap-3">
          {plans.map((p) => (
            <li
              key={p.name}
              className={`rounded-2xl border p-3 sm:p-4 ${p.featured ? "border-white/10 bg-[#0b1230] text-white" : "border-[var(--l-line)] bg-[var(--l-soft)]"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-semibold">{p.name}</span>
                <span className="rounded bg-[#f97316] px-1.5 py-0.5 text-[11px] font-semibold text-white">Save {p.saving}</span>
              </div>
              <p className={`mt-0.5 text-xs ${p.featured ? "text-white/60" : "text-[var(--l-mute)]"}`}>{p.tables}</p>
              <p className={`mt-3 text-sm line-through ${p.featured ? "text-white/45" : "text-[var(--l-mute)]"}`}>{p.listPrice}</p>
              <p className="text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">{p.offerPrice}</p>
              <p className={`text-xs ${p.featured ? "text-white/60" : "text-[var(--l-mute)]"}`}>first year<br />Renews at {p.renewal}/yr</p>
            </li>
          ))}
        </ul>

        <ul className="mt-5 space-y-1.5 text-sm text-[var(--l-body)]">
          {["One-week free trial before you pay", "Setup and staff training included", "Works on your phones, tablets and PC"].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <Check className="size-4 shrink-0 text-[var(--l-green)]" aria-hidden />
              {t}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <a
            href={claimHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="inline-flex flex-1 items-center justify-center rounded-full bg-[#22c55e] px-5 py-3 text-sm font-semibold text-[#052e16] transition-colors hover:bg-[#4ade80] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803d]"
          >
            Claim on WhatsApp
          </a>
          <a
            href="#pricing"
            onClick={close}
            className="inline-flex flex-1 items-center justify-center rounded-full border border-[var(--l-line)] px-5 py-3 text-sm font-medium transition-colors hover:bg-[var(--l-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803d]"
          >
            Compare plans
          </a>
        </div>
      </div>
    </dialog>
  );
}
