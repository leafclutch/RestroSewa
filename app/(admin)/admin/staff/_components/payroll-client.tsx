"use client";

import {
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";
import { useFormSubmit } from "@/lib/use-form-submit";
import {
  getPayrollCycleSheet,
  getPayrollHistory,
  recordSalaryPayment,
} from "@/app/actions/payroll";
import {
  PAYMENT_KIND_LABEL,
  PAYROLL_STATUS_COLOR,
  PAYROLL_STATUS_LABEL,
  PAY_METHOD_LABEL,
  addDays,
  dayLabel,
  monthLabel,
} from "@/lib/payroll";
import type {
  PayMethod,
  PaymentKind,
  PayrollCycleRow,
  PayrollCycleSheet,
  PayrollHistoryMonth,
} from "@/lib/payroll";
import { SalaryCyclePanel } from "./salary-cycle-panel";
import { PayrollSetupForm, SalaryRevisions } from "./payroll-setup";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaymentMethodPicker, splitIsValid, type PaymentMethod } from "@/components/ui/payment-method-picker";
import { Modal } from "../../_components/modal";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Wallet,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/components/currency-provider";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

const day = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" });

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: PayrollCycleRow["status"] }) {
  const tone = PAYROLL_STATUS_COLOR[status];
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full shrink-0"
      style={{ color: tone, background: `${tone}14`, border: `1px solid ${tone}33` }}
    >
      {PAYROLL_STATUS_LABEL[status]}
    </span>
  );
}

// ── Pay a salary, or an advance against it ────────────────────────────────────

/** The period being paid: the sheet's current row, or any earlier one from history. */
type PayTarget = Pick<
  PayrollCycleRow,
  "staff_id" | "cycle_start" | "cycle_end" | "payableAmount" | "advancePaid" | "salaryPaid" | "remaining"
>;

function PaymentForm({
  row,
  month,
  kind,
  onDone,
}: {
  row: PayTarget;
  /** Any day inside the period — the server files the payment against the period containing it. */
  month: string;
  kind: PaymentKind;
  onDone: () => void;
}) {
  const cur = useCurrency();
  const { state, pending, onSubmit } = useFormSubmit(recordSalaryPayment, onDone);
  const [method, setMethod] = useState<PayMethod>("cash");
  // Controlled so the split has something to reconcile against — an
  // uncontrolled input leaves the picker validating against nothing.
  const [amount, setAmount] = useState(kind === "salary" ? row.remaining.toFixed(2) : "");
  const [split, setSplit] = useState({ cash: "", online: "" });
  const amountNum = parseFloat(amount) || 0;
  const canSubmit = amountNum > 0 && splitIsValid(method as PaymentMethod, amountNum, split.cash, split.online);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="staff_id" value={row.staff_id} />
      <input type="hidden" name="salary_month" value={month} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="method" value={method} />

      {/* Where the number comes from, before they type one. */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        {[
          {
            label: `Payable · ${dayLabel(row.cycle_start)} → ${dayLabel(row.cycle_end)}`,
            value: cur.money2(row.payableAmount),
          },
          ...(row.advancePaid > 0
            ? [{ label: "Advance already paid", value: `− ${cur.money2(row.advancePaid)}` }]
            : []),
          ...(row.salaryPaid > 0
            ? [{ label: "Salary already paid", value: `− ${cur.money2(row.salaryPaid)}` }]
            : []),
        ].map((r, i) => (
          <div
            key={r.label}
            className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm"
            style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
          >
            <span style={{ color: "var(--color-ink-mute)" }}>{r.label}</span>
            <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>{r.value}</span>
          </div>
        ))}
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 border-t"
          style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            Remaining
          </span>
          <span
            className="text-base font-medium tabular-nums"
            style={{ color: "var(--color-primary)" }}
          >
            {cur.money2(row.remaining)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="pay_amount"
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          {kind === "advance" ? `Advance amount (${cur.symbol})` : `Amount to pay (${cur.symbol})`}
        </label>
        <Input
          id="pay_amount"
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          max={row.remaining}
          required
          autoFocus
          placeholder="0.00"
          // A final payment almost always clears the balance, so offer it. An
          // advance is by nature a part payment, so don't presume the amount.
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          At most {cur.money2(row.remaining)} — the rest of this cycle&apos;s salary.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Paid by
        </span>
        <PaymentMethodPicker
          methods={["cash", "online", "mixed"]}
          value={method as PaymentMethod}
          onChange={(m) => { setMethod(m as PayMethod); setSplit({ cash: "", online: "" }); }}
          total={amountNum}
          cash={split.cash}
          online={split.online}
          onSplitChange={setSplit}
          disabled={pending}
        />
        <input type="hidden" name="cash_amount" value={method === "mixed" ? split.cash : ""} />
        <input type="hidden" name="online_amount" value={method === "mixed" ? split.online : ""} />
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          This comes straight out of your {method === "cash" ? "cash" : "bank"} balance on the
          Finance sheet.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="pay_notes"
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Note (optional)
        </label>
        <Input id="pay_notes" name="notes" placeholder="e.g. paid at the counter" autoComplete="off" />
      </div>

      {state?.error && (
        <p
          className="text-sm rounded-md px-3 py-2"
          style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}
        >
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending || !canSubmit}>
        {pending
          ? "Recording…"
          : kind === "advance"
            ? "Record advance"
            : "Record salary payment"}
      </Button>
    </form>
  );
}

// ── Payroll history, in place ─────────────────────────────────────────────────
// Expands under the row rather than opening a page: the admin is comparing this
// month against the last few, and a navigation would take the comparison away.
// Fetched only when opened — a restaurant with 40 staff must not load 40 people's
// payment history to render a list.

function History({
  staffId,
  version,
  onPay,
}: {
  staffId: string;
  version: string;
  /** Pay what is left on a period. Absent for staff who may only view payroll. */
  onPay?: (period: PayrollHistoryMonth) => void;
}) {
  const cur = useCurrency();
  const [months, setMonths] = useState<PayrollHistoryMonth[] | null>(null);
  const [loading, setLoading] = useState(true);

  // `version` changes whenever this person's row on the sheet does (a payment, an
  // attendance change, a new salary), so an open history refetches with it. It
  // used to load once on open and then sit there stale: an advance paid from the
  // row above never appeared below until the row was closed and reopened. Only
  // the first load shows the spinner; a refetch swaps the figures in place.
  useEffect(() => {
    let live = true;
    getPayrollHistory(staffId)
      .then((m) => { if (live) setMonths(m); })
      .catch(() => { if (live) setMonths((prev) => prev ?? []); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [staffId, version]);

  if (loading) {
    // The shape of the periods about to appear: a label and pill, a figures line.
    return (
      <div className="flex flex-col">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap"
            style={{ borderTop: "1px solid var(--color-hairline)" }}
          >
            <span className="flex items-center gap-2">
              <Skeleton onSoft w={150} h={14} />
              <Skeleton onSoft w={52} h={18} className="rounded-full" />
            </span>
            <Skeleton onSoft w={240} h={12} />
          </div>
        ))}
      </div>
    );
  }

  if (!months || months.length === 0) {
    return (
      <p className="px-4 py-4 text-sm" style={{ color: "var(--color-ink-mute)" }}>
        No payroll history yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {months.map((m) => (
        <div key={m.month} style={{ borderTop: "1px solid var(--color-hairline)" }}>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 flex-wrap">
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-sm" style={{ color: "var(--color-ink)" }}>
                {m.isCycle
                  ? `${dayLabel(m.periodStart)} → ${dayLabel(m.periodEnd)}`
                  : monthLabel(m.periodStart)}
              </span>
              <StatusPill status={m.status} />
            </span>
            <span className="text-xs tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
              {m.monthly_salary == null ? (
                "No salary set"
              ) : (
                <>
                  {m.payable < m.monthly_salary - 0.005 ? (
                    <>Payable {cur.money(m.payable)} of {cur.money(m.monthly_salary)}</>
                  ) : (
                    <>Salary {cur.money(m.monthly_salary)}</>
                  )}
                  {m.advancePaid > 0 && (
                    <>
                      {" "}· Advance{" "}
                      <span style={{ color: PAYROLL_STATUS_COLOR.partial }}>
                        {cur.money(m.advancePaid)}
                      </span>
                    </>
                  )}
                  {" "}· Paid{" "}
                  <span style={{ color: "var(--color-ink)" }}>{cur.money(m.totalPaid)}</span>
                  {m.remaining > 0.005 && (
                    <>
                      {" "}
                      · Remaining{" "}
                      <span style={{ color: PAYROLL_STATUS_COLOR.partial }}>
                        {cur.money(m.remaining)}
                      </span>
                    </>
                  )}
                </>
              )}
            </span>
            {/* Settle an earlier period right here — no stepping the sheet's
                date back to it first. */}
            {onPay && m.monthly_salary != null && m.remaining > 0.005 && (
              <Button variant="primary" size="sm" onClick={() => onPay(m)}>
                Pay {cur.money(m.remaining)}
              </Button>
            )}
          </div>

          {/* Advances and the final payment, each with when, how and who. */}
          {m.payments.length > 0 && (
            <div className="px-4 pb-2.5 flex flex-col gap-1">
              {m.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-baseline justify-between gap-3 text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: "var(--color-canvas-soft)" }}
                >
                  <span className="min-w-0">
                    <span style={{ color: "var(--color-ink)" }}>
                      {PAYMENT_KIND_LABEL[p.kind]}
                    </span>
                    <span style={{ color: "var(--color-ink-mute)" }}>
                      {" · "}
                      {when(p.created_at)}
                      {" · "}
                      {PAY_METHOD_LABEL[p.method]}
                      {p.paid_by_name && ` · by ${p.paid_by_name}`}
                    </span>
                    {p.notes && (
                      <span className="block truncate" style={{ color: "var(--color-ink-mute)" }}>
                        {p.notes}
                      </span>
                    )}
                  </span>
                  <span
                    className="tabular-nums shrink-0"
                    style={{ color: p.kind === "advance" ? PAYROLL_STATUS_COLOR.partial : "var(--color-ink)" }}
                  >
                    {cur.money2(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── One staff member on the payroll sheet ─────────────────────────────────────

function PayrollLine({
  row,
  month,
  canManage,
  expanded,
  onToggle,
  onPay,
  onPayPeriod,
  onSetup,
  onChanged,
}: {
  row: PayrollCycleRow;
  month: string;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  onPay: (kind: PaymentKind) => void;
  /** Pay what is left on an earlier period, from this person's history. */
  onPayPeriod: (period: PayrollHistoryMonth) => void;
  /** Open the one "Salary & cycle" form for this person. */
  onSetup: () => void;
  onChanged: () => void;
}) {
  const cur = useCurrency();
  const noSalary = row.monthly_salary == null;
  const settled = row.remaining <= 0.005;
  // Changes whenever this person's row does, so every section under it — cycle,
  // salary history, payment history — refetches together and stays in step.
  const version = `${row.cycle_id}|${row.cycle_start}|${row.paymentCount}|${row.totalPaid}|${row.payableAmount}|${row.monthly_salary}|${row.joining_date}`;

  return (
    // Each person is a card of their own, so one staff member's figures and
    // expanded detail can never be read as the next person's.
    <div
      className="rounded-xl border shadow-sm overflow-hidden transition-shadow"
      style={{
        background: "var(--color-canvas)",
        borderColor: expanded ? "var(--color-primary)" : "var(--color-hairline)",
        boxShadow: expanded ? "0 4px 14px rgba(0,0,0,0.08)" : undefined,
      }}
    >
      {/* Phone: name, then the figures as a 2×2 grid, then full-width buttons.
          Desktop: all three side by side on one line. */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 px-4 py-3.5">
        {/* The whole name block toggles the detail below. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
        >
          <ChevronDown
            size={16}
            className="shrink-0 transition-transform"
            style={{
              color: "var(--color-ink-mute)",
              transform: expanded ? "none" : "rotate(-90deg)",
            }}
          />
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
          >
            {row.display_name.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <span
                className="text-sm font-medium truncate min-w-0"
                style={{ color: "var(--color-ink)", opacity: row.is_active ? 1 : 0.55 }}
              >
                {row.display_name}
              </span>
              {!noSalary && <StatusPill status={row.status} />}
              {!row.is_active && (
                <span className="text-[11px]" style={{ color: "var(--color-ink-mute)" }}>
                  Inactive
                </span>
              )}
            </span>
            <span className="block text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
              {row.title ? `${row.title} · ` : ""}
              Joined {day(row.joining_date)}
            </span>
          </span>
        </button>

        {/* Salary → advance → paid → remaining, in the order the money moves. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 lg:flex lg:items-center lg:gap-6 lg:shrink-0">
          {noSalary ? (
            <span className="text-xs col-span-2 sm:col-span-4" style={{ color: "var(--color-ink-mute)" }}>
              No salary set for this cycle
            </span>
          ) : (
            <>
              {/* What this cycle OWES. With absences that is less than the headline
                  salary, and showing the salary there made Salary − Paid disagree
                  with Remaining. */}
              <span className="lg:text-right" title={`Monthly salary ${cur.money(row.monthly_salary ?? 0)}`}>
                <span className="block text-[10px]" style={{ color: "var(--color-ink-mute)" }}>
                  {row.payableAmount < (row.monthly_salary ?? 0) - 0.005 ? "Payable" : "Salary"}
                </span>
                <span className="block text-sm tabular-nums" style={{ color: "var(--color-ink)" }}>
                  {cur.money(row.payableAmount)}
                </span>
              </span>
              <span className="lg:text-right">
                <span className="block text-[10px]" style={{ color: "var(--color-ink-mute)" }}>
                  Advance
                </span>
                <span
                  className="block text-sm tabular-nums"
                  style={{
                    color: row.advancePaid > 0
                      ? PAYROLL_STATUS_COLOR.partial
                      : "var(--color-ink-mute)",
                  }}
                >
                  {row.advancePaid > 0 ? cur.money(row.advancePaid) : "—"}
                </span>
              </span>
              <span className="lg:text-right">
                <span className="block text-[10px]" style={{ color: "var(--color-ink-mute)" }}>
                  Paid
                </span>
                <span
                  className="block text-sm tabular-nums"
                  style={{
                    color: row.totalPaid > 0
                      ? PAYROLL_STATUS_COLOR.paid
                      : "var(--color-ink-mute)",
                  }}
                >
                  {row.totalPaid > 0 ? cur.money(row.totalPaid) : "—"}
                </span>
              </span>
              <span className="lg:text-right">
                <span className="block text-[10px]" style={{ color: "var(--color-ink-mute)" }}>
                  Remaining
                </span>
                <span
                  className="block text-sm tabular-nums font-medium"
                  style={{ color: settled ? PAYROLL_STATUS_COLOR.paid : "var(--color-ink)" }}
                >
                  {cur.money(row.remaining)}
                </span>
              </span>
            </>
          )}
        </div>

        {canManage && (
          <div className="flex items-center gap-2 lg:shrink-0">
            {noSalary ? (
              <Button variant="secondary" size="sm" onClick={onSetup} className="flex-1 lg:flex-none">
                Set salary
              </Button>
            ) : (
              <>
                {!settled && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => onPay("advance")} className="flex-1 lg:flex-none">
                      Advance
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => onPay("salary")} className="flex-1 lg:flex-none">
                      Pay
                    </Button>
                  </>
                )}
                <button
                  type="button"
                  onClick={onSetup}
                  className="text-xs px-3 py-1.5 rounded-lg border"
                  style={{ color: "var(--color-ink-mute)", borderColor: "var(--color-hairline)" }}
                >
                  Edit
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ background: "var(--color-canvas-soft)", borderTop: "1px solid var(--color-hairline)" }}>
          {/* The cycle comes first: it is what the money above is actually
              settled against. History sits under it, unchanged. */}
          <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--color-hairline)" }}>
            <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
              <p
                className="text-xs uppercase tracking-wide font-medium"
                style={{ color: "var(--color-ink)", letterSpacing: "0.06em" }}
              >
                Salary cycle
              </p>
              {canManage && (
                <Button variant="secondary" size="sm" onClick={onSetup}>
                  Salary &amp; cycle
                </Button>
              )}
            </div>
            <SalaryCyclePanel row={row} onChanged={onChanged} />
          </div>
          {/* The salary behind every figure above, correctable in place. */}
          <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--color-hairline)" }}>
            <SalaryRevisions
              staffId={row.staff_id}
              version={version}
              canManage={canManage}
              onChanged={onChanged}
            />
          </div>
          <History
            staffId={row.staff_id}
            version={version}
            onPay={canManage ? onPayPeriod : undefined}
          />
        </div>
      )}
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function PayrollClient({
  initial,
  canManage,
}: {
  initial: PayrollCycleSheet;
  canManage: boolean;
}) {
  const cur = useCurrency();
  const [sheet, setSheet] = useState(initial);
  // The sheet is now keyed to a DAY, not a month: each staff member can be on
  // their own cycle, so there is no single month that describes everybody. This
  // date asks "which cycle was each person in on this day".
  const [asOf, setAsOf] = useState(initial.asOf);
  const [loading, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);

  // Which modal is open, and for whom.
  // Who is being paid, for which period: `day` is any date inside it (the sheet's
  // date for the current row, the period's first day when paid from history).
  const [paying, setPaying] = useState<{
    target: PayTarget;
    name: string;
    kind: PaymentKind;
    day: string;
  } | null>(null);
  // One setup form for joining date, cycle and salary — opened from the row, from
  // inside it, and for someone not on payroll yet.
  const [setupFor, setSetupFor] = useState<{ staffId: string; name: string; isNew: boolean } | null>(null);
  // A save can carry a note (e.g. a paid cycle kept its old salary).
  const [notice, setNotice] = useState<string | null>(null);

  // Skeletons only when the admin steps to another cycle. A background refresh
  // (a payment, a live update) swaps the figures in place instead of blanking
  // the whole list every time anyone pays anyone.
  const [stepping, setStepping] = useState(false);
  const showSkeleton = loading && stepping;

  const load = useCallback((d: string) => {
    startTransition(async () => {
      try {
        setSheet(await getPayrollCycleSheet(d));
      } catch {
        // keep the last known sheet on a transient failure
      } finally {
        setStepping(false);
      }
    });
  }, []);

  const go = (by: number) => {
    // Step a whole cycle at a time. Never past today: you cannot pay a salary
    // that has not accrued yet.
    const next = addDays(asOf, by * 30);
    if (by > 0 && next > initial.asOf) return;
    setAsOf(next);
    setExpanded(null);
    setStepping(true);
    load(next);
  };

  const pick = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > initial.asOf) return;
    setAsOf(d);
    setExpanded(null);
    setStepping(true);
    load(d);
  };

  const refresh = useCallback(() => load(asOf), [load, asOf]);
  useRealtime(["payroll", "staff", "settings"], refresh);

  const atToday = asOf >= initial.asOf;

  return (
    <section className="mt-10">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h2
            className="text-lg flex items-center gap-2"
            style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.3px" }}
          >
            <Wallet size={16} strokeWidth={1.5} style={{ color: "var(--color-ink-mute)" }} />
            Payroll
          </h2>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            Salaries, advances and payments. Every payment posts straight to Finance.
          </p>
        </div>

        {/* Cycle stepper. Each person may be on their own window, so this picks a
            DAY and every row shows the cycle that was running on it. Forward
            stops at today — a salary cannot be paid before it has accrued. */}
        {/* In the app's own card style: a little more presence than a bare
            input (it decides what every figure below means), no loud colour.
            Off today, a quiet note and a way back. */}
        <div className="flex flex-col items-stretch sm:items-end gap-1 w-full sm:w-auto">
          <div
            className="flex items-center gap-1 rounded-xl border px-1.5 py-1 shadow-sm"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous cycle"
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 hover:bg-[var(--color-canvas-soft)]"
              style={{ color: "var(--color-primary)" }}
            >
              <ChevronLeft size={17} />
            </button>
            <CalendarDays size={14} className="shrink-0" style={{ color: "var(--color-ink-mute)" }} />
            <input
              type="date"
              value={asOf}
              max={initial.asOf}
              onChange={(e) => pick(e.target.value)}
              aria-label="Show cycles active on"
              className="flex-1 min-w-[140px] h-8 text-sm font-medium text-center bg-transparent"
              style={{ color: "var(--color-ink)", border: "none", outline: "none" }}
            />
            <button
              type="button"
              onClick={() => go(1)}
              disabled={atToday}
              aria-label="Next cycle"
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 hover:bg-[var(--color-canvas-soft)] disabled:opacity-30 disabled:hover:bg-transparent"
              style={{ color: "var(--color-primary)" }}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          {!atToday && (
            <button
              type="button"
              onClick={() => pick(initial.asOf)}
              className="text-xs self-end"
              style={{ color: "var(--color-primary)" }}
            >
              Viewing a past cycle · Back to today
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          className="rounded-lg border px-3 py-2.5 mt-3 flex items-start justify-between gap-3"
          style={{
            background: "var(--color-warning-bg)",
            borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)",
          }}
        >
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs shrink-0"
            style={{ color: "var(--color-warning)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Where the month stands, before any names. */}
      <div
        className="grid gap-3 my-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
      >
        {[
          { label: "Total payable", value: sheet.totalPayable, tone: "var(--color-ink)" },
          { label: "Advances", value: sheet.totalAdvance, tone: PAYROLL_STATUS_COLOR.partial },
          { label: "Total paid", value: sheet.totalPaid, tone: PAYROLL_STATUS_COLOR.paid },
          { label: "Remaining", value: sheet.totalRemaining, tone: PAYROLL_STATUS_COLOR.unpaid },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-xl border px-4 py-3"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
          >
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>{c.label}</p>
            {showSkeleton ? (
              <Skeleton w="70%" h={24} className="mt-0.5" />
            ) : (
              <p className="text-lg font-medium tabular-nums" style={{ color: c.tone }}>
                {cur.money(c.value)}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mb-3">
        <p
          className="text-xs uppercase tracking-wide font-medium"
          style={{ color: "var(--color-ink)", letterSpacing: "0.06em" }}
        >
          Cycles active on {dayLabel(asOf)}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
          Select a staff member to see their cycle, attendance and history
        </p>
      </div>

      {/* One card per person, spaced apart. */}
      <div className="flex flex-col gap-3">
        {showSkeleton ? (
          // Stepping to another cycle: placeholder cards in the shape of the real ones.
          [0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-xl border shadow-sm px-4 py-3.5 flex flex-col lg:flex-row lg:items-center gap-3"
              style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
            >
              <div className="flex items-center gap-2.5 flex-1">
                <Skeleton w={36} h={36} className="rounded-full shrink-0" />
                <div className="flex flex-col gap-1.5 flex-1">
                  <Skeleton w="40%" h={14} />
                  <Skeleton w="25%" h={11} />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 lg:w-[380px]">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="flex flex-col gap-1">
                    <Skeleton w={44} h={9} />
                    <Skeleton w={64} h={14} />
                  </div>
                ))}
              </div>
              <Skeleton w={150} h={32} className="lg:shrink-0" />
            </div>
          ))
        ) : sheet.rows.length === 0 ? (
          <p
            className="px-4 py-6 text-sm rounded-xl border"
            style={{ color: "var(--color-ink-mute)", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            Nobody is on payroll on {dayLabel(asOf)} yet.
            {canManage && " Set a salary below to start."}
          </p>
        ) : (
          sheet.rows.map((r) => (
            <PayrollLine
              key={r.staff_id}
              row={r}
              month={asOf}
              canManage={canManage}
              expanded={expanded === r.staff_id}
              onToggle={() => setExpanded(expanded === r.staff_id ? null : r.staff_id)}
              onPay={(kind) => setPaying({ target: r, name: r.display_name, kind, day: asOf })}
              onPayPeriod={(p) =>
                setPaying({
                  target: {
                    staff_id: r.staff_id,
                    cycle_start: p.periodStart,
                    cycle_end: p.periodEnd,
                    payableAmount: p.payable,
                    advancePaid: p.advancePaid,
                    salaryPaid: p.salaryPaid,
                    remaining: p.remaining,
                  },
                  name: r.display_name,
                  kind: "salary",
                  day: p.periodStart,
                })
              }
              onSetup={() =>
                setSetupFor({ staffId: r.staff_id, name: r.display_name, isNew: false })
              }
              onChanged={refresh}
            />
          ))
        )}
      </div>

      {/* Staff the Super Admin has created who have no salary yet. Listed rather
          than hidden: an employee silently missing from payroll is the failure
          mode this section exists to prevent. */}
      {canManage && sheet.notOnPayroll.length > 0 && (
        <div
          className="rounded-xl border shadow-sm overflow-hidden mt-6"
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
              Not on payroll
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
              {sheet.notOnPayroll.length} staff member
              {sheet.notOnPayroll.length !== 1 ? "s" : ""} with no salary set
            </p>
          </div>
          {sheet.notOnPayroll.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
              style={{ borderTop: "1px solid var(--color-hairline)" }}
            >
              <span className="min-w-0">
                <span className="block text-sm truncate" style={{ color: "var(--color-ink)" }}>
                  {s.display_name}
                </span>
                {s.title && (
                  <span className="block text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
                    {s.title}
                  </span>
                )}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setSetupFor({ staffId: s.id, name: s.display_name, isNew: true })
                }
              >
                Set salary
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={paying?.kind === "advance" ? "Pay a salary advance" : "Pay salary"}
        subtitle={
          paying
            ? `${paying.name} · ${dayLabel(paying.target.cycle_start)} → ${dayLabel(paying.target.cycle_end)}`
            : undefined
        }
      >
        {paying && (
          <PaymentForm
            row={paying.target}
            month={paying.day}
            kind={paying.kind}
            onDone={() => { setPaying(null); refresh(); }}
          />
        )}
      </Modal>

      <Modal
        open={!!setupFor}
        onClose={() => setSetupFor(null)}
        title={setupFor?.isNew ? "Put on payroll" : "Salary & cycle"}
        subtitle={setupFor?.name}
      >
        {setupFor && (
          <PayrollSetupForm
            staffId={setupFor.staffId}
            staffName={setupFor.name}
            onDone={(note) => {
              setSetupFor(null);
              setNotice(note);
              refresh();
            }}
          />
        )}
      </Modal>
    </section>
  );
}
