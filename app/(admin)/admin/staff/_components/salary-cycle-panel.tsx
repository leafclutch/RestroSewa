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

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  getCycleAttendance,
  setAttendanceDay,
  setCycleAnchor,
  verifyCycleAttendance,
} from "@/app/actions/payroll";
import type { ActionResult } from "@/app/actions/payroll";
import {
  ATTENDANCE_FRACTION,
  ATTENDANCE_LABEL,
  addDays,
  cycleFor,
  dayLabel,
  daysBetween,
} from "@/lib/payroll";
import type {
  AttendanceDay,
  AttendanceStatus,
  PayrollCycleRow,
} from "@/lib/payroll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarDays, Check, Loader2, Lock } from "lucide-react";

const money = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

// ─── Setting the cycle start ──────────────────────────────────────────────────

export function CycleStartForm({
  staffId,
  staffName,
  currentStart,
  currentLength,
  onDone,
}: {
  staffId: string;
  staffName: string;
  currentStart: string | null;
  currentLength: number;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    setCycleAnchor,
    null
  );
  const [start, setStart] = useState(currentStart ?? "");
  const [length, setLength] = useState(String(currentLength || 30));

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  // Show the admin the window their date actually produces, before they commit.
  const len = Math.max(1, Math.min(366, parseInt(length, 10) || 30));
  const preview = /^\d{4}-\d{2}-\d{2}$/.test(start) ? cycleFor(start, 0, len) : null;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="staff_id" value={staffId} />

      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        Setting the salary cycle for{" "}
        <span style={{ color: "var(--color-ink)" }}>{staffName}</span>.
      </p>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="c_start"
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Salary cycle start date
        </label>
        <input
          id="c_start"
          name="cycle_start"
          type="date"
          required
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="w-full text-sm rounded-lg border px-3 py-2"
          style={{
            background: "var(--color-canvas)",
            borderColor: "var(--color-hairline-input)",
            color: "var(--color-ink)",
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="c_len"
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Cycle length (days)
        </label>
        <Input
          id="c_len"
          name="cycle_length"
          type="number"
          min="1"
          max="366"
          value={length}
          onChange={(e) => setLength(e.target.value)}
        />
      </div>

      {preview ? (
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{ background: "var(--color-surface-2, #f6f8f8)", color: "var(--color-ink)" }}
        >
          <span style={{ color: "var(--color-ink-mute)" }}>Salary cycle: </span>
          {dayLabel(preview.start)} → {dayLabel(preview.end)}
          <span style={{ color: "var(--color-ink-mute)" }}> · {preview.totalDays} days</span>
          <p className="mt-1" style={{ color: "var(--color-ink-mute)" }}>
            The next cycle starts {dayLabel(addDays(preview.end, 1))}. Cycles already
            paid are never moved.
          </p>
        </div>
      ) : null}

      {state?.error ? (
        <p className="text-xs" style={{ color: "var(--color-danger, #a63c34)" }}>
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Save salary cycle
      </Button>
    </form>
  );
}

// ─── The cycle panel ──────────────────────────────────────────────────────────

export function SalaryCyclePanel({
  row,
  onChanged,
}: {
  row: PayrollCycleRow;
  onChanged: () => void;
}) {
  const [days, setDays] = useState<AttendanceDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getCycleAttendance(row.staff_id, row.cycle_start, row.cycle_end).then((d) => {
      if (live) {
        setDays(d);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [row.staff_id, row.cycle_start, row.cycle_end]);

  const byDate = new Map(days.map((d) => [d.work_date, d]));

  // Every day in the window. `daysBetween` is inclusive of both ends here because
  // cycle_end is the last day actually paid for.
  const span = daysBetween(row.cycle_start, row.cycle_end) + 1;
  const grid = Array.from({ length: span }, (_, i) => addDays(row.cycle_start, i));

  // Recomputed locally so the numbers move the instant a day is clicked, then
  // reconciled against the server on the next sheet refresh.
  const payable = grid.reduce(
    (n, d) => n + (byDate.has(d) ? byDate.get(d)!.day_fraction : 1),
    0
  );
  const absent = span - payable;
  const rate = (row.monthly_salary ?? 0) / (row.totalDays || 1);
  const calculated = Math.round(rate * payable * 100) / 100;

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
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            style={{ background: STATUS_TONE.present.bg, color: STATUS_TONE.present.ink }}
          >
            <Lock className="size-3" /> Verified
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {[
          ["Present", `${payable} days`],
          ["Absent", `${Math.round(absent * 1000) / 1000} days`],
          ["Payable", `${payable} days`],
          ["Calculated", money(calculated)],
          ["Paid", money(row.totalPaid)],
          ["Remaining", money(row.remaining)],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt
              className="text-[11px] uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              {k}
            </dt>
            <dd style={{ color: "var(--color-ink)" }}>{v}</dd>
          </div>
        ))}
      </dl>

      {loading ? (
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Loading attendance…
        </p>
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
                  className="flex size-9 flex-col items-center justify-center rounded-md text-[11px] leading-none disabled:opacity-60"
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
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          This staff member is still on calendar months. Set a salary cycle start date
          to move them onto their own {row.totalDays}-day cycle.
        </p>
      )}
    </div>
  );
}
