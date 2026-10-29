"use client";

import { useCallback, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Copy, Plus } from "lucide-react";
import { copyPreviousWeek, getRotaWeek } from "@/app/actions/rota";
import {
  SHIFT_KIND_LABEL,
  addDays,
  dayHeader,
  formatShift,
  hoursLabel,
  rangeLabel,
  shiftPaidHours,
  type RotaWeek,
} from "@/lib/rota";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { useCurrency } from "@/components/currency-provider";
import { Modal } from "../../../_components/modal";
import { ShiftEditor } from "./shift-editor";
import { KIND_COLOR, tint } from "./ui";

// The rota board: staff down the side, Mon–Sun across the top — the same grid as
// the paper rota pinned up in the kitchen. Tap a cell to roster, edit or clear it.
//
// On a phone the grid scrolls sideways INSIDE its card (the name column stays
// pinned), never the page.

export function RotaBoard({ initial, canManage }: { initial: RotaWeek; canManage: boolean }) {
  const cur = useCurrency();
  const [week, setWeek] = useState(initial);
  const [loading, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ staffId: string; name: string; date: string } | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [copying, startCopy] = useTransition();

  const load = useCallback((start: string) => {
    startTransition(async () => {
      try {
        const next = await getRotaWeek(start);
        if (next) setWeek(next);
      } catch {
        // keep the last known week on a transient failure
      }
    });
  }, []);

  const refresh = useCallback(() => load(week.weekStart), [load, week.weekStart]);
  useRealtime(["payroll", "staff"], refresh);

  const go = (by: number) => {
    setCopyMsg(null);
    load(addDays(week.weekStart, by * 7));
  };

  const shiftOf = (staffId: string, date: string) =>
    week.shifts.find((s) => s.staff_id === staffId && s.date === date) ?? null;

  const lastShiftOf = (staffId: string, date: string) =>
    week.shifts
      .filter((s) => s.staff_id === staffId && s.kind === "shift" && s.date < date)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  const weekHours = (staffId: string) =>
    week.shifts
      .filter((s) => s.staff_id === staffId)
      .reduce((a, s) => a + shiftPaidHours(s), 0);

  const dayHours = (date: string) =>
    week.shifts.filter((s) => s.date === date).reduce((a, s) => a + shiftPaidHours(s), 0);

  const totalHours = week.shifts.reduce((a, s) => a + shiftPaidHours(s), 0);
  const totalCost = week.staff.reduce(
    (a, st) => a + weekHours(st.id) * (st.hourly_rate ?? 0),
    0
  );

  const onCopy = () => {
    setCopyMsg(null);
    startCopy(async () => {
      const res = await copyPreviousWeek(week.weekStart);
      if ("error" in res) setCopyMsg(res.error);
      else {
        setCopyMsg(
          res.copied === 0
            ? "Nothing to copy — last week is empty, or every slot here is already filled."
            : `Copied ${res.copied} ${res.copied === 1 ? "entry" : "entries"} from last week.`
        );
        load(week.weekStart);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Week navigation */}
      <div className="flex items-center gap-2 flex-wrap">
        <div
          className="flex items-center rounded-lg border"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => go(-1)}
            className="p-2"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm px-1 tabular-nums" style={{ color: "var(--color-ink)", opacity: loading ? 0.5 : 1 }}>
            {rangeLabel(week.days[0], week.days[6])}
          </span>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => go(1)}
            className="p-2"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {week.today < week.days[0] || week.today > week.days[6] ? (
          <button
            type="button"
            onClick={() => load(week.today)}
            className="text-sm px-3 py-2 rounded-lg"
            style={{ color: "var(--color-primary)" }}
          >
            This week
          </button>
        ) : null}

        {canManage && (
          <button
            type="button"
            onClick={onCopy}
            disabled={copying}
            className="ml-auto inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border"
            style={{
              borderColor: "var(--color-hairline)",
              color: "var(--color-ink)",
              background: "var(--color-canvas)",
            }}
          >
            <Copy size={14} />
            {copying ? "Copying…" : "Copy last week"}
          </button>
        )}
      </div>

      {copyMsg && (
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          {copyMsg}
        </p>
      )}

      {/* The grid */}
      <div
        className="rounded-xl border overflow-x-auto"
        style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
      >
        <table className="w-full border-collapse text-sm" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th
                className="sticky left-0 z-10 text-left font-normal text-xs px-3 py-2 border-b"
                style={{
                  background: "var(--color-canvas)",
                  borderColor: "var(--color-hairline)",
                  color: "var(--color-ink-mute)",
                  minWidth: 140,
                }}
              >
                Name
              </th>
              {week.days.map((d) => {
                const isToday = d === week.today;
                return (
                  <th
                    key={d}
                    className="font-normal text-xs px-2 py-2 border-b border-l text-left"
                    style={{
                      borderColor: "var(--color-hairline)",
                      color: isToday ? "var(--color-primary)" : "var(--color-ink-mute)",
                      fontWeight: isToday ? 600 : 400,
                    }}
                  >
                    {dayHeader(d)}
                  </th>
                );
              })}
              <th
                className="font-normal text-xs px-3 py-2 border-b border-l text-right"
                style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
              >
                Hours
              </th>
            </tr>
          </thead>
          <tbody>
            {week.staff.map((st) => (
              <tr key={st.id}>
                <td
                  className="sticky left-0 z-10 px-3 py-2 border-b align-top"
                  style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
                >
                  <p className="truncate" style={{ color: "var(--color-ink)", opacity: st.is_active ? 1 : 0.5 }}>
                    {st.display_name}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: st.hourly_rate != null ? "var(--color-ink-mute)" : "var(--color-warning)" }}
                  >
                    {st.hourly_rate != null ? `${cur.money2(st.hourly_rate)}/hr` : "No rate set"}
                  </p>
                </td>
                {week.days.map((d) => {
                  const s = shiftOf(st.id, d);
                  const color = s ? KIND_COLOR[s.kind] : null;
                  const edited = !!s?.actual_start;
                  const isToday = d === week.today;
                  return (
                    <td
                      key={d}
                      className="border-b border-l p-1 align-top"
                      style={{
                        borderColor: "var(--color-hairline)",
                        background: isToday ? tint("var(--color-primary)", 4) : undefined,
                      }}
                    >
                      <button
                        type="button"
                        disabled={!canManage}
                        aria-label={`${st.display_name}, ${dayHeader(d)}${s ? `: ${formatShift(s)}` : ": empty"}`}
                        onClick={() => setEditing({ staffId: st.id, name: st.display_name, date: d })}
                        className="group w-full min-h-[52px] rounded-md px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-default enabled:hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        style={
                          color
                            ? {
                                background: tint(color, s?.kind === "off" ? 8 : 12),
                                boxShadow: `inset 3px 0 0 ${color}`,
                                color: "var(--color-ink)",
                              }
                            : { color: "var(--color-ink-mute)" }
                        }
                      >
                        {s ? (
                          <>
                            <span className="flex items-center gap-1 font-medium whitespace-nowrap">
                              {s.kind === "shift" ? formatShift(s) : SHIFT_KIND_LABEL[s.kind]}
                              {edited && (
                                <span
                                  title="Actual times differ from the plan"
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ background: "var(--color-warning)" }}
                                />
                              )}
                            </span>
                            {s.kind === "shift" && (
                              <span className="block leading-snug" style={{ color: "var(--color-ink-mute)" }}>
                                {/* Worked time — the break is never in it; a paid break is paid on top. */}
                                {`${+shiftPaidHours({ ...s, break_paid: false }).toFixed(2)}h`}
                                {s.break_minutes > 0 &&
                                  `, ${s.break_paid ? "paid" : "unpaid"} break ${s.break_minutes}min`}
                              </span>
                            )}
                            {s.kind === "holiday" && (s.paid_hours ?? 0) > 0 && (
                              <span className="block" style={{ color: "var(--color-ink-mute)" }}>
                                {hoursLabel(s.paid_hours ?? 0)} paid
                              </span>
                            )}
                          </>
                        ) : canManage ? (
                          <span className="flex h-full min-h-[36px] items-center justify-center rounded border border-dashed opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
                            style={{ borderColor: "var(--color-hairline-input)" }}
                          >
                            <Plus size={14} />
                          </span>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
                <td
                  className="border-b border-l px-3 py-2 text-right tabular-nums align-top"
                  style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                >
                  {hoursLabel(weekHours(st.id))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td
                className="sticky left-0 z-10 px-3 py-2 text-xs"
                style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
              >
                Total
              </td>
              {week.days.map((d) => (
                <td
                  key={d}
                  className="border-l px-2 py-2 text-xs tabular-nums"
                  style={{
                    borderColor: "var(--color-hairline)",
                    background: "var(--color-canvas-soft)",
                    color: "var(--color-ink-mute)",
                  }}
                >
                  {hoursLabel(dayHours(d))}
                </td>
              ))}
              <td
                className="border-l px-3 py-2 text-right tabular-nums font-medium"
                style={{
                  borderColor: "var(--color-hairline)",
                  background: "var(--color-canvas-soft)",
                  color: "var(--color-ink)",
                }}
              >
                {hoursLabel(totalHours)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        {week.staff.length === 0
          ? "No active staff yet."
          : `Estimated wage cost this week: ${cur.money2(totalCost)} (at current rates).`}
      </p>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? editing.name : ""}
        subtitle="Rota entry"
      >
        {editing && (
          <ShiftEditor
            key={`${editing.staffId}|${editing.date}`}
            staffId={editing.staffId}
            date={editing.date}
            existing={shiftOf(editing.staffId, editing.date)}
            suggestion={lastShiftOf(editing.staffId, editing.date)}
            onDone={() => {
              setEditing(null);
              load(week.weekStart);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
