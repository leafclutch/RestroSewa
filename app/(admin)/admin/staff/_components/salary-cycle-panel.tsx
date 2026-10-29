"use client";

// The salary-cycle panel: what window a staff member is in, which days they were
// absent for, and what that leaves payable.
//
// It lives in its own file rather than inside payroll-client.tsx because that file
// is already ~900 lines, and because the grid below is the seam a real attendance
// module will later replace — keeping it separate means that swap touches one file.
//
// The grid marks EXCEPTIONS only. A day nobody has touched is present, which is
// exactly how `staff_attendance_days` stores it: ten absences are ten rows, not
// thirty. The running totals here therefore mirror `cycle_payable_days` in SQL and
// `payableDays` in lib/payroll.ts; all three must agree.

import { useEffect, useState, useTransition } from "react";
import {
  getCycleAttendance,
  setAttendanceDay,
  verifyCycleAttendance,
} from "@/app/actions/payroll";
import {
  ATTENDANCE_FRACTION,
  ATTENDANCE_LABEL,
  addDays,
  dayLabel,
  daysBetween,
} from "@/lib/payroll";
import type {
  AttendanceDay,
  AttendanceStatus,
  PayrollCycleRow,
} from "@/lib/payroll";
import { Button } from "@/components/ui/button";
import { CalendarDays, Check, Loader2, Lock } from "lucide-react";
import { useCurrency } from "@/components/currency-provider";
import { Skeleton } from "@/components/ui/skeleton";

/** The statuses an admin can pick, in the order they are offered. */
const CYCLE_STATUSES: AttendanceStatus[] = [
  "present",
  "absent",
  "half_day",
  "leave",
  "holiday",
];

const STATUS_TONE: Record<AttendanceStatus, { bg: string; ink: string }> = {
  present: { bg: "var(--color-ok-wash, #e2eee7)", ink: "var(--color-ok, #2c7048)" },
  absent: { bg: "var(--color-danger-wash, #f6e5e3)", ink: "var(--color-danger, #a63c34)" },
  half_day: { bg: "var(--color-warn-wash, #f4ebd9)", ink: "var(--color-warn, #96660b)" },
  leave: { bg: "var(--color-warn-wash, #f4ebd9)", ink: "var(--color-warn, #96660b)" },
  holiday: { bg: "var(--color-surface-2, #f6f8f8)", ink: "var(--color-ink-mute)" },
};

// ─── The cycle panel ──────────────────────────────────────────────────────────

export function SalaryCyclePanel({
  row,
  onChanged,
}: {
  row: PayrollCycleRow;
  onChanged: () => void;
}) {
  const cur = useCurrency();
  const [days, setDays] = useState<AttendanceDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  // Also refetched when the SHEET's view of the cycle moves (absences marked on
  // another device, the cycle re-priced by a salary change), so the grid and the
  // row above it can never disagree. Only the first load shows "Loading…".
  const sheetKey = `${row.absentDays}|${row.payableAmount}|${row.attendanceVerified}`;
  useEffect(() => {
    let live = true;
    getCycleAttendance(row.staff_id, row.cycle_start, row.cycle_end).then((d) => {
      if (live) {
        setDays(d);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [row.staff_id, row.cycle_start, row.cycle_end, sheetKey]);

  const byDate = new Map(days.map((d) => [d.work_date, d]));

  // Every day in the window. `daysBetween` is inclusive of both ends here because
  // cycle_end is the last day actually paid for.
  const span = daysBetween(row.cycle_start, row.cycle_end) + 1;
  const grid = Array.from({ length: span }, (_, i) => addDays(row.cycle_start, i));

  // Recomputed locally so the numbers move the instant a day is clicked, by the
  // SAME formula as the sheet (`payroll_cycle_sheet`): salary × payable days ÷
  // cycle days, rounded once; remaining = that − everything paid. The sheet
  // refresh that follows every click then lands on identical figures.
  const payable = grid.reduce(
    (n, d) => n + (byDate.has(d) ? byDate.get(d)!.day_fraction : 1),
    0
  );
  const absent = span - payable;
  const owes =
    Math.round(((row.monthly_salary ?? 0) * payable * 100) / (row.totalDays || 1)) / 100;
  const remaining = Math.max(owes - row.totalPaid, 0);

  function mark(date: string, status: AttendanceStatus) {
    setPicking(null);
    setError(null);
    // Optimistic: the grid is the thing being edited, so it must not lag a click.
    setDays((prev) => {
      const rest = prev.filter((d) => d.work_date !== date);
      return status === "present"
        ? rest
        : [
            ...rest,
            {
              work_date: date,
              status,
              day_fraction: ATTENDANCE_FRACTION[status],
              notes: null,
            },
          ];
    });
    startTransition(async () => {
      const res = await setAttendanceDay(row.staff_id, date, status);
      if (res?.error) {
        setError(res.error);
        // Put the server's version back rather than leaving a lie on screen.
        setDays(await getCycleAttendance(row.staff_id, row.cycle_start, row.cycle_end));
        return;
      }
      onChanged();
    });
  }

  function toggleVerified() {
    if (!row.cycle_id) return;
    setError(null);
    startTransition(async () => {
      const res = await verifyCycleAttendance(row.cycle_id!, !row.attendanceVerified);
      if (res?.error) setError(res.error);
      else onChanged();
    });
  }

  const locked = row.attendanceVerified;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="size-4" style={{ color: "var(--color-ink-mute)" }} />
        <span className="text-sm" style={{ color: "var(--color-ink)" }}>
          {dayLabel(row.cycle_start)} → {dayLabel(row.cycle_end)}
        </span>
        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          · {row.totalDays} days
          {row.cycle_kind === "calendar_month" ? " · calendar month" : ""}
        </span>
        {locked ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px]"
            style={{ background: STATUS_TONE.present.bg, color: STATUS_TONE.present.ink }}
          >
            <Lock className="size-3" /> Verified
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {/* The same figures, under the same names, as the row above. */}
        {[
          ["Salary", cur.money2(row.monthly_salary ?? 0)],
          ["Payable days", `${Math.round(payable * 1000) / 1000} of ${row.totalDays}`],
          ["Absent", `${Math.round(absent * 1000) / 1000} days`],
          ["Payable", cur.money2(owes)],
          ["Advance", cur.money2(row.advancePaid)],
          ["Paid", cur.money2(row.totalPaid)],
          ["Remaining", cur.money2(remaining)],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt
              className="text-[12px] uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              {k}
            </dt>
            <dd style={{ color: "var(--color-ink)" }}>{v}</dd>
          </div>
        ))}
      </dl>

      {loading ? (
        // One placeholder per day of the cycle, the size of the real day buttons.
        <div className="flex flex-wrap gap-1" aria-busy>
          {grid.map((d) => (
            <Skeleton key={d} onSoft w={36} h={36} className="rounded-md" />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {grid.map((d) => {
            const entry = byDate.get(d);
            const status: AttendanceStatus = entry ? entry.status : "present";
            const tone = STATUS_TONE[status];
            return (
              <div key={d} className="relative">
                <button
                  type="button"
                  disabled={locked || pending}
                  onClick={() => setPicking(picking === d ? null : d)}
                  title={`${dayLabel(d)} — ${ATTENDANCE_LABEL[status]}`}
                  className="flex size-9 flex-col items-center justify-center rounded-md text-[12px] leading-none disabled:opacity-60"
                  style={{ background: tone.bg, color: tone.ink }}
                >
                  <span>{Number(d.slice(8, 10))}</span>
                  <span className="text-[9px] opacity-80">
                    {status === "present" ? "" : ATTENDANCE_LABEL[status][0]}
                  </span>
                </button>

                {picking === d ? (
                  <div
                    className="absolute z-20 mt-1 flex flex-col rounded-lg border p-1 shadow-lg"
                    style={{
                      background: "var(--color-canvas)",
                      borderColor: "var(--color-hairline-input)",
                    }}
                  >
                    {CYCLE_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => mark(d, s)}
                        className="whitespace-nowrap rounded px-2 py-1 text-left text-xs"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {ATTENDANCE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {error ? (
        <p className="text-xs" style={{ color: "var(--color-danger, #a63c34)" }}>
          {error}
        </p>
      ) : null}

      {row.cycle_id ? (
        <div>
          <Button type="button" variant="secondary" disabled={pending} onClick={toggleVerified}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {locked ? "Reopen attendance" : "Verify attendance"}
          </Button>
        </div>
      ) : (
        // Everyone is on their own cycle now; a calendar month only appears when
        // looking back at a month that was paid before cycles existed.
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          A calendar month, paid before salary cycles began.
        </p>
      )}
    </div>
  );
}
