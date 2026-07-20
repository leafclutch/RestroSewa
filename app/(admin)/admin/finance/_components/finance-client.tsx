"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  exportFinanceCsv,
  getFinanceReport,
  getFinanceTransactions,
  getOpeningBalance,
  getPeriodPurchases,
  setOpeningBalance,
} from "@/app/actions/finance";
import type { ActionResult, OpeningBalance } from "@/app/actions/finance";
import { getPayrollSummary } from "@/app/actions/payroll";
import {
  PERIOD_LABEL,
  PURCHASE_STATUS_COLOR,
  PURCHASE_STATUS_LABEL,
  TX_LABEL,
  TX_TONE,
} from "@/lib/finance";
import type {
  FinancePeriod,
  FinancePurchase,
  FinanceReport,
  FinanceTransaction,
} from "@/lib/finance";
import type { PayrollSummary } from "@/lib/payroll";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "../../_components/modal";
import { Settings2, TriangleAlert } from "lucide-react";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const money2 = (n: number) =>
  `${n < 0 ? "−" : ""}₹${Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const PERIODS: FinancePeriod[] = ["today", "yesterday", "week", "month", "year"];

// Covers purchase methods and the ledger's derived ones ("partial" = part
// tendered part credit, "mixed" = cash and bank on the same bill).
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  credit: "Credit",
  partial: "Part paid / part credit",
  mixed: "Cash + online",
};

// Used only on the outstanding figures, so a receivable never reads as a
// payable. Deliberately the same weight as every other value on the sheet —
// colour carries the meaning, not size.
const OWED_TO_US = "#0f766e"; // teal — an asset
const WE_OWE = "#dc2626"; // red — a liability

// ── Generic balance-sheet section ─────────────────────────────────────────────

function Section({
  title,
  note,
  rows,
  total,
  children,
}: {
  title: string;
  note?: string;
  // `display` overrides the money formatting — used for counts ("3 customers").
  rows: { label: string; value: number; hint?: string; tone?: string; display?: string }[];
  total?: { label: string; value: number; tone?: string };
  children?: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div
        className="px-4 py-2.5 border-b"
        style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
      >
        <p
          className="text-xs uppercase tracking-wide font-medium"
          style={{ color: "var(--color-ink)", letterSpacing: "0.06em" }}
        >
          {title}
        </p>
        {note && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{note}</p>}
      </div>

      {rows.map((r, i) => (
        <div
          key={r.label}
          className="flex items-baseline justify-between gap-3 px-4 py-2.5"
          style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
        >
          <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {r.label}
            {r.hint && (
              <span className="block text-xs" style={{ color: "var(--color-ink-mute)", opacity: 0.75 }}>
                {r.hint}
              </span>
            )}
          </span>
          <span className="text-sm tabular-nums shrink-0" style={{ color: r.tone ?? "var(--color-ink)" }}>
            {r.display ?? money2(r.value)}
          </span>
        </div>
      ))}

      {children}

      {total && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 border-t"
          style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{total.label}</span>
          <span
            className="text-lg font-medium tabular-nums"
            style={{ color: total.tone ?? "var(--color-ink)" }}
          >
            {money2(total.value)}
          </span>
        </div>
      )}
    </section>
  );
}

// ── Purchases: who we bought from ─────────────────────────────────────────────

// A purchase reads as another row of the Purchases section — same rhythm as the
// figures above it, with a small status pill (the same pill the Stock and Vendors
// screens already use). No icon tile: it is a line item, not a headline.
function PurchaseLine({ p }: { p: FinancePurchase }) {
  const tone = PURCHASE_STATUS_COLOR[p.status];
  const time = new Date(p.created_at).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Link
      href="/admin/purchases"
      className="flex items-baseline justify-between gap-3 px-4 py-2.5"
      style={{ borderTop: "1px solid var(--color-hairline)" }}
    >
      <span className="min-w-0">
        <span className="block text-sm truncate" style={{ color: "var(--color-ink)" }}>
          {p.vendor_name}
        </span>
        {/* The whole story on one line: when, how big, how settled. */}
        <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
          {time} · {p.productCount} product{p.productCount !== 1 ? "s" : ""} ·{" "}
          {METHOD_LABEL[p.method] ?? p.method}
          {p.vendor_code && <span className="hidden sm:inline"> · {p.vendor_code}</span>}
        </span>
      </span>

      <span className="text-right shrink-0">
        <span className="block text-sm tabular-nums" style={{ color: "var(--color-ink)" }}>
          {money2(p.total)}
        </span>
        <span className="block text-xs" style={{ color: tone }}>
          {PURCHASE_STATUS_LABEL[p.status]}
          {p.status === "partial" && (
            <span style={{ color: "var(--color-ink-mute)" }}> · {money(p.creditAmount)} owed</span>
          )}
        </span>
      </span>
    </Link>
  );
}

// ── Transaction history ───────────────────────────────────────────────────────

/**
 * One movement, and what it did to the balances.
 *
 * Only the buckets a transaction actually touched are shown. A cash sale prints
 * one "Cash 1,200 → 2,200" line; a credit repayment prints two, because it moves
 * money in AND writes the receivable down — which is exactly the thing the old
 * report could not show.
 */
function LedgerRow({ t }: { t: FinanceTransaction }) {
  const tone = TX_TONE[t.kind] ?? "var(--color-ink)";
  const when = new Date(t.at);

  const legs: { label: string; before: number; after: number; delta: number }[] = [];
  const leg = (label: string, delta: number, after: number) => {
    // 0.005 keeps a rounding crumb from printing an untouched bucket.
    if (Math.abs(delta) > 0.005) legs.push({ label, before: after - delta, after, delta });
  };
  leg("Cash", t.cashDelta, t.cashAfter);
  leg("Online", t.onlineDelta, t.onlineAfter);
  leg("Credit to us", t.creditToUsDelta, t.creditToUsAfter);
  leg("Credit by us", t.creditByUsDelta, t.creditByUsAfter);

  return (
    <div className="px-4 py-3" style={{ borderTop: "1px solid var(--color-hairline)" }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm" style={{ color: "var(--color-ink)" }}>
            {TX_LABEL[t.kind] ?? t.kind}
            {t.party && <span style={{ color: "var(--color-ink-mute)" }}> · {t.party}</span>}
          </span>
          <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
            {when.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}{" "}
            {when.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
            {" · "}
            {METHOD_LABEL[t.method] ?? t.method}
            {t.reference && <span> · {t.reference}</span>}
          </span>
        </span>
        <span className="text-sm tabular-nums shrink-0" style={{ color: tone }}>
          {money2(t.amount)}
        </span>
      </div>

      {legs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
          {legs.map((l) => (
            <span key={l.label} className="text-xs tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
              {l.label}{" "}
              <span style={{ opacity: 0.8 }}>{money2(l.before)}</span>
              {" → "}
              <span style={{ color: "var(--color-ink)" }}>{money2(l.after)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerSection({ rows, periodLabel }: { rows: FinanceTransaction[]; periodLabel: string }) {
  // A busy month can run to thousands of movements; rendering them all would
  // stall the page for a number nobody reads to the end of.
  const [limit, setLimit] = useState(40);
  const shown = rows.slice(0, limit);

  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div
        className="px-4 py-2.5 border-b"
        style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
      >
        <p
          className="text-xs uppercase tracking-wide font-medium"
          style={{ color: "var(--color-ink)", letterSpacing: "0.06em" }}
        >
          Transaction history · {periodLabel}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
          {rows.length === 0
            ? "No money moved in this period"
            : `${rows.length} movement${rows.length !== 1 ? "s" : ""} — newest first, with the balance after each`}
        </p>
      </div>

      {shown.map((t, i) => (
        <LedgerRow key={`${t.at}-${t.kind}-${t.reference ?? i}`} t={t} />
      ))}

      {rows.length > shown.length && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 100)}
          className="w-full text-sm px-4 py-3"
          style={{
            borderTop: "1px solid var(--color-hairline)",
            background: "var(--color-canvas-soft)",
            color: "var(--color-primary)",
          }}
        >
          Show more · {rows.length - shown.length} remaining
        </button>
      )}
    </section>
  );
}

// ── Opening balance ───────────────────────────────────────────────────────────

function OpeningForm({ current, onDone }: { current: OpeningBalance; onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(setOpeningBalance, null);

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  const defaultDate = current
    ? new Date(current.effective_from).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        The money you had before the system started tracking it. Set this once — every day
        after it carries forward automatically, so you never type a balance again.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f_cash" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Cash in hand (₹)
          </label>
          <Input id="f_cash" name="cash" type="number" min="0" step="0.01" placeholder="0.00" defaultValue={current?.cash ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f_online" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Bank / online (₹)
          </label>
          <Input id="f_online" name="online" type="number" min="0" step="0.01" placeholder="0.00" defaultValue={current?.online ?? ""} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="f_date" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Books start from
        </label>
        <input
          id="f_date"
          name="effective_from"
          type="date"
          required
          defaultValue={defaultDate}
          className="w-full text-sm rounded-lg border px-3 py-2"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
        />
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Sales and purchases recorded before this date are treated as already included in the
          figures above, so they are not counted twice.
        </p>
      </div>

      {current && (
        <div
          className="rounded-lg border px-3 py-2.5 flex items-start gap-2"
          style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            Changing this re-bases every balance from the new start date. Only adjust it if the
            original figures were wrong.
          </p>
        </div>
      )}

      {state?.error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : current ? "Update opening balance" : "Set opening balance"}
      </Button>
    </form>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function FinanceClient({
  initial,
  initialOpening,
  initialPurchases,
  initialPayroll,
  initialLedger,
  canManage,
}: {
  initial: FinanceReport;
  initialOpening: OpeningBalance;
  initialPurchases: FinancePurchase[];
  initialPayroll: PayrollSummary;
  initialLedger: FinanceTransaction[];
  canManage: boolean;
}) {
  const [report, setReport] = useState(initial);
  const [opening, setOpening] = useState(initialOpening);
  const [purchases, setPurchases] = useState(initialPurchases);
  const [payroll, setPayroll] = useState(initialPayroll);
  const [ledger, setLedger] = useState(initialLedger);
  const [period, setPeriod] = useState<FinancePeriod>(initial.period);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, startTransition] = useTransition();
  const [exporting, setExporting] = useState(false);
  const [settingOpening, setSettingOpening] = useState(false);

  const load = useCallback((p: FinancePeriod, from?: string, to?: string) => {
    startTransition(async () => {
      try {
        const args = { period: p, from: from ?? null, to: to ?? null };
        const [next, list, pay, tx] = await Promise.all([
          getFinanceReport(args),
          getPeriodPurchases(args),
          getPayrollSummary(args),
          getFinanceTransactions(args),
        ]);
        setReport(next);
        setPurchases(list);
        setPayroll(pay);
        setLedger(tx);
      } catch {
        // keep the last known report on a transient failure
      }
    });
  }, []);

  const selectPeriod = (p: FinancePeriod) => {
    setPeriod(p);
    if (p !== "custom") load(p);
  };

  const applyCustom = () => {
    if (!customFrom && !customTo) return;
    setPeriod("custom");
    load("custom", customFrom || undefined, customTo || undefined);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await exportFinanceCsv({
        period,
        from: customFrom || null,
        to: customTo || null,
      });
      if ("error" in res) {
        alert(res.error);
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not export the report. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // Re-seeding the opening balance re-bases every figure, so pull both back.
  const refreshAll = useCallback(async () => {
    const args = { period, from: customFrom || null, to: customTo || null };
    // The ledger's running balances start from the opening figures, so re-seeding
    // moves every row in it — it has to come back too, or the history would
    // still be reconciling to the old opening balance.
    const [rep, op, tx] = await Promise.all([
      getFinanceReport(args),
      getOpeningBalance(),
      getFinanceTransactions(args),
    ]);
    setReport(rep);
    setOpening(op);
    setLedger(tx);
  }, [period, customFrom, customTo]);

  // Sales, purchases, credit, vendor payments and payroll all move these figures.
  const resync = useCallback(
    () => load(period, customFrom || undefined, customTo || undefined),
    [load, period, customFrom, customTo]
  );
  useRealtime(["billing", "credits", "purchases", "vendors", "finance", "payroll"], resync);

  const netMovement = report.closingNet - (report.openingCash + report.openingOnline);
  const periodLabel = PERIOD_LABEL[report.period];
  const netCredit = report.customerCreditOutstanding - report.vendorCreditOutstanding;

  // What was actually handed over, as opposed to what was billed on credit.
  const purchasesPaid = report.purchasesCash + report.purchasesOnline;
  // A "salary payment" on the Expenses list means the settlement, so the advances
  // are shown on their own line rather than counted twice.
  const salaryFinal = report.salaryTotal - report.salaryAdvance;
  const totalExpenses = purchasesPaid + report.vendorCreditPaid + report.salaryTotal;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h1 className="text-2xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
            Daily Finance
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            Showing <span style={{ color: "var(--color-ink)" }}>{periodLabel}</span>
            {loading && <span className="ml-2">Updating…</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => setSettingOpening(true)}>
              <Settings2 size={14} /> Opening balance
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      {!report.hasOpening && (
        <div
          className="rounded-lg border px-3 py-2.5 flex items-start gap-2 mt-4"
          style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            <span className="font-medium">No opening balance set.</span> Balances below start from
            zero and count every transaction ever recorded.
            {canManage && " Set your opening balance so they reflect real money."}
          </p>
        </div>
      )}

      {/* Period picker */}
      <div className="flex gap-2 overflow-x-auto my-4" style={{ scrollbarWidth: "none" }}>
        {PERIODS.map((p) => {
          const active = period === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => selectPeriod(p)}
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
      </div>

      {/* Custom range */}
      <div
        className="rounded-xl border px-4 py-3 mb-5"
        style={{
          background: period === "custom" ? "var(--color-canvas-soft)" : "var(--color-canvas)",
          borderColor: period === "custom" ? "var(--color-primary)" : "var(--color-hairline)",
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[130px]">
            <label className="block text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>From</label>
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-full text-sm rounded-lg border px-2.5 py-1.5"
              style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <label className="block text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>To</label>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-full text-sm rounded-lg border px-2.5 py-1.5"
              style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
            />
          </div>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!customFrom && !customTo}
            className="text-sm px-4 py-1.5 rounded-lg font-medium disabled:opacity-50"
            style={{ background: "var(--color-primary)", color: "#fff" }}
          >
            Apply
          </button>
        </div>
      </div>

      {/* Where the money ended up */}
      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Closing cash</p>
          <p className="text-lg font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>{money(report.closingCash)}</p>
        </div>
        <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Closing online / bank</p>
          <p className="text-lg font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>{money(report.closingOnline)}</p>
        </div>
        {/* The two credit positions sit alongside cash, not buried further down:
            an owner reading "Net balance ₹5,000" needs to see in the same glance
            that ₹20,000 is owed out. Colour separates asset from liability. */}
        <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Credit to us</p>
          <p className="text-lg font-medium tabular-nums" style={{ color: report.closingCreditToUs > 0 ? OWED_TO_US : "var(--color-ink)" }}>
            {money(report.closingCreditToUs)}
          </p>
          <p className="text-[10px]" style={{ color: "var(--color-ink-mute)" }}>Customers owe us</p>
        </div>
        <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Credit by us</p>
          <p className="text-lg font-medium tabular-nums" style={{ color: report.closingCreditByUs > 0 ? WE_OWE : "var(--color-ink)" }}>
            {money(report.closingCreditByUs)}
          </p>
          <p className="text-[10px]" style={{ color: "var(--color-ink-mute)" }}>We owe vendors</p>
        </div>
        <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-primary)", borderColor: "var(--color-primary)" }}>
          <p className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.75)" }}>Net balance</p>
          <p className="text-lg font-medium tabular-nums" style={{ color: "#fff" }}>{money(report.closingNet)}</p>
          <p className="text-[10px] tabular-nums" style={{ color: "rgba(255,255,255,0.7)" }}>
            {netMovement >= 0 ? "+" : "−"}{money(Math.abs(netMovement))} this period
          </p>
        </div>
      </div>

      {/* Opening → Sales → Purchases → Credit → Closing, as one sheet. */}
      <div className="flex flex-col gap-4">
        {/* Four components, not two. Cash and bank are money; the two credit
            lines are promises — shown on the same sheet because an owner needs
            both to know where they stand, but never added into the money total. */}
        <Section
          title="Opening balance"
          note="Carried forward from the previous period"
          rows={[
            { label: "Cash", value: report.openingCash },
            { label: "Online / bank", value: report.openingOnline },
            {
              label: "Credit to us",
              hint: "Owed by customers at the start",
              value: report.openingCreditToUs,
              tone: report.openingCreditToUs > 0 ? OWED_TO_US : undefined,
            },
            {
              label: "Credit by us",
              hint: "Owed to vendors at the start",
              value: report.openingCreditByUs,
              tone: report.openingCreditByUs > 0 ? WE_OWE : undefined,
            },
          ]}
          total={{ label: "Cash + bank", value: report.openingCash + report.openingOnline }}
        />

        <Section
          title={`Sales · ${periodLabel}`}
          note="Total is the full value billed — credit included (accrual)"
          rows={[
            { label: "Cash sales", value: report.salesCash, tone: "#1a7a4a" },
            { label: "Online sales", value: report.salesOnline, tone: "#1a7a4a" },
            ...(report.salesCard > 0
              ? [{ label: "Card sales", value: report.salesCard, tone: "#1a7a4a" }]
              : []),
            {
              label: "Credit sales",
              value: report.salesCredit,
              hint: "Billed but not collected",
              tone: "#f97316",
            },
          ]}
          total={{ label: "Total sales", value: report.salesTotal }}
        />

        {/* Everything that left the business, gathered in one place. The figures
            are already on this page — spread across Purchases, Vendor credits and
            Payroll — and an admin asking "where did the cash go today" should not
            have to add up three sections to find out. */}
        <Section
          title={`Expenses · ${periodLabel}`}
          note="All money out — purchases, vendors and staff"
          rows={[
            {
              label: "Product purchases",
              hint: "Paid at the time of purchase",
              value: purchasesPaid,
              tone: purchasesPaid > 0 ? WE_OWE : undefined,
            },
            {
              label: "Vendor payments",
              hint: "Settling earlier credit purchases",
              value: report.vendorCreditPaid,
              tone: report.vendorCreditPaid > 0 ? WE_OWE : undefined,
            },
            {
              label: "Staff salary payments",
              value: salaryFinal,
              tone: salaryFinal > 0 ? WE_OWE : undefined,
            },
            {
              label: "Salary advances",
              hint: "Paid ahead of the month ending",
              value: report.salaryAdvance,
              tone: report.salaryAdvance > 0 ? "#f97316" : undefined,
            },
          ]}
          total={{ label: "Total money out", value: totalExpenses, tone: totalExpenses > 0 ? WE_OWE : undefined }}
        />

        {/* Payroll's own line: what was paid, how it left, and what is still owed. */}
        <Section
          title={`Staff salary · ${periodLabel}`}
          note={
            report.salaryOutstanding > 0.005
              ? "Outstanding is salary accrued but not yet paid"
              : "Every salary accrued so far has been paid"
          }
          rows={[
            { label: "Salary paid today", value: payroll.todayTotal },
            { label: "Salary paid this month", value: payroll.monthTotal },
            {
              label: `Paid in cash · ${periodLabel}`,
              value: report.salaryCash,
              tone: report.salaryCash > 0 ? WE_OWE : undefined,
            },
            {
              label: `Paid online · ${periodLabel}`,
              value: report.salaryOnline,
              tone: report.salaryOnline > 0 ? WE_OWE : undefined,
            },
            {
              label: `Advances · ${periodLabel}`,
              value: report.salaryAdvance,
              tone: report.salaryAdvance > 0 ? "#f97316" : undefined,
            },
            { label: "Total salary expense", hint: "All time", value: payroll.allTimeTotal },
          ]}
          total={{
            label: "Outstanding salary liability",
            value: report.salaryOutstanding,
            tone: report.salaryOutstanding > 0.005 ? WE_OWE : undefined,
          }}
        />

        <Section
          title={`Purchases · ${periodLabel}`}
          note={
            purchases.length === 0
              ? undefined
              : `${purchases.length} purchase${purchases.length !== 1 ? "s" : ""} — who you bought from`
          }
          rows={[
            { label: "Cash purchases", value: report.purchasesCash, tone: "#dc2626" },
            { label: "Online purchases", value: report.purchasesOnline, tone: "#dc2626" },
            {
              label: "Credit purchases",
              value: report.purchasesCredit,
              hint: "Owed to vendors, not yet paid",
              tone: "#f97316",
            },
          ]}
          total={{ label: "Total purchase cost", value: report.purchasesTotal }}
        >
          {/* Each supplier bill behind the total — so the admin never has to leave
              the page to find out who a purchase was from. */}
          {purchases.length > 0 && (
            <>
              <div
                className="px-4 py-1.5"
                style={{ borderTop: "1px solid var(--color-hairline)", background: "var(--color-canvas-soft)" }}
              >
                <p
                  className="text-[11px] uppercase tracking-wide"
                  style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                >
                  Bought from
                </p>
              </div>
              {purchases.map((p) => <PurchaseLine key={p.id} p={p} />)}
            </>
          )}
        </Section>

        {/* Credit — the two halves of the ledger, side by side on wide screens.
            Same section chrome as the rest of the sheet; the outstanding figure
            sits in the emphasised total row, where the eye already goes. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Section
            title="Customer credits"
            note="Owed to us"
            rows={[
              {
                label: `Collected · ${periodLabel}`,
                value: report.customerCreditCollected,
                tone: report.customerCreditCollected > 0 ? "#1a7a4a" : undefined,
              },
              {
                label: `New credits · ${periodLabel}`,
                value: report.customerCreditCreated,
                tone: report.customerCreditCreated > 0 ? "#f97316" : undefined,
              },
              {
                label: "Pending customers",
                value: report.pendingCustomers,
                display: String(report.pendingCustomers),
              },
            ]}
            total={{
              // "Right now", not "at the end of the period" — this figure and
              // the count beside it are for chasing people today, so they stay
              // live even when a past period is selected. The period-accurate
              // number is in the closing balance above.
              label: "Outstanding right now",
              value: report.customerCreditOutstanding,
              tone: report.customerCreditOutstanding > 0 ? OWED_TO_US : undefined,
            }}
          />

          <Section
            title="Vendor credits"
            note="Owed by us"
            rows={[
              {
                label: `Paid · ${periodLabel}`,
                value: report.vendorCreditPaid,
                tone: report.vendorCreditPaid > 0 ? "#1a7a4a" : undefined,
              },
              {
                label: `New credit purchases · ${periodLabel}`,
                value: report.vendorCreditCreated,
                tone: report.vendorCreditCreated > 0 ? "#f97316" : undefined,
              },
              {
                label: "Pending vendors",
                value: report.pendingVendors,
                display: String(report.pendingVendors),
              },
            ]}
            total={{
              // "Right now", not "at the end of the period" — this figure and
              // the count beside it are for chasing people today, so they stay
              // live even when a past period is selected. The period-accurate
              // number is in the closing balance above.
              label: "Outstanding right now",
              value: report.vendorCreditOutstanding,
              tone: report.vendorCreditOutstanding > 0 ? WE_OWE : undefined,
            }}
          />
        </div>

        {/* The receivable / payable pair, as one more row of the sheet. */}
        <Section
          title="Credit position right now"
          note="Credit moves no cash until it is collected or paid"
          rows={[
            {
              label: "Amount owed to us",
              hint:
                report.pendingCustomers > 0
                  ? `${report.pendingCustomers} customer${report.pendingCustomers !== 1 ? "s" : ""}`
                  : undefined,
              value: report.customerCreditOutstanding,
              tone: report.customerCreditOutstanding > 0 ? OWED_TO_US : undefined,
            },
            {
              label: "Amount we owe",
              hint:
                report.pendingVendors > 0
                  ? `${report.pendingVendors} vendor${report.pendingVendors !== 1 ? "s" : ""}`
                  : undefined,
              value: report.vendorCreditOutstanding,
              tone: report.vendorCreditOutstanding > 0 ? WE_OWE : undefined,
            },
          ]}
          total={{
            label: netCredit >= 0 ? "Net owed to us" : "Net we owe",
            value: Math.abs(netCredit),
            tone: netCredit >= 0 ? OWED_TO_US : WE_OWE,
          }}
        />

        <Section
          title="Closing balance"
          note="Opening + money collected − money spent"
          rows={[
            { label: "Cash balance", value: report.closingCash },
            { label: "Online / bank balance", value: report.closingOnline },
            {
              label: "Credit to us",
              hint: "Still owed by customers",
              value: report.closingCreditToUs,
              tone: report.closingCreditToUs > 0 ? OWED_TO_US : undefined,
            },
            {
              label: "Credit by us",
              hint: "Still owed to vendors",
              value: report.closingCreditByUs,
              tone: report.closingCreditByUs > 0 ? WE_OWE : undefined,
            },
          ]}
          total={{ label: "Net balance (cash + bank)", value: report.closingNet, tone: "var(--color-primary)" }}
        />

        {/* The ledger behind every figure above. Deliberately last: the summary
            answers "where do I stand", this answers "why". */}
        <LedgerSection rows={ledger} periodLabel={periodLabel} />
      </div>

      <Modal
        open={settingOpening}
        onClose={() => setSettingOpening(false)}
        title={opening ? "Update opening balance" : "Set opening balance"}
        subtitle="The money you started with"
      >
        <OpeningForm current={opening} onDone={() => { setSettingOpening(false); refreshAll(); }} />
      </Modal>
    </div>
  );
}
