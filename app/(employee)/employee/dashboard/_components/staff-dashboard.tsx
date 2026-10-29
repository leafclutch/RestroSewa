"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ListOrdered, Banknote, LayoutGrid, BedDouble, BookOpen, ChevronDown, HandCoins, ShoppingBag, Boxes, ShoppingCart, Truck, Receipt, Wallet, ChartColumn } from "lucide-react";
import { accentOf } from "@/lib/section-colors";
import { PlatformLogo, PlatformWordmark } from "@/components/branding/platform-logo";
import { SectionBadgesContext, type SectionBadge } from "./section-badges";

export type SectionKey = "orders" | "tables" | "walkins" | "rooms" | "sales" | "credits" | "menu" | "stock" | "purchases" | "vendors" | "itemSales" | "expenses" | "payroll";

export type DashboardSection = {
  key: SectionKey;
  title: string;
  subtitle?: string;
  body: React.ReactNode;
  // A `bare` section renders its own card chrome (e.g. the self-managing Orders
  // section) — the dashboard only supplies the grid cell + scroll anchor.
  bare?: boolean;
};

// `style` is part of the contract now: the quick-nav tints each icon with its section accent.
const SECTION_ICON: Record<
  SectionKey,
  React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>
> = {
  orders: ListOrdered,
  tables: LayoutGrid,
  walkins: ShoppingBag,
  rooms: BedDouble,
  sales: Banknote,
  credits: HandCoins,
  menu: BookOpen,
  stock: Boxes,
  purchases: ShoppingCart,
  vendors: Truck,
  itemSales: ChartColumn,
  expenses: Receipt,
  payroll: Wallet,
};

/**
 * What a section shows while its data is still in flight.
 *
 * Each section streams in on its own now, so the page has to look deliberate
 * while they land rather than jumping as each one arrives. Fixed heights, so the
 * layout doesn't reflow underneath a cashier who has already started reading.
 */
export function SectionSkeleton({ bare }: { bare?: boolean }) {
  const bars = (
    <div className="flex flex-col gap-2.5" aria-hidden>
      {[100, 72, 88].map((w, i) => (
        <div
          key={i}
          className="rounded-lg animate-pulse"
          style={{ height: 14, width: `${w}%`, background: "var(--color-canvas-soft)" }}
        />
      ))}
    </div>
  );

  if (bare) {
    return (
      <div
        className="rounded-2xl border px-4 sm:px-5 py-4"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        {bars}
      </div>
    );
  }
  return <div className="py-2">{bars}</div>;
}

function HeaderBadge({ badge, accent }: { badge: SectionBadge; accent: { color: string; soft: string } }) {
  const tone = badge.tone ?? accent;
  const style =
    badge.variant === "solid"
      ? { background: badge.fill ?? tone.color, color: "#fff", borderColor: badge.fill ?? tone.color }
      : badge.variant === "muted"
      ? { background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)", borderColor: "var(--color-hairline-input)" }
      : { background: tone.soft, color: `color-mix(in srgb, ${tone.color} 72%, var(--color-ink))`, borderColor: tone.color };
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full whitespace-nowrap border"
      style={style}
    >
      <span className="tabular font-medium">{badge.n}</span>
      {badge.label}
    </span>
  );
}

function SectionCard({ section, className }: { section: DashboardSection; className?: string }) {
  // Collapsible so a tall section (Menu, Sales) doesn't bury the ones below it.
  // Everything stays mounted (just height-collapsed) so embedded pollers keep
  // running. Uses the grid-rows 0fr→1fr trick for a smooth animation.
  const [open, setOpen] = useState(true);
  // Live counts published by the grid inside (see section-badges.tsx).
  const [badges, setBadges] = useState<SectionBadge[] | null>(null);
  const Icon = SECTION_ICON[section.key];
  const accent = accentOf(section.key);

  return (
    <section
      id={`sec-${section.key}`}
      className={`rounded-2xl border overflow-hidden ${className ?? ""}`}
      // A full outline in the section's colour, so each card reads as its own block on the
      // tinted page — the colour says which section before the title is read.
      style={{
        background: "var(--color-canvas)",
        borderColor: accent.color,
        borderWidth: 2,
        boxShadow: "var(--shadow-card-lg)",
        scrollMarginTop: 150,
      }}
    >
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 transition-colors hover:bg-canvas-soft">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-3 text-left"
        >
          <span
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border"
            style={{ background: accent.soft, color: accent.color, borderColor: accent.color }}
          >
            <Icon size={21} strokeWidth={1.9} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-lg font-semibold" style={{ color: "var(--color-ink)" }}>{section.title}</span>
            {section.subtitle && (
              <span className="block text-sm truncate" style={{ color: "var(--color-ink-mute)" }}>{section.subtitle}</span>
            )}
          </span>
        </button>
        {badges && badges.length > 0 && (
          <span className="hidden sm:inline-flex items-center gap-1.5 flex-wrap justify-end">
            {badges.map((b) => (
              <HeaderBadge key={b.label} badge={b} accent={accent} />
            ))}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? `Collapse ${section.title}` : `Expand ${section.title}`}
          aria-expanded={open}
          className="shrink-0"
        >
        <ChevronDown
          size={20}
          strokeWidth={2}
          className="shrink-0 transition-transform duration-300"
          style={{ color: "var(--color-ink)", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
        </button>
      </div>

      {/* Phones: the counts drop under the title rather than squeezing it. */}
      {badges && badges.length > 0 && (
        <div className="sm:hidden flex items-center gap-1.5 flex-wrap px-4 -mt-1 pb-3">
          {badges.map((b) => (
            <HeaderBadge key={b.label} badge={b} accent={accent} />
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 0.3s ease" }}>
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div data-section-body className="mx-4 sm:mx-5 border-t py-4" style={{ borderColor: "var(--color-hairline)" }}>
            <SectionBadgesContext.Provider value={setBadges}>{section.body}</SectionBadgesContext.Provider>
          </div>
        </div>
      </div>
    </section>
  );
}

// The single-page staff dashboard: every section the staff member is permitted to
// see, stacked full-width in a single wide column. Each section fills the width
// and reflows its OWN content with responsive grids (Tables auto-fill cards,
// Sales auto-fit stat tiles) — so sections use the space without being squeezed
// into narrow half-columns. Orders stays first (most-used).
export function StaffDashboard({
  sections,
  focus,
  canMockBill = false,
}: {
  sections: DashboardSection[];
  /** Section to scroll to on arrival — set when a bill was just put on credit. */
  focus?: SectionKey | null;
  /**
   * Shows the discreet "M" shortcut to the PIN-gated mock-billing workspace. Computed
   * server-side from `close_bills` + a Security PIN being set; hiding it is convenience
   * only, since both the route and the unlock action re-check.
   */
  canMockBill?: boolean;
}) {
  // The quick-nav pill that's lit: the section currently at the top of the screen. A tap
  // lights its pill at once and holds it while the smooth scroll passes the others.
  const [current, setCurrent] = useState<SectionKey | null>(sections[0]?.key ?? null);
  const jumpingUntil = useRef(0);
  const jump = (key: SectionKey) => {
    setCurrent(key);
    jumpingUntil.current = Date.now() + 900;
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const sectionKeys = sections.map((s) => s.key).join(",");
  useEffect(() => {
    const keys = sectionKeys.split(",").filter(Boolean) as SectionKey[];
    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() < jumpingUntil.current) return;
      // The last section whose top has passed the line just under the sticky quick-nav.
      // At the very bottom of the page, the last section wins even if it's short.
      const line = 170;
      let pick: SectionKey | null = keys[0] ?? null;
      for (const k of keys) {
        const el = document.getElementById(`sec-${k}`);
        if (el && el.getBoundingClientRect().top - line <= 0) pick = k;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        pick = keys[keys.length - 1] ?? pick;
      }
      setCurrent((c) => (c === pick ? c : pick));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sectionKeys]);

  // Keep the lit pill in view inside the horizontally-scrolling row.
  const navRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!current) return;
    const pill = navRow.current?.querySelector<HTMLElement>(`[data-key="${current}"]`);
    pill?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [current]);

  // Arriving pointed at a section — a credit bill just closed, or a tapped push —
  // scroll there rather than leaving the staff member at the top hunting for it.
  //
  // The target may not exist yet: every section streams in under its own <Suspense>,
  // so #sec-orders can be a skeleton (or nothing) for a beat after mount. So retry
  // until it lands rather than firing once at 50ms and missing. Once it's scrolled,
  // strip ?focus from the URL so a pull-to-refresh doesn't yank the page back down.
  //
  // Then KEEP it there while the page settles. The sections ABOVE the target (Orders,
  // Tables, Walk-ins …) are still skeletons when it first appears; as each fills in it
  // grows and shoves the target down — so a closed bill landed on Sales, and a beat later
  // the screen behind the print preview was showing Walk-ins. For ~4s (or until staff
  // scroll / touch / press a key themselves) the target is re-pinned whenever it drifts.
  useEffect(() => {
    if (!focus) return;
    let tries = 0;
    let found = false;
    let userMoved = false;
    const stopFollowing = () => { userMoved = true; };
    const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    events.forEach((ev) => window.addEventListener(ev, stopFollowing, { passive: true }));

    // Where the sticky quick-nav ends — scrollIntoView({block:"start"}) aims for 0, so
    // that's the resting offset to compare against, with a little slack.
    const drifted = (el: HTMLElement) => Math.abs(el.getBoundingClientRect().top) > 120;

    const timer = setInterval(() => {
      const el = document.getElementById(`sec-${focus}`);
      if (!found) {
        if (el) {
          found = true;
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          const url = new URL(window.location.href);
          if (url.searchParams.has("focus")) {
            url.searchParams.delete("focus");
            window.history.replaceState(null, "", url.pathname + url.search);
          }
        } else if (++tries > 30) {
          // ~3s and it never appeared (the staff member lacks that section): give up
          // quietly rather than spin forever.
          clearInterval(timer);
        }
        return;
      }
      // Following phase: ~4s after it was found.
      if (userMoved || ++tries > 30 + 40 || !el) {
        clearInterval(timer);
        return;
      }
      if (drifted(el)) el.scrollIntoView({ behavior: "auto", block: "start" });
    }, 100);

    return () => {
      clearInterval(timer);
      events.forEach((ev) => window.removeEventListener(ev, stopFollowing));
    };
  }, [focus]);

  return (
    <div className="pb-10 pt-1.5">

      {/* Quick-nav — sticky under the top bar. Shows when there's more than one section to
          jump between, OR when the mock-bill shortcut needs somewhere to live: a cashier
          with thin permissions must not lose the button just because the row is short. */}
      {(sections.length > 1 || canMockBill) && (
        <div
          // Parks directly under the sticky top bar (56px) rather than sliding
          // beneath it. z-30 keeps it below the bar and its notification panel.
          className="sticky z-30 px-3 sm:px-5 lg:px-10 py-2.5"
          style={{
            top: 56,
          }}
        >
          <div
            className="w-full flex items-center gap-2 rounded-full border p-2 bg-canvas/90 backdrop-blur-md"
            style={{ borderColor: "var(--color-hairline)", boxShadow: "var(--shadow-card)" }}
          >
          <div ref={navRow} className="flex gap-2 overflow-x-auto flex-1 min-w-0" style={{ scrollbarWidth: "none" }}>
            {sections.map((s) => {
              const Icon = SECTION_ICON[s.key];
              const accent = accentOf(s.key);
              const lit = current === s.key;
              return (
                <button
                  key={s.key}
                  data-key={s.key}
                  type="button"
                  onClick={() => jump(s.key)}
                  aria-current={lit ? "true" : undefined}
                  // Every pill wears its section's colour (tint + coloured border and text); the
                  // section on screen — or just tapped — fills solid with white text, like a
                  // pressed button. Hover previews that fill.
                  className="inline-flex items-center gap-2 shrink-0 text-[15px] font-semibold px-5 py-3 rounded-full border-[1.5px] transition-all duration-200 active:scale-95 hover:bg-[var(--pill-fill)]! hover:border-[var(--pill-fill)]! hover:text-white!"
                  style={
                    {
                      "--pill-fill": accent.fill,
                      letterSpacing: "-0.1px",
                      ...(lit
                        ? { background: accent.fill, borderColor: accent.fill, color: "#fff", boxShadow: "0 2px 8px rgba(15,23,42,0.18)" }
                        : { background: accent.soft, borderColor: accent.color, color: `color-mix(in srgb, ${accent.color} 72%, var(--color-ink))` }),
                    } as unknown as React.CSSProperties
                  }
                >
                  <Icon size={17} strokeWidth={2.1} />
                  {s.title}
                </button>
              );
            })}
          </div>

            {/* Mock billing. Sits OUTSIDE the scroller so it stays put while the section
                chips scroll under a thumb, and stays quiet — hairline and muted ink, not a
                tinted section chip — because it is a back-office tool, not part of the
                floor workflow. The PIN is asked for on the page itself. */}
            {canMockBill && (
              <Link
                href="/employee/mock-bill"
                aria-label="Mock bill"
                title="Mock bill"
                className="shrink-0 w-12 h-12 rounded-full border flex items-center justify-center text-sm font-medium bg-canvas transition-all duration-200 active:scale-95 shadow-xs"
                style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
              >
                M
              </Link>
            )}
          </div>
        </div>
      )}

      {sections.length === 0 ? (
        <div className="max-w-3xl mx-auto px-3 sm:px-5 pt-4">
          <div
            className="rounded-2xl border px-6 py-12 text-center"
            style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
              You don&apos;t have access to any dashboard sections yet. Ask your admin to update your permissions.
            </p>
          </div>
        </div>
      ) : (
        <div className="w-full px-3 sm:px-5 lg:px-10 pt-2 flex flex-col gap-5">
          {sections.map((s) =>
            s.bare ? (
              <div key={s.key} id={`sec-${s.key}`} style={{ scrollMarginTop: 150 }}>
                {s.body}
              </div>
            ) : (
              <SectionCard key={s.key} section={s} />
            )
          )}
        </div>
      )}

      {/* A quiet platform mark at the very bottom. The RESTAURANT leads the top bar; HRestroSewa
          sits underneath here so the app is still signed without competing for the header. Theme
          -aware: the emblem carries its own background, and the wordmark's base tracks --color-ink
          (tone="dark") so it flips with the dashboard's light/dark. */}
      <div className="mt-10 pt-6 flex flex-col items-center gap-2">
        <PlatformLogo size={30} />
        <PlatformWordmark size={14} tone="dark" letterSpacing="-0.2px" />
      </div>
    </div>
  );
}
