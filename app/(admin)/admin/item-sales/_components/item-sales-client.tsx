"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CalendarDays, Search, X } from "lucide-react";
import { getItemSalesReport } from "@/app/actions/item-sales";
import type { ItemSalesPeriod, ItemSalesReport, ItemSalesRow } from "@/app/actions/item-sales";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { useCurrency } from "@/components/currency-provider";

// `short` is what a phone shows, so all five fit on one row without scrolling.
const PERIODS: { key: Exclude<ItemSalesPeriod, "day">; label: string; short: string }[] = [
  { key: "today", label: "Today", short: "Today" },
  { key: "yesterday", label: "Yesterday", short: "Yesterday" },
  { key: "month", label: "This month", short: "Month" },
  { key: "year", label: "This year", short: "Year" },
  { key: "all", label: "All time", short: "All" },
];

const MEDALS = ["🥇", "🥈", "🥉"];

// Each block is its own lifted card so categories read as separate tables.
const CARD: React.CSSProperties = {
  background: "var(--color-canvas)",
  borderColor: "var(--color-hairline)",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06), 0 4px 14px rgba(15, 23, 42, 0.06)",
};

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Finishes the sentence "N items sold …". */
function whenPhrase(r: ItemSalesReport) {
  switch (r.period) {
    case "today": return "today";
    case "yesterday": return "yesterday";
    case "month": return "this month";
    case "year": return "this year";
    case "all": return "in total";
    case "day": return r.day ? `on ${fmtDay(r.day)}` : "";
  }
}

/**
 * Share of the period's TOTAL sales value. Every row — top 3, category and item —
 * uses this one denominator, so two bars of the same length always mean the same
 * share of the money. Small shares keep a decimal so 0.4% doesn't read as 0%.
 */
function shareOf(amount: number, total: number) {
  const v = total > 0 ? (amount / total) * 100 : 0;
  return { value: v, label: `${v > 0 && v < 10 ? v.toFixed(1) : Math.round(v)}%` };
}

function ShareCell({ amount, total, strong = false }: { amount: number; total: number; strong?: boolean }) {
  const s = shareOf(amount, total);
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs tabular-nums" style={{ color: strong ? "var(--color-ink)" : "var(--color-ink-mute)", fontWeight: strong ? 500 : 400 }}>
        {s.label}
      </span>
      <div className="h-1 w-full rounded-full" style={{ background: "var(--color-hairline)" }}>
        <div className="h-1 rounded-full" style={{ width: `${Math.min(100, s.value)}%`, background: "var(--sec-sales)" }} />
      </div>
    </div>
  );
}

export function ItemSalesClient({ initial, embedded = false }: { initial: ItemSalesReport; embedded?: boolean }) {
  const cur = useCurrency();
  const [report, setReport] = useState<ItemSalesReport>(initial);
  const [period, setPeriod] = useState<ItemSalesPeriod>(initial.period);
  const [day, setDay] = useState<string>(initial.day ?? "");
  const [query, setQuery] = useState("");
  const [loading, startTransition] = useTransition();
  const activeRef = useRef(true);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  const load = useCallback((p: ItemSalesPeriod, d?: string) => {
    startTransition(async () => {
      try {
        const next = await getItemSalesReport({ period: p, day: d ?? null });
        if (activeRef.current) setReport(next);
      } catch {
        // keep the last report on a transient failure
      }
    });
  }, []);

  const selectPeriod = (p: Exclude<ItemSalesPeriod, "day">) => {
    setPeriod(p);
    setDay("");
    load(p);
  };

  const pickDay = (d: string) => {
    if (!d) return selectPeriod("today");
    setDay(d);
    setPeriod("day");
    load("day", d);
  };

  const openPicker = () => {
    const el = dateRef.current;
    if (!el) return;
    // showPicker is the only way to open a native date input from another control;
    // older browsers lack it, so fall back to focusing the (visually hidden) input.
    try { el.showPicker(); } catch { el.focus(); }
  };

  // A bill closed at any till changes what has sold.
  const resync = useCallback(() => load(period, day || undefined), [load, period, day]);
  useRealtime(["billing"], resync);

  const q = query.trim().toLowerCase();
  const categories = useMemo(
    () =>
      q
        ? report.categories
            .map((c) => ({ ...c, items: c.items.filter((i) => i.name.toLowerCase().includes(q)) }))
            .filter((c) => c.items.length > 0)
        : report.categories,
    [report.categories, q]
  );

  const totalQty = report.totalQuantity;
  const totalAmt = report.totalRevenue;

  return (
    <div className={embedded ? "" : "p-4 sm:p-6 lg:p-8"}>
      {!embedded && (
        <h1 className="text-xl mb-4" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
          Item Sales
        </h1>
      )}

      {/* Header: filters, then the summary. On a phone they stack (filters first, so the
          thumb reaches them); on a wide screen they share one row — summary left, filters right. */}
      <div className="flex flex-col gap-4 mb-5 lg:flex-row-reverse lg:items-center lg:justify-between">
        {/* Period — the five periods always fit the width (equal columns on a phone);
            the day picker sits on its own line below them on a phone, beside them on desktop. */}
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <div className="grid grid-cols-5 w-full sm:flex sm:w-auto rounded-full p-1" style={{ background: "var(--color-canvas-soft)", border: "1px solid var(--color-hairline)" }}>
            {PERIODS.map((p) => {
              const active = period === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => selectPeriod(p.key)}
                  aria-pressed={active}
                  className="text-xs sm:text-sm px-1 sm:px-3 py-1.5 rounded-full whitespace-nowrap transition-colors"
                  style={{
                    background: active ? "var(--fill-green)" : "transparent",
                    color: active ? "#fff" : "var(--color-ink-mute)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  <span className="sm:hidden">{p.short}</span>
                  <span className="hidden sm:inline">{p.label}</span>
                </button>
              );
            })}
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={openPicker}
              aria-pressed={period === "day"}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-full border whitespace-nowrap"
              style={{
                background: period === "day" ? "var(--fill-green)" : "var(--color-canvas)",
                borderColor: period === "day" ? "var(--fill-green)" : "var(--color-hairline)",
                color: period === "day" ? "#fff" : "var(--color-ink-mute)",
              }}
            >
              <CalendarDays size={14} />
              {period === "day" && day ? fmtDay(day) : "Pick day"}
            </button>
            {period === "day" && (
              <button
                type="button"
                onClick={() => selectPeriod("today")}
                aria-label="Clear day"
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                style={{ background: "var(--color-ink)", color: "var(--color-canvas)" }}
              >
                <X size={10} />
              </button>
            )}
            <input
              ref={dateRef}
              type="date"
              value={day}
              max={report.businessToday}
              onChange={(e) => pickDay(e.target.value)}
              tabIndex={-1}
              aria-hidden
              className="absolute inset-0 opacity-0 pointer-events-none"
            />
          </div>
        </div>
          {/* The period's headline figure: tinted so it stands out, quiet enough not to shout. */}
          <div
            className="rounded-xl border px-4 py-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 lg:shrink-0"
            style={{ background: "var(--sec-sales-soft)", borderColor: "color-mix(in srgb, var(--sec-sales) 25%, transparent)", opacity: loading ? 0.6 : 1 }}
          >
            <span className="text-xl tabular-nums" style={{ color: "var(--sec-sales)", fontWeight: 600 }}>{totalQty}</span>
            <span className="text-sm" style={{ color: "var(--color-ink)" }}>items sold {whenPhrase(report)}</span>
            {totalQty > 0 && (
              <>
                <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>worth</span>
                <span className="text-xl tabular-nums" style={{ color: "var(--sec-sales)", fontWeight: 600 }}>{cur.money(totalAmt)}</span>
              </>
            )}
            {loading && <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>(updating…)</span>}
          </div>
      </div>

      <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 150ms" }}>

        {totalQty === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-12 text-center" style={{ borderColor: "var(--color-hairline)" }}>
            <p className="text-sm" style={{ color: "var(--color-ink)" }}>No items billed {period === "day" ? "on this day" : "in this period"}.</p>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-mute)" }}>Items show up here once their bill is paid.</p>
          </div>
        ) : (
          <>
            {/* Top 3 — side by side on a wide screen, stacked on a phone. */}
            <h2 className="text-sm mb-2" style={{ color: "var(--color-ink)", fontWeight: 500 }}>Top 3</h2>
            <div className="grid gap-3 mb-6 md:grid-cols-3">
              {report.top.map((r: ItemSalesRow, i) => (
                <div key={r.key} className="rounded-xl border flex items-center gap-3 px-4 py-3 min-w-0" style={CARD}>
                  <span className="text-2xl w-8 text-center shrink-0" aria-label={`Rank ${i + 1}`}>{MEDALS[i]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: "var(--color-ink)", fontWeight: 500 }} title={r.name}>{r.name}</p>
                    <p className="text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>{r.categoryName}</p>
                    <p className="text-xs tabular-nums mt-1" style={{ color: "var(--color-ink-mute)" }}>
                      <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>{r.quantity} sold</span> · {cur.money(r.revenue)}
                    </p>
                  </div>
                  <div className="w-14 shrink-0">
                    <ShareCell amount={r.revenue} total={totalAmt} strong />
                  </div>
                </div>
              ))}
            </div>

            {/* All items — one card per category. */}
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="text-sm" style={{ color: "var(--color-ink)", fontWeight: 500 }}>All items</h2>
              <div className="relative w-40 sm:w-64">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-mute)" }} />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find an item"
                  className="w-full text-sm rounded-lg border pl-8 pr-3 py-1.5"
                  style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                />
              </div>
            </div>

            {categories.length === 0 ? (
              <p className="text-sm text-center py-8 rounded-xl border" style={{ ...CARD, color: "var(--color-ink-mute)" }}>No item matches “{query}”.</p>
            ) : (
              <div className="grid gap-4 items-start lg:grid-cols-2">
                {categories.map((c) => (
                  <section key={c.id ?? c.name} className="rounded-xl border overflow-hidden" style={CARD}>
                    <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                      <colgroup>
                        <col />
                        <col style={{ width: 48 }} />
                        <col style={{ width: 92 }} />
                        <col style={{ width: 64 }} />
                      </colgroup>
                      <thead>
                        {/* The category is the card's title row, carrying its own totals. */}
                        <tr style={{ background: "var(--color-canvas-soft)", borderBottom: "1px solid var(--color-hairline)" }}>
                          <th className="text-left px-4 py-3 truncate" style={{ color: "var(--color-ink)", fontWeight: 600 }}>{c.name}</th>
                          <th className="py-3 text-right tabular-nums" style={{ color: "var(--color-ink)", fontWeight: 600 }}>{c.quantity}</th>
                          <th className="py-3 pl-2 text-right tabular-nums" style={{ color: "var(--color-ink)", fontWeight: 600 }}>{cur.money(c.revenue)}</th>
                          <th className="py-3 pl-2 pr-4" style={{ fontWeight: 400 }}><ShareCell amount={c.revenue} total={totalAmt} strong /></th>
                        </tr>
                        <tr style={{ color: "var(--color-ink-mute)" }}>
                          <th className="text-left text-xs font-normal px-4 pt-2 pb-1">Item</th>
                          <th className="text-right text-xs font-normal pt-2 pb-1">Qty</th>
                          <th className="text-right text-xs font-normal pt-2 pb-1 pl-2">Amount</th>
                          <th className="text-right text-xs font-normal pt-2 pb-1 pl-2 pr-4">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.items.map((i, idx) => (
                          <tr key={i.key} style={{ borderTop: idx > 0 ? "1px solid var(--color-hairline)" : undefined }}>
                            <td className="px-4 py-2.5 truncate" style={{ color: "var(--color-ink)" }} title={i.name}>{i.name}</td>
                            <td className="py-2.5 text-right tabular-nums" style={{ color: "var(--color-ink)" }}>{i.quantity}</td>
                            <td className="py-2.5 pl-2 text-right tabular-nums" style={{ color: "var(--color-ink-mute)" }}>{cur.money(i.revenue)}</td>
                            <td className="py-2.5 pl-2 pr-4"><ShareCell amount={i.revenue} total={totalAmt} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                ))}
              </div>
            )}
            <p className="text-xs mt-4" style={{ color: "var(--color-ink-mute)" }}>
              Share = % of total item sales. Before bill discounts.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
