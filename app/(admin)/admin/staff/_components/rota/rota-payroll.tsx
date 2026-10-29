"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  getHourlyRates,
  getRotaPayrollSheet,
  recordRotaPayment,
  setHourlyRate,
} from "@/app/actions/rota";
import {
  PAYROLL_STATUS_LABEL,
  dayLabel,
  payrollStatus,
  type PayMethod,
  type PaymentKind,
} from "@/lib/payroll";
import {
  addDays,
  hoursLabel,
  rangeLabel,
  type HourlyRate,
  type RotaPayrollRow,
  type RotaPayrollSheet,
} from "@/lib/rota";
import { ROTA_PAY_PERIOD_LABEL, type RotaPayPeriod } from "@/lib/payout-mode";
import { useFormSubmit } from "@/lib/use-form-submit";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { useCurrency } from "@/components/currency-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaymentMethodPicker, splitIsValid, type PaymentMethod } from "@/components/ui/payment-method-picker";
import { Modal } from "../../../_components/modal";
import { tint } from "./ui";

// Wages for one pay period: hours off the rota × the hourly rate, less what has
// already been paid. Status is derived — Unpaid / Partially Paid / Paid — with the
// same rule and colours as the default payroll.

const labelCls = "text-xs uppercase tracking-wide";
const labelStyle = { color: "var(--color-ink-mute)", letterSpacing: "0.06em" };

// Theme tokens rather than PAYROLL_STATUS_COLOR's fixed hex, so the pills read in dark mode.
const STATUS_TOKEN = {
  unpaid: "var(--color-danger)",
  partial: "var(--color-warning)",
  paid: "var(--color-success)",
} as const;

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="text-[12px] px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap font-medium"
      style={{ color, background: tint(color, 14) }}
    >
      {children}
    </span>
  );
}

function StatusPill({ row }: { row: RotaPayrollRow }) {
  if (row.gross <= 0.005 && row.totalPaid <= 0.005) {
    return <Pill color="var(--color-ink-mute)">No hours</Pill>;
  }
  if (row.remaining < -0.005) {
    return <Pill color="var(--color-info)">Overpaid</Pill>;
  }
  const status = payrollStatus(row.gross, row.totalPaid);
  return <Pill color={STATUS_TOKEN[status]}>{PAYROLL_STATUS_LABEL[status]}</Pill>;
}

// ── Pay wages / an advance ────────────────────────────────────────────────────

function PayForm({
  row,
  sheet,
  kind,
  onDone,
}: {
  row: RotaPayrollRow;
  sheet: RotaPayrollSheet;
  kind: PaymentKind;
  onDone: () => void;
}) {
  const cur = useCurrency();
  const { state, pending, onSubmit } = useFormSubmit(recordRotaPayment, onDone);
  const [method, setMethod] = useState<PayMethod>("cash");
  const [amount, setAmount] = useState(kind === "salary" ? row.remaining.toFixed(2) : "");
  const [split, setSplit] = useState({ cash: "", online: "" });
  const amountNum = parseFloat(amount) || 0;
  const canSubmit =
    amountNum > 0 && splitIsValid(method as PaymentMethod, amountNum, split.cash, split.online);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="staff_id" value={row.staff_id} />
      <input type="hidden" name="period_id" value={sheet.periodId ?? ""} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="method" value={method} />

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
        {[
          {
            label: `${hoursLabel(row.hours)}${row.rate != null ? ` × ${cur.money2(row.rate)}/hr` : ""}`,
            value: cur.money2(row.gross),
          },
          ...(row.advancePaid > 0
            ? [{ label: "Advance already paid", value: `− ${cur.money2(row.advancePaid)}` }]
            : []),
          ...(row.salaryPaid > 0
            ? [{ label: "Wages already paid", value: `− ${cur.money2(row.salaryPaid)}` }]
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
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Remaining</span>
          <span className="text-base font-medium tabular-nums" style={{ color: "var(--color-primary)" }}>
            {cur.money2(Math.max(row.remaining, 0))}
          </span>
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelCls} style={labelStyle}>
          {kind === "advance" ? `Advance amount (${cur.symbol})` : `Amount to pay (${cur.symbol})`}
        </span>
        <Input
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          max={Math.max(row.remaining, 0)}
          required
          autoFocus
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className={labelCls} style={labelStyle}>Paid by</span>
        <PaymentMethodPicker
          methods={["cash", "online", "mixed"]}
          value={method as PaymentMethod}
          onChange={(m) => {
            setMethod(m as PayMethod);
            setSplit({ cash: "", online: "" });
          }}
          total={amountNum}
          cash={split.cash}
          online={split.online}
          onSplitChange={setSplit}
          disabled={pending}
        />
        <input type="hidden" name="cash_amount" value={method === "mixed" ? split.cash : ""} />
        <input type="hidden" name="online_amount" value={method === "mixed" ? split.online : ""} />
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Recorded as a staff salary expense on the Finance sheet.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelCls} style={labelStyle}>Note (optional)</span>
        <Input name="notes" placeholder="e.g. bank transfer ref" autoComplete="off" />
      </label>

      {state?.error && (
        <p
          className="text-sm rounded-md px-3 py-2"
          style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}
        >
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending || !canSubmit}>
        {pending ? "Recording…" : kind === "advance" ? "Record advance" : "Record wage payment"}
      </Button>
    </form>
  );
}

// ── Hourly rate ───────────────────────────────────────────────────────────────

function RateForm({
  staffId,
  today,
  onDone,
}: {
  staffId: string;
  today: string;
  onDone: () => void;
}) {
  const cur = useCurrency();
  const [history, setHistory] = useState<HourlyRate[] | null>(null);
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    getHourlyRates(staffId).then((h) => {
      if (!alive) return;
      setHistory(h);
      if (h[0]) setRate(String(h[0].rate));
    });
    return () => {
      alive = false;
    };
  }, [staffId]);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await setHourlyRate(staffId, rate, from);
          if (res?.error) setError(res.error);
          else onDone();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelCls} style={labelStyle}>Hourly rate ({cur.symbol})</span>
          <Input
            type="number"
            min="0"
            step="0.01"
            required
            autoFocus
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls} style={labelStyle}>Starts from</span>
          <Input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
      </div>
      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        Shifts on or after this date are paid at the new rate. Earlier shifts keep their old rate.
      </p>

      {history && history.length > 0 && (
        <div className="rounded-lg border text-sm" style={{ borderColor: "var(--color-hairline)" }}>
          {history.map((h, i) => (
            <div
              key={h.effectiveFrom}
              className="flex justify-between px-3 py-1.5"
              style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
            >
              <span style={{ color: "var(--color-ink-mute)" }}>From {dayLabel(h.effectiveFrom)}</span>
              <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>
                {cur.money2(h.rate)}/hr
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p
          className="text-sm rounded-md px-3 py-2"
          style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}
        >
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : "Save rate"}
      </Button>
    </form>
  );
}

// ── The sheet ─────────────────────────────────────────────────────────────────

export function RotaPayroll({
  initial,
  canManage,
}: {
  initial: RotaPayrollSheet;
  canManage: boolean;
}) {
  const cur = useCurrency();
  const [sheet, setSheet] = useState(initial);
  const [loading, startTransition] = useTransition();
  const [paying, setPaying] = useState<{ row: RotaPayrollRow; kind: PaymentKind } | null>(null);
  const [rateFor, setRateFor] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback((d: string) => {
    startTransition(async () => {
      try {
        const next = await getRotaPayrollSheet(d);
        if (next) setSheet(next);
      } catch {
        // keep the last known sheet on a transient failure
      }
    });
  }, []);

  const refresh = useCallback(() => load(sheet.periodStart), [load, sheet.periodStart]);
  useRealtime(["payroll", "staff", "settings"], refresh);

  const atLatest = sheet.periodEnd >= sheet.today;
  const frequency = ROTA_PAY_PERIOD_LABEL[sheet.frequency as RotaPayPeriod] ?? sheet.frequency;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div
          className="flex items-center rounded-lg border"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <button
            type="button"
            aria-label="Previous period"
            onClick={() => load(addDays(sheet.periodStart, -1))}
            className="p-2"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <ChevronLeft size={16} />
          </button>
          <span
            className="text-sm px-1 tabular-nums"
            style={{ color: "var(--color-ink)", opacity: loading ? 0.5 : 1 }}
          >
            {rangeLabel(sheet.periodStart, sheet.periodEnd)}
          </span>
          <button
            type="button"
            aria-label="Next period"
            disabled={atLatest}
            onClick={() => load(addDays(sheet.periodEnd, 1))}
            className="p-2 disabled:opacity-30"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          {frequency} pay period
        </span>
      </div>

      {/* Totals */}
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
        {[
          { label: "Hours", value: hoursLabel(sheet.totalHours), tone: "var(--color-ink)" },
          { label: "Gross wages", value: cur.money2(sheet.totalGross), tone: "var(--color-ink)" },
          { label: "Paid", value: cur.money2(sheet.totalPaid), tone: "var(--color-ink)" },
          {
            label: "Remaining",
            value: cur.money2(sheet.totalRemaining),
            tone: sheet.totalRemaining > 0 ? "var(--color-warning)" : "var(--color-success)",
          },
        ].map((t) => (
          <div
            key={t.label}
            className="rounded-xl border px-3 py-2.5"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{t.label}</p>
            <p className="text-lg tabular-nums font-medium" style={{ color: t.tone }}>{t.value}</p>
          </div>
        ))}
      </div>

      {/* Rows */}
      <div
        className="rounded-xl border divide-y"
        style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
      >
        {sheet.rows.length === 0 && (
          <p className="px-4 py-6 text-sm text-center" style={{ color: "var(--color-ink-mute)" }}>
            No staff in this period.
          </p>
        )}
        {sheet.rows.map((r) => (
          <div
            key={r.staff_id}
            className="px-4 py-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-6"
            style={{ borderColor: "var(--color-hairline)", opacity: r.is_active ? 1 : 0.6 }}
          >
            {/* Who, and how many hours */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>{r.display_name}</p>
                <StatusPill row={r} />
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
                {hoursLabel(r.hours)} · {r.shiftCount} {r.shiftCount === 1 ? "shift" : "shifts"} ·{" "}
                {r.rate != null ? (
                  `${cur.money2(r.rate)}/hr`
                ) : (
                  <span style={{ color: "var(--color-warning)" }}>no rate set</span>
                )}
              </p>
            </div>

            {/* The money — three equal columns, same on a phone as on a desktop */}
            <div
              className="grid grid-cols-3 gap-3 text-sm tabular-nums rounded-lg px-3 py-2 md:p-0 md:rounded-none md:min-w-[300px]"
              style={{ background: "var(--color-canvas-soft)" }}
            >
              {[
                { label: "Gross", value: r.gross, tone: "var(--color-ink)" },
                { label: "Paid", value: r.totalPaid, tone: "var(--color-ink)" },
                {
                  label: "Remaining",
                  value: Math.max(r.remaining, 0),
                  tone: r.remaining > 0.005 ? "var(--color-warning)" : "var(--color-ink-mute)",
                },
              ].map((m) => (
                <div key={m.label} className="text-left md:text-right min-w-0">
                  <p className="text-[12px]" style={{ color: "var(--color-ink-mute)" }}>{m.label}</p>
                  <p className="truncate font-medium" style={{ color: m.tone }}>{cur.money2(m.value)}</p>
                </div>
              ))}
            </div>

            {canManage && (
              <div className="flex gap-1.5 md:justify-end">
                <Button type="button" size="sm" variant="secondary" onClick={() => setRateFor({ id: r.staff_id, name: r.display_name })}>
                  Rate
                </Button>
                {r.remaining > 0.005 && (
                  <>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setPaying({ row: r, kind: "advance" })}>
                      Advance
                    </Button>
                    <Button type="button" size="sm" variant="primary" onClick={() => setPaying({ row: r, kind: "salary" })}>
                      Pay
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        Gross pay before tax. Hours come from the rota (actual times where a manager edited them),
        less unpaid breaks (paid breaks stay in); holidays count their paid hours, sick days count none.
      </p>

      <Modal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={paying ? `${paying.kind === "advance" ? "Advance" : "Pay wages"} · ${paying.row.display_name}` : ""}
        subtitle={rangeLabel(sheet.periodStart, sheet.periodEnd)}
      >
        {paying && (
          <PayForm
            key={`${paying.row.staff_id}|${paying.kind}`}
            row={paying.row}
            sheet={sheet}
            kind={paying.kind}
            onDone={() => {
              setPaying(null);
              load(sheet.periodStart);
            }}
          />
        )}
      </Modal>

      <Modal
        open={!!rateFor}
        onClose={() => setRateFor(null)}
        title={rateFor ? `Hourly rate · ${rateFor.name}` : ""}
      >
        {rateFor && (
          <RateForm
            key={rateFor.id}
            staffId={rateFor.id}
            today={sheet.today}
            onDone={() => {
              setRateFor(null);
              load(sheet.periodStart);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
