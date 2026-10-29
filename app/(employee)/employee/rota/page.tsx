import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { getMyRota } from "@/app/actions/rota";
import { getCurrentCurrency } from "@/lib/currency-server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import {
  SHIFT_KIND_LABEL,
  addDays,
  breakLabel,
  crossesMidnight,
  dayHeader,
  hoursLabel,
  rangeLabel,
  shiftPaidHours,
  type RotaShift,
} from "@/lib/rota";

// My Rota — the staff member's own week, read-only, so they can check their shifts
// before they come in. Only their own rows are ever fetched (getMyRota filters on
// the caller); pay appears only for someone who already holds a payroll right.

const KIND_TONE: Record<RotaShift["kind"], string> = {
  shift: "var(--color-primary)",
  holiday: "var(--color-success)",
  sick: "var(--color-danger)",
  off: "var(--color-ink-mute)",
};

export default async function MyRotaPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireRestaurantStaff();
  const { week } = await searchParams;
  const rota = await getMyRota(week);
  if (!rota) redirect("/employee/dashboard");

  const cur = rota.estimatedPay != null ? await getCurrentCurrency() : null;
  const byDate = new Map(rota.shifts.map((s) => [s.date, s]));
  const isThisWeek = rota.today >= rota.days[0] && rota.today <= rota.days[6];

  return (
    <div className="p-4 sm:p-5 max-w-xl mx-auto">
      <RealtimeRefresh topics={["payroll"]} />

      <h1
        className="text-2xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        My Rota
      </h1>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-mute)" }}>
        Your shifts for the week. Times may be subject to change.
      </p>

      {/* Week switcher */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <Link
          href={`/employee/rota?week=${addDays(rota.weekStart, -7)}`}
          aria-label="Previous week"
          className="p-2 rounded-lg border"
          style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)", background: "var(--color-canvas)" }}
        >
          <ChevronLeft size={16} />
        </Link>
        <div className="text-center">
          <p className="text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
            {rangeLabel(rota.days[0], rota.days[6])}
          </p>
          {!isThisWeek && (
            <Link href="/employee/rota" className="text-xs" style={{ color: "var(--color-primary)" }}>
              Back to this week
            </Link>
          )}
        </div>
        <Link
          href={`/employee/rota?week=${addDays(rota.weekStart, 7)}`}
          aria-label="Next week"
          className="p-2 rounded-lg border"
          style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)", background: "var(--color-canvas)" }}
        >
          <ChevronRight size={16} />
        </Link>
      </div>

      {/* The seven days */}
      <div
        className="rounded-xl border divide-y"
        style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
      >
        {rota.days.map((d) => {
          const s = byDate.get(d);
          const isToday = d === rota.today;
          const start = s?.actual_start ?? s?.planned_start ?? null;
          const end = s?.actual_end ?? s?.planned_end ?? null;
          return (
            <div
              key={d}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                borderColor: "var(--color-hairline)",
                background: isToday ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : undefined,
              }}
            >
              <div className="w-24 shrink-0">
                <p
                  className="text-sm"
                  style={{ color: isToday ? "var(--color-primary)" : "var(--color-ink)", fontWeight: isToday ? 600 : 400 }}
                >
                  {dayHeader(d)}
                </p>
                {isToday && (
                  <p className="text-[12px]" style={{ color: "var(--color-primary)" }}>Today</p>
                )}
              </div>

              <div className="flex-1 min-w-0">
                {!s ? (
                  <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>—</p>
                ) : s.kind === "shift" ? (
                  <>
                    <p className="text-sm flex items-center gap-1.5 tabular-nums" style={{ color: "var(--color-ink)" }}>
                      <Clock size={13} style={{ color: KIND_TONE.shift }} />
                      {start}–{end}
                      {crossesMidnight(start, end) && (
                        <span className="text-[12px]" style={{ color: "var(--color-ink-mute)" }}>(+1 day)</span>
                      )}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                      {[
                        s.role_code,
                        hoursLabel(shiftPaidHours(s)),
                        breakLabel(s) || null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </>
                ) : (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ color: KIND_TONE[s.kind], background: `color-mix(in srgb, ${KIND_TONE[s.kind]} 14%, transparent)` }}
                  >
                    {s.kind === "sick" ? "Sickness" : SHIFT_KIND_LABEL[s.kind]}
                    {s.kind === "holiday" && (s.paid_hours ?? 0) > 0 && ` · ${hoursLabel(s.paid_hours ?? 0)}`}
                  </span>
                )}
                {s?.notes && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{s.notes}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="mt-3 rounded-xl border px-4 py-3 flex items-center justify-between"
        style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
      >
        <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>Total this week</span>
        <span className="text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
          {hoursLabel(rota.totalHours)}
          {cur && rota.estimatedPay != null && ` · ${cur.money2(rota.estimatedPay)}`}
        </span>
      </div>

      <p className="text-xs mt-3" style={{ color: "var(--color-ink-mute)" }}>
        Something wrong with your shifts? Speak to your manager.
      </p>
    </div>
  );
}
