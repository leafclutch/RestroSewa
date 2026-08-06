"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getDeductionReport } from "@/app/actions/deductions";
import type { DeductionReport } from "@/app/actions/deductions";
import { summariseDeductions } from "@/lib/deductions";
import { PERIOD_LABEL, type FinancePeriod } from "@/lib/finance";
import { qty, STOCK_REASON_LABEL } from "@/lib/stock";
import { useRealtime } from "@/lib/realtime/use-realtime";
import type { WorkstationRow } from "@/app/actions/workstations";
import {
  ALL_STATIONS,
  filterableStations,
  matchesStation,
  stationColor,
} from "@/lib/workstations/stations";
import { StationChips } from "@/components/station-chips";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";

const PAGE_SIZE = 15;

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const money2 = (n: number) => `₹${n.toFixed(2)}`;

const PERIODS: FinancePeriod[] = ["today", "yesterday", "week", "month", "year"];

/** Reason → colour. Waste and damage are losses; kitchen usage and staff meals
 *  are consumption; a correction is neither. Colour carries that difference. */
const REASON_COLOR: Record<string, string> = {
  waste: "#dc2626",
  damage: "#dc2626",
  kitchen_usage: "#f97316",
  staff_consumption: "#f97316",
  other: "#f97316",
  adjustment: "var(--color-ink-mute)",
  wastage: "#dc2626", // written before the reason list existed; still in the DB
};

const reasonLabel = (k: string) => STOCK_REASON_LABEL[k] ?? k;
const reasonColor = (k: string) => REASON_COLOR[k] ?? "var(--color-ink-mute)";

function StatCard({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>{label}</p>
      <p className="text-lg font-medium tabular-nums" style={{ color: tone ?? "var(--color-ink)" }}>{value}</p>
      {note && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{note}</p>}
    </div>
  );
}

export function DeductionsClient({
  initialReport,
  workstations,
}: {
  initialReport: DeductionReport;
  workstations: WorkstationRow[];
}) {
  const [report, setReport] = useState(initialReport);
  const [period, setPeriod] = useState<FinancePeriod>(initialReport.period);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [station, setStation] = useState<string>(ALL_STATIONS);
  const [reason, setReason] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [loading, startTransition] = useTransition();

  const load = useCallback((p: FinancePeriod, from?: string, to?: string) => {
    startTransition(async () => {
      try {
        setReport(await getDeductionReport({ period: p, from: from ?? null, to: to ?? null }));
      } catch {
        // keep the last known report on a transient failure
      }
    });
  }, []);

  // The PERIOD is the only thing that goes to the server — station and reason
  // filter the rows already in hand.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (period === "custom" && !(customFrom && customTo)) return;
    const t = setTimeout(() => load(period, customFrom || undefined, customTo || undefined), 250);
    return () => clearTimeout(t);
  }, [period, customFrom, customTo, load]);

  useEffect(() => { setPage(1); }, [period, station, reason, customFrom, customTo]);

  const refresh = useCallback(
    () => load(period, customFrom || undefined, customTo || undefined),
    [load, period, customFrom, customTo]
  );
  // A manual deduction is written on the `stock` channel.
  useRealtime(["stock"], refresh);

  const chipStations = useMemo(
    () => filterableStations(workstations, report.rows.flatMap((r) => r.workstation_ids)),
    [workstations, report.rows]
  );

  // Reasons actually present, so the chip row never offers a filter that empties
  // the list.
  const reasons = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of report.rows) seen.set(r.kind, (seen.get(r.kind) ?? 0) + 1);
    return [...seen.keys()].sort((a, b) => reasonLabel(a).localeCompare(reasonLabel(b)));
  }, [report.rows]);

  const rows = useMemo(
    () =>
      report.rows.filter(
        (r) => matchesStation(r.workstation_ids, station) && (reason === "all" || r.kind === reason)
      ),
    [report.rows, station, reason]
  );

  // Re-totalled from the filtered rows, by the SAME function the server used, so
  // the headline always describes exactly what is listed.
  const summary = useMemo(() => summariseDeductions(rows), [rows]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage]
  );

  const activeStation = chipStations.find((w) => w.id === station) ?? null;
  const scopeLabel =
    station === ALL_STATIONS ? "" : ` · ${activeStation?.name ?? "Unassigned"}`;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
          Deduction Report
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
          Stock that left without a sale — thrown away, damaged, used in the kitchen or eaten by
          staff.
          {loading && <span className="ml-2">Updating…</span>}
        </p>
      </div>

      {/* Period */}
      <div className="flex gap-2 overflow-x-auto my-4" style={{ scrollbarWidth: "none" }}>
        {PERIODS.map((p) => {
          const active = period === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className="shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors"
              style={{
                borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
                background: active ? "var(--color-primary)" : "var(--color-canvas)",
                color: active ? "#fff" : "var(--color-ink)",
              }}
            >
              {PERIOD_LABEL[p]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setPeriod("custom")}
          className="shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors"
          style={{
            borderColor: period === "custom" ? "var(--color-primary)" : "var(--color-hairline)",
            background: period === "custom" ? "var(--color-primary)" : "var(--color-canvas)",
            color: period === "custom" ? "#fff" : "var(--color-ink)",
          }}
        >
          Custom
        </button>
      </div>

      {period === "custom" && (
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From date" />
          <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="To date" />
        </div>
      )}

      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <StatCard
          label={`Value removed${scopeLabel}`}
          value={money(summary.valueRemoved)}
          tone={summary.valueRemoved > 0 ? "#dc2626" : undefined}
        />
        <StatCard label="Movements" value={String(summary.movements)} />
        <StatCard
          label="Put back by corrections"
          value={money(summary.valueAdded)}
          note="Not netted off the loss"
        />
      </div>

      {/* Say what the money means, once. Historical cost per movement is not
          recorded anywhere, so this is today's cost applied to an older loss. */}
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
        Valued at each product&apos;s last purchase price — an estimate, not the price paid at the
        time.
      </p>

      <StationChips stations={chipStations} value={station} onChange={setStation} className="mb-3" />

      {reasons.length > 1 && (
        <div className="flex gap-2 overflow-x-auto mb-4" style={{ scrollbarWidth: "none" }}>
          {[{ k: "all", label: "All reasons" }, ...reasons.map((k) => ({ k, label: reasonLabel(k) }))].map((r) => {
            const active = reason === r.k;
            const color = r.k === "all" ? "var(--color-primary)" : reasonColor(r.k);
            return (
              <button
                key={r.k}
                type="button"
                aria-pressed={active}
                onClick={() => setReason(r.k)}
                className="shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors"
                style={{
                  borderColor: active ? color : "var(--color-hairline)",
                  background: active ? `color-mix(in srgb, ${color} 13%, transparent)` : "var(--color-canvas)",
                  color: active ? color : "var(--color-ink)",
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Where the loss went. Removed value only — corrections are excluded by
          `summariseDeductions`, so these bars add up to the headline. */}
      {summary.byReason.length > 1 && (
        <div className="rounded-xl border overflow-hidden mb-4" style={{ borderColor: "var(--color-hairline)" }}>
          {summary.byReason.map((b, i) => {
            const share = summary.valueRemoved > 0 ? (b.value / summary.valueRemoved) * 100 : 0;
            return (
              <div
                key={b.kind}
                className="px-4 py-2.5"
                style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span style={{ color: "var(--color-ink)" }}>{reasonLabel(b.kind)}</span>
                  <span className="tabular-nums shrink-0" style={{ color: "var(--color-ink-mute)" }}>
                    {money2(b.value)} · {Math.round(share)}%
                  </span>
                </div>
                <div className="h-1 rounded-full mt-1.5" style={{ background: "var(--color-canvas-soft)" }}>
                  <div
                    className="h-1 rounded-full"
                    style={{ width: `${share}%`, background: reasonColor(b.kind) }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rows.length === 0 ? (
        <div
          className="rounded-xl border px-6 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {station !== ALL_STATIONS || reason !== "all"
              ? "Nothing matches these filters in this period."
              : /* "This Month" already reads as an adverbial phrase ("…by hand this
                   month"); "Custom Range" does not, so only that one needs "in". */
                `Nothing was deducted by hand ${
                  report.period === "custom" ? "in this period" : report.periodLabel.toLowerCase()
                }. Manual deductions are recorded from the Stock page.`}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div
            className="hidden md:block rounded-xl border overflow-x-auto"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--color-canvas-soft)" }}>
                  {[
                    { h: "Product", right: false },
                    { h: "Reason", right: false },
                    { h: "When", right: false },
                    { h: "Qty", right: true },
                    { h: "Value", right: true },
                  ].map(({ h, right }) => (
                    <th
                      key={h}
                      className={`px-4 py-2.5 font-medium text-xs uppercase tracking-wide whitespace-nowrap ${right ? "text-right" : "text-left"}`}
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: "var(--color-hairline)" }}>
                    <td className="px-4 py-3">
                      <span style={{ color: "var(--color-ink)" }}>{r.product_name}</span>
                      {r.notes && (
                        <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>{r.notes}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap"
                        style={{
                          color: reasonColor(r.kind),
                          borderColor: `color-mix(in srgb, ${reasonColor(r.kind)} 27%, transparent)`,
                          background: `color-mix(in srgb, ${reasonColor(r.kind)} 7%, transparent)`,
                          letterSpacing: "0.06em",
                        }}
                      >
                        {reasonLabel(r.kind)}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--color-ink-mute)" }}>
                      {new Date(r.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      {r.staff_name ? ` · ${r.staff_name}` : ""}
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: r.qty < 0 ? "var(--color-danger)" : "var(--color-success)" }}
                    >
                      {r.qty < 0 ? "−" : "+"}{qty(Math.abs(r.qty))} {r.unit}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: "var(--color-ink)" }}>
                      {money2(r.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-2">
            {pageRows.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border px-4 py-3"
                style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                      {r.product_name}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: reasonColor(r.kind) }}>{reasonLabel(r.kind)}</p>
                    <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                      {new Date(r.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      {r.staff_name ? ` · ${r.staff_name}` : ""}
                    </p>
                    {r.notes && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{r.notes}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className="text-sm font-medium tabular-nums"
                      style={{ color: r.qty < 0 ? "var(--color-danger)" : "var(--color-success)" }}
                    >
                      {r.qty < 0 ? "−" : "+"}{qty(Math.abs(r.qty))} {r.unit}
                    </p>
                    <p className="text-xs tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                      {money(r.value)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, rows.length)} of {rows.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center border disabled:opacity-40"
                  style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs px-2 tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                  {safePage} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage === pageCount}
                  className="w-8 h-8 rounded-lg flex items-center justify-center border disabled:opacity-40"
                  style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* The report reads at most 1000 movements. Say so rather than quietly
          truncating a year's worth of deductions. */}
      {report.rows.length >= 1000 && (
        <div
          className="rounded-lg border px-3 py-2.5 flex items-start gap-2 mt-4"
          style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            Showing the most recent 1,000 movements in this period. Narrow the period to see the
            rest.
          </p>
        </div>
      )}
    </div>
  );
}
