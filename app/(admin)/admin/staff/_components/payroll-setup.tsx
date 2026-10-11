"use client";

// One staff member's payroll arrangement, set up and edited in ONE place.
//
// One date drives the money: the SALARY START — their first salary and first
// cycle begin on it, and nothing before it is owed. The joining date is kept too,
// but only as a record of when they joined; it never changes pay. After that a salary
// change starts at a cycle boundary only — this cycle or the next — so the figure
// on the sheet is always the salary the cycle is paid at. Moving the cycle start
// is a separate correction ("Change cycle"). Every figure shown comes from
// `getPayrollSetup`, worked out on the server by the same rule the database pays
// by (`salary_for_cycle`).

import { useEffect, useState, useTransition } from "react";
import { useFormSubmit } from "@/lib/use-form-submit";
import {
  deleteSalaryRevision,
  getPayrollSetup,
  savePayrollSetup,
  updateSalaryRevision,
  type SetupResult,
} from "@/app/actions/payroll";
import {
  addDays,
  dayLabel,
  effectiveAnchor,
} from "@/lib/payroll";
import type { PayrollSetup } from "@/lib/payroll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrency } from "@/components/currency-provider";
import { Pencil, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const LABEL = "text-xs uppercase tracking-wide";
const LABEL_STYLE = { color: "var(--color-ink-mute)", letterSpacing: "0.06em" } as const;
const FIELD = "w-full text-sm rounded-lg border px-3 py-2";
const FIELD_STYLE = {
  background: "var(--color-canvas)",
  borderColor: "var(--color-hairline-input)",
  color: "var(--color-ink)",
} as const;
const NOTE = { color: "var(--color-ink-mute)" } as const;

// ─── The form ─────────────────────────────────────────────────────────────────

export function PayrollSetupForm({
  staffId,
  staffName,
  onDone,
}: {
  staffId: string;
  staffName: string;
  onDone: (notice: string | null) => void;
}) {
  const [setup, setSetup] = useState<PayrollSetup | null>(null);

  useEffect(() => {
    let live = true;
    getPayrollSetup(staffId).then((s) => { if (live) setSetup(s); });
    return () => { live = false; };
  }, [staffId]);

  if (!setup) {
    // The form's own shape: a note, the salary field, the cycle line, the button.
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton w="60%" h={12} />
        <div className="flex flex-col gap-1.5">
          <Skeleton w={120} h={10} />
          <Skeleton h={38} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton w={100} h={10} />
          <Skeleton h={38} />
          <Skeleton w="80%" h={11} />
        </div>
        <Skeleton h={40} />
      </div>
    );
  }
  return <SetupFields setup={setup} staffName={staffName} onDone={onDone} />;
}

function SetupFields({
  setup,
  staffName,
  onDone,
}: {
  setup: PayrollSetup;
  staffName: string;
  onDone: (notice: string | null) => void;
}) {
  const cur = useCurrency();
  const isNew = setup.joiningDate === null;
  const today = setup.today;

  const [salary, setSalary] = useState(setup.salaryNow === null ? "" : String(setup.salaryNow));
  const [applies, setApplies] = useState<"current" | "next">("current");
  // The cycle start: always shown for someone new, a deliberate correction after.
  const [changeCycle, setChangeCycle] = useState(isNew);
  // A record only: when they joined. Payroll counts from the salary start.
  const [joining, setJoining] = useState(setup.joiningDate ?? today);
  const [start, setStartRaw] = useState(setup.anchor ?? setup.joiningDate ?? today);
  // For someone new the salary start follows the joining date until set apart.
  const [startTouched, setStartTouched] = useState(!isNew);
  const setStart = (v: string) => { setStartTouched(true); setStartRaw(v); };
  const [length, setLength] = useState(String(setup.length || 30));

  const len = Math.max(1, Math.min(366, parseInt(length, 10) || 30));
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(start);
  // Where cycles will really start: past anything already paid or verified.
  const usedStart =
    validStart && !isNew ? effectiveAnchor(start, len, setup.lockedUntil) : start;
  const pushed = changeCycle && !isNew && validStart && usedStart !== start;
  const firstCycle = validStart
    ? { start: usedStart, end: addDays(usedStart, len - 1) }
    : null;

  const salaryNum = parseFloat(salary);
  const salaryChanged = !isNew && setup.salaryNow !== null && salaryNum !== setup.salaryNow;
  const futureStart = validStart && start > today;
  const futureJoining = joining > today;

  const { state, pending, onSubmit } = useFormSubmit<SetupResult>(savePayrollSetup, (res) =>
    onDone(res && "notice" in res ? res.notice : null)
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="staff_id" value={setup.staffId} />
      <input type="hidden" name="applies" value={applies} />
      <input type="hidden" name="change_cycle" value={changeCycle ? "1" : "0"} />

      <p className="text-xs" style={NOTE}>
        {isNew ? "Putting " : "Salary and cycle for "}
        <span style={{ color: "var(--color-ink)" }}>{staffName}</span>
        {isNew ? " on payroll." : "."}
      </p>

      {/* Joining date — for the record; it never changes what is paid. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="s_joining" className={LABEL} style={LABEL_STYLE}>Joining date</label>
        <input
          id="s_joining"
          name="joining_date"
          type="date"
          required
          max={today}
          value={joining}
          onChange={(e) => {
            setJoining(e.target.value);
            if (!startTouched) setStartRaw(e.target.value);
          }}
          className={FIELD}
          style={FIELD_STYLE}
        />
        <p className="text-xs" style={NOTE}>
          For your records. Pay is counted from the salary start, not from this date.
        </p>
        {futureJoining && (
          <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
            The joining date cannot be in the future.
          </p>
        )}
      </div>

      {/* Salary */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="s_salary" className={LABEL} style={LABEL_STYLE}>
          Monthly salary ({cur.symbol})
        </label>
        <Input
          id="s_salary"
          name="monthly_salary"
          type="number"
          min="0"
          step="0.01"
          required
          autoFocus
          placeholder="25000.00"
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
        />
      </div>

      {/* For an existing person, a new salary starts at a cycle boundary: one of
          these two, never an arbitrary day. */}
      {!isNew && setup.currentCycle && setup.nextCycle && salaryChanged && (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL} style={LABEL_STYLE}>New salary applies from</span>
          {(
            [
              ["current", "This cycle", setup.currentCycle],
              ["next", "Next cycle", setup.nextCycle],
            ] as const
          ).map(([v, label, c]) => (
            <label
              key={v}
              className="flex items-center gap-2.5 text-sm px-3 py-2 rounded-lg border cursor-pointer"
              style={{
                borderColor: applies === v ? "var(--color-primary)" : "var(--color-hairline)",
                color: "var(--color-ink)",
              }}
            >
              <input
                type="radio"
                checked={applies === v}
                onChange={() => setApplies(v)}
              />
              <span>
                {label}{" "}
                <span className="text-xs" style={NOTE}>
                  {dayLabel(c.start)} → {dayLabel(c.end)}
                </span>
              </span>
            </label>
          ))}
          <p className="text-xs" style={NOTE}>
            {applies === "current"
              ? `The cycle being paid now is re-priced to ${cur.money(salaryNum || 0)}. If more than that has already been paid for it, it keeps the old salary.`
              : `This cycle stays at ${cur.money(setup.salaryNow ?? 0)}.`}
          </p>
        </div>
      )}

      {/* The one date that drives pay: salary start = first cycle = first salary. */}
      {changeCycle ? (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="s_start" className={LABEL} style={LABEL_STYLE}>
                Salary start
              </label>
              <input
                id="s_start"
                name="start_date"
                type="date"
                required
                max={today}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={FIELD}
                style={FIELD_STYLE}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="s_len" className={LABEL} style={LABEL_STYLE}>Cycle (days)</label>
              <Input
                id="s_len"
                name="cycle_length"
                type="number"
                min="1"
                max="366"
                value={length}
                onChange={(e) => setLength(e.target.value)}
              />
            </div>
          </div>
          {firstCycle && !futureStart && (
            <p className="text-xs" style={NOTE}>
              {isNew ? "Paid from " : "Cycles run "}
              <span style={{ color: "var(--color-ink)" }}>
                {dayLabel(firstCycle.start)} → {dayLabel(firstCycle.end)}
              </span>
              , then every {len} days.
            </p>
          )}
          {!isNew && !setup.lockedUntil && (
            <p className="text-xs" style={NOTE}>
              Nothing has been paid yet, so the first salary moves with it.
            </p>
          )}
          {pushed && (
            <p className="text-xs" style={{ color: "var(--color-warning)" }}>
              Cycles up to {dayLabel(setup.lockedUntil!)} already have payments or verified
              attendance and stay as they are. The new timing starts {dayLabel(usedStart)}.
            </p>
          )}
          {validStart && start < joining && (
            <p className="text-xs" style={{ color: "var(--color-warning)" }}>
              The salary starts before the joining date, so the joining date will be set to{" "}
              {dayLabel(start)}.
            </p>
          )}
          {futureStart && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
              The salary start cannot be in the future.
            </p>
          )}
        </div>
      ) : (
        setup.currentCycle && (
          <p className="text-xs" style={NOTE}>
            Salary from {setup.anchor ? dayLabel(setup.anchor) : "—"} · paid every{" "}
            {setup.length} days · this cycle{" "}
            <span style={{ color: "var(--color-ink)" }}>
              {dayLabel(setup.currentCycle.start)} → {dayLabel(setup.currentCycle.end)}
            </span>
            .{" "}
            <button
              type="button"
              onClick={() => setChangeCycle(true)}
              className="underline"
              style={{ color: "var(--color-primary)" }}
            >
              Change cycle
            </button>
          </p>
        )
      )}

      {state?.error && (
        <p
          className="text-sm rounded-md px-3 py-2"
          style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}
        >
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending || !!futureStart || futureJoining}>
        {pending ? "Saving…" : isNew ? "Put on payroll" : "Save"}
      </Button>
    </form>
  );
}

// ─── Salary history, correctable ──────────────────────────────────────────────

export function SalaryRevisions({
  staffId,
  version,
  canManage,
  onChanged,
}: {
  staffId: string;
  version: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const cur = useCurrency();
  const [setup, setSetup] = useState<PayrollSetup | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ from: "", salary: "" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "note"; text: string } | null>(null);
  const [busy, startTransition] = useTransition();

  // Refetch with the sheet: a save from the setup form, or from another device.
  useEffect(() => {
    let live = true;
    getPayrollSetup(staffId).then((s) => { if (live) setSetup(s); });
    return () => { live = false; };
  }, [staffId, version]);

  if (!setup) {
    return (
      <div className="flex flex-col gap-1.5" aria-busy>
        <Skeleton onSoft w={110} h={11} />
        {[0, 1].map((i) => (
          <Skeleton key={i} onSoft h={36} />
        ))}
      </div>
    );
  }
  if (setup.revisions.length === 0) return null;

  const run = (fn: () => Promise<SetupResult>) => {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (res && "error" in res) {
        setMessage({ tone: "error", text: res.error });
        return;
      }
      setEditing(null);
      setConfirming(null);
      if (res && "notice" in res) setMessage({ tone: "note", text: res.notice });
      setSetup(await getPayrollSetup(staffId));
      onChanged();
    });
  };

  const rows = [...setup.revisions].reverse();

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs uppercase tracking-wide font-medium" style={{ color: "var(--color-ink)", letterSpacing: "0.06em" }}>
        Salary history
      </p>
      {rows.map((r, i) => {
        const until = i === 0 ? null : addDays(rows[i - 1].effectiveFrom, -1);
        const isEditing = editing === r.effectiveFrom;
        return (
          <div
            key={r.effectiveFrom}
            className="flex items-center justify-between gap-3 text-sm px-3 py-2 rounded-lg flex-wrap"
            style={{ background: "var(--color-canvas)" }}
          >
            {isEditing ? (
              <div className="flex items-center gap-2 flex-wrap flex-1">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.salary}
                  onChange={(e) => setDraft({ ...draft, salary: e.target.value })}
                  className="w-32"
                  aria-label="Monthly salary"
                />
                {/* Amount only: when a salary starts is set by the cycle it was
                    given for, so the date is not a second thing to keep in step. */}
                <span className="text-xs" style={NOTE}>from {dayLabel(r.effectiveFrom)}</span>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      updateSalaryRevision(staffId, r.effectiveFrom, draft.from, parseFloat(draft.salary))
                    )
                  }
                >
                  Save
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <span className="min-w-0">
                  <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>
                    {cur.money(r.salary)}
                  </span>
                  <span className="text-xs" style={NOTE}>
                    {" "}· from {dayLabel(r.effectiveFrom)}
                    {until ? ` to ${dayLabel(until)}` : " onwards"}
                  </span>
                </span>
                {canManage && (
                  <span className="flex items-center gap-1 shrink-0">
                    {confirming === r.effectiveFrom ? (
                      <>
                        <span className="text-xs" style={NOTE}>Remove?</span>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => run(() => deleteSalaryRevision(staffId, r.effectiveFrom))}
                        >
                          Remove
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label="Change this salary"
                          className="p-1.5 rounded-md"
                          style={NOTE}
                          onClick={() => {
                            setMessage(null);
                            setConfirming(null);
                            setEditing(r.effectiveFrom);
                            setDraft({ from: r.effectiveFrom, salary: String(r.salary) });
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                        {setup.revisions.length > 1 && (
                          <button
                            type="button"
                            aria-label="Remove this salary"
                            className="p-1.5 rounded-md"
                            style={NOTE}
                            onClick={() => {
                              setMessage(null);
                              setEditing(null);
                              setConfirming(r.effectiveFrom);
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </>
                    )}
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}
      {message && (
        <p
          className="text-xs"
          style={{ color: message.tone === "error" ? "var(--color-ruby)" : "var(--color-warning)" }}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
