"use client";

import { useState, useTransition } from "react";
import { deleteShift, saveShift } from "@/app/actions/rota";
import { useFormSubmit } from "@/lib/use-form-submit";
import {
  ROLE_HINT,
  ROLE_PRESETS,
  SHIFT_KIND_LABEL,
  dayHeader,
  hoursLabel,
  shiftMinutes,
  shiftPaidHours,
  crossesMidnight,
  type RotaShift,
  type ShiftKind,
} from "@/lib/rota";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KIND_COLOR, Segmented, labelCls, labelStyle, tint } from "./ui";

// One rota cell: a shift, a holiday, a sick day or a day off. Opened from the board.


const KINDS: ShiftKind[] = ["shift", "holiday", "sick", "off"];

export function ShiftEditor({
  staffId,
  date,
  existing,
  suggestion,
  onDone,
}: {
  staffId: string;
  date: string;
  existing: RotaShift | null;
  /** The staff member's most recent shift this week — prefills an empty cell. */
  suggestion: RotaShift | null;
  onDone: () => void;
}) {
  const seed = existing ?? (suggestion?.kind === "shift" ? suggestion : null);
  const [kind, setKind] = useState<ShiftKind>(existing?.kind ?? "shift");
  const [role, setRole] = useState(seed?.role_code ?? "");
  const [start, setStart] = useState(seed?.planned_start ?? "");
  const [end, setEnd] = useState(seed?.planned_end ?? "");
  const [brk, setBrk] = useState(String(seed?.break_minutes ?? 0));
  const [breakPaid, setBreakPaid] = useState(seed?.break_paid ?? false);
  const [showActual, setShowActual] = useState(!!existing?.actual_start);
  const [aStart, setAStart] = useState(existing?.actual_start ?? "");
  const [aEnd, setAEnd] = useState(existing?.actual_end ?? "");
  const [paidHours, setPaidHours] = useState(
    existing?.paid_hours != null ? String(existing.paid_hours) : "8"
  );

  const { state, pending, onSubmit } = useFormSubmit(saveShift, onDone);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const preview = shiftPaidHours({
    kind,
    planned_start: start || null,
    planned_end: end || null,
    actual_start: showActual && aStart && aEnd ? aStart : null,
    actual_end: showActual && aStart && aEnd ? aEnd : null,
    break_minutes: Number(brk) || 0,
    break_paid: breakPaid,
    paid_hours: paidHours === "" ? null : Number(paidHours),
  });
  const breakMin = Math.max(Number(brk) || 0, 0);
  const useActual = showActual && aStart && aEnd;
  const spanStart = useActual ? aStart : start;
  const spanEnd = useActual ? aEnd : end;
  const spanMin = spanStart && spanEnd ? shiftMinutes(spanStart, spanEnd) : 0;
  const overnight = crossesMidnight(
    (showActual && aStart) || start || null,
    (showActual && aEnd) || end || null
  );


  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="staff_id" value={staffId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="break_paid" value={breakPaid ? "true" : "false"} />

      {/* Type */}
      <div className="flex flex-col gap-1.5">
        <span className={labelCls} style={labelStyle}>{dayHeader(date)}</span>
        <Segmented
          label="Entry type"
          full
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({
            value: k,
            label: (
              <>
                <span
                  aria-hidden
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: KIND_COLOR[k] }}
                />
                {SHIFT_KIND_LABEL[k]}
              </>
            ),
          }))}
        />
      </div>

      {kind === "shift" && (
        <>
          {/* Role */}
          <div className="flex flex-col gap-1.5">
            <span className={labelCls} style={labelStyle}>Role</span>
            <div className="flex flex-wrap gap-1.5 items-center">
              {ROLE_PRESETS.map((r) => {
                const active = role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    title={ROLE_HINT[r]}
                    aria-pressed={active}
                    onClick={() => setRole(active ? "" : r)}
                    className="h-9 min-w-11 px-2.5 rounded-md border text-sm transition-colors"
                    style={{
                      borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
                      background: active ? tint("var(--color-primary)", 10) : "var(--color-canvas)",
                      color: active ? "var(--color-primary)" : "var(--color-ink)",
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {r}
                  </button>
                );
              })}
              <Input
                name="role_code"
                value={role}
                onChange={(e) => setRole(e.target.value.toUpperCase())}
                placeholder="Other"
                aria-label="Other role"
                maxLength={12}
                className="h-9 w-24 py-1"
                autoComplete="off"
              />
            </div>
          </div>

          {/* Times — two columns even on a phone; native time pickers need the room. */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 min-w-0">
              <span className={labelCls} style={labelStyle}>Start</span>
              <Input type="time" name="planned_start" value={start} onChange={(e) => setStart(e.target.value)} required />
            </label>
            <label className="flex flex-col gap-1.5 min-w-0">
              <span className={labelCls} style={labelStyle}>
                End{overnight && !showActual ? " · next day" : ""}
              </span>
              <Input type="time" name="planned_end" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </label>
          </div>

          {/* Break: minutes, and whether they're paid. */}
          <div className="flex flex-col gap-1.5">
            <span className={labelCls} style={labelStyle}>Break</span>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative w-28">
                <Input
                  type="number"
                  name="break_minutes"
                  inputMode="numeric"
                  min="0"
                  max="600"
                  step="5"
                  value={brk}
                  onChange={(e) => setBrk(e.target.value)}
                  className="pr-10"
                  aria-label="Break minutes"
                />
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none"
                  style={{ color: "var(--color-ink-mute)" }}
                >
                  min
                </span>
              </div>
              <Segmented
                label="Break pay"
                value={breakPaid}
                onChange={setBreakPaid}
                options={[
                  { value: false, label: "Unpaid" },
                  { value: true, label: "Paid" },
                ]}
              />
            </div>
            {/* The sum, spelled out: a paid break counts as worked time, an unpaid one comes off. */}
            {spanMin > 0 && breakMin > 0 && (
              <p
                className="text-xs rounded-md px-2.5 py-2 tabular-nums"
                style={{
                  background: tint(breakPaid ? "var(--color-success)" : "var(--color-warning)", 10),
                  color: "var(--color-ink)",
                }}
              >
                {breakPaid ? (
                  <>
                    {hoursLabel(spanMin / 60)} shift · {breakMin}m break <b>counted</b> ={" "}
                    <b>{hoursLabel(spanMin / 60)} paid</b>
                  </>
                ) : (
                  <>
                    {hoursLabel(spanMin / 60)} shift − {breakMin}m break <b>not counted</b> ={" "}
                    <b>{hoursLabel(Math.max(spanMin - breakMin, 0) / 60)} paid</b>
                  </>
                )}
              </p>
            )}
            {breakMin === 0 && (
              <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                Paid break counts in the hours; unpaid break is taken off.
              </span>
            )}
          </div>

          {/* What actually happened — a manager's correction after the shift. */}
          <div
            className="flex flex-col gap-3 rounded-lg border p-3"
            style={{ borderColor: "var(--color-hairline)" }}
          >
            <label className="flex items-start gap-2.5 text-sm cursor-pointer" style={{ color: "var(--color-ink)" }}>
              <input
                type="checkbox"
                checked={showActual}
                onChange={(e) => setShowActual(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0"
                style={{ accentColor: "var(--color-primary)" }}
              />
              <span>
                Actual times differ
                <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  Late start, left early or overtime — pay follows these times.
                </span>
              </span>
            </label>
            {showActual && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 min-w-0">
                  <span className={labelCls} style={labelStyle}>Actual start</span>
                  <Input type="time" name="actual_start" value={aStart} onChange={(e) => setAStart(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1.5 min-w-0">
                  <span className={labelCls} style={labelStyle}>Actual end</span>
                  <Input type="time" name="actual_end" value={aEnd} onChange={(e) => setAEnd(e.target.value)} />
                </label>
              </div>
            )}
          </div>
        </>
      )}

      {kind === "holiday" && (
        <label className="flex flex-col gap-1.5">
          <span className={labelCls} style={labelStyle}>Paid holiday hours</span>
          <Input
            type="number"
            name="paid_hours"
            inputMode="decimal"
            min="0"
            max="24"
            step="0.25"
            value={paidHours}
            onChange={(e) => setPaidHours(e.target.value)}
            className="w-28"
          />
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Set to 0 for unpaid leave.
          </span>
        </label>
      )}

      {kind === "sick" && (
        <p
          className="text-xs rounded-lg px-3 py-2"
          style={{ color: "var(--color-ink-mute)", background: "var(--color-canvas-soft)" }}
        >
          Sick days are not paid from the rota. Statutory sick pay (SSP) is handled outside the app.
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className={labelCls} style={labelStyle}>Note (optional)</span>
        <Input name="notes" defaultValue={existing?.notes ?? ""} maxLength={300} autoComplete="off" />
      </label>

      <div
        className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm"
        style={{ background: tint("var(--color-primary)", 8), color: "var(--color-ink)" }}
      >
        <span style={{ color: "var(--color-ink-mute)" }}>Paid hours</span>
        <span className="tabular-nums font-medium" style={{ color: "var(--color-primary)" }}>
          {hoursLabel(preview)}
          {kind === "shift" && overnight && (
            <span className="text-xs font-normal ml-1.5" style={{ color: "var(--color-ink-mute)" }}>
              ends next day
            </span>
          )}
        </span>
      </div>

      {(state?.error || deleteError) && (
        <p
          className="text-sm rounded-md px-3 py-2"
          style={{ color: "var(--color-danger)", background: "var(--color-danger-bg)" }}
        >
          {state?.error ?? deleteError}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending || deleting} className="flex-1">
          {pending ? "Saving…" : "Save"}
        </Button>
        {existing && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending || deleting}
            onClick={() =>
              startDelete(async () => {
                const res = await deleteShift(staffId, date);
                if (res?.error) setDeleteError(res.error);
                else onDone();
              })
            }
          >
            {deleting ? "Clearing…" : "Clear"}
          </Button>
        )}
      </div>
    </form>
  );
}
