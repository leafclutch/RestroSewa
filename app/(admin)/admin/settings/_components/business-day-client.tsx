"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateBusinessDaySettings,
  closeBusinessDayNow,
  reopenBusinessDay,
  type ActionResult,
  type BusinessDaySettings,
} from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Clock, CheckCircle2, TriangleAlert, Power, Undo2 } from "lucide-react";

// Whole hours only — every real closing time is on the hour, and a dropdown of
// them is far harder to mis-set on a phone than a free time field. Any hour of the
// day: before noon is a late close that keeps after-midnight sales on the night
// before; noon or later is an early close after which sales are already tomorrow's.
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function label(h: number): string {
  if (h === 0) return "12:00 AM (midnight)";
  if (h === 12) return "12:00 PM (noon)";
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

/** The minute before hour `h`, as a clock reading: 22 → "9:59 PM". */
function minuteBefore(h: number): string {
  const p = (h + 23) % 24;
  const base = label(p).replace(/:00.*$/, "");
  return `${base}:59 ${p < 12 ? "AM" : "PM"}`;
}

// Every restaurant trades in Nepal, and this admin's browser may not be set to it.
const TZ = "Asia/Kathmandu";
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
const dayName = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/**
 * The business-day boundary.
 *
 * Its own card and its own action, like the discount PIN: this is not a print
 * detail, it changes what every number on every report MEANS, and it must never
 * ride along with an unrelated "Save".
 */
export function BusinessDayClient({ state: day }: { state: BusinessDaySettings }) {
  const closingHour = day.closingHour;
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    updateBusinessDaySettings,
    null
  );
  const [hour, setHour] = useState(closingHour);
  // Follow the saved hour when it changes underneath us (saved here, or on another
  // device) — useState only reads its initial value once.
  const [savedHour, setSavedHour] = useState(closingHour);
  if (savedHour !== closingHour) {
    setSavedHour(closingHour);
    setHour(closingHour);
  }

  const saved = state !== null && "ok" in state;
  // Pull the saved value back in at once, so this card and the rest of the page
  // show it without a manual reload.
  const router = useRouter();
  useEffect(() => {
    if (saved) router.refresh();
  }, [state, saved, router]);
  const errored = state !== null && "error" in state;
  const changed = hour !== closingHour;

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <form
        action={action}
        className="rounded-xl border px-5 py-5"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <p
          className="text-sm font-medium mb-1 flex items-center gap-2"
          style={{ color: "var(--color-ink)" }}
        >
          <Clock size={15} /> Business closing time
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
          When your trading day ends — any hour. Close before midnight and sales after closing
          count toward the next day. Serve past midnight and those late sales stay on the{" "}
          <strong>same</strong> business day instead of starting a new one.
        </p>

        <label className="flex flex-col gap-1.5 mb-1">
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Day ends at
          </span>
          <select
            name="closing_hour"
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            className="h-9 w-56 rounded-lg border px-3 text-sm"
            style={{
              borderColor: "var(--color-hairline-input)",
              color: "var(--color-ink)",
              background: "var(--color-canvas)",
            }}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {label(h)}
              </option>
            ))}
          </select>
        </label>

        {/* A worked example beats a definition — this is the question everyone
            actually has, and the 2:50 case is the one that surprises people. */}
        <p className="text-xs mt-3" style={{ color: "var(--color-ink-mute)" }}>
          {hour === 0 ? (
            <>
              A bill at <strong>11:30 PM</strong> counts as today; anything from{" "}
              <strong>12:00 AM</strong> counts as the next day.
            </>
          ) : hour >= 12 ? (
            <>
              A bill at <strong>{minuteBefore(hour)}</strong> counts as today; anything from{" "}
              <strong>{label(hour)}</strong> counts toward <strong>tomorrow&apos;s</strong>{" "}
              business day.
            </>
          ) : (
            <>
              A bill at <strong>11:30 PM</strong>, <strong>12:45 AM</strong> or{" "}
              <strong>{minuteBefore(hour)}</strong> all count as the same business day. The next
              day starts at <strong>{label(hour)}</strong>.
            </>
          )}
        </p>

        {changed && (
          <div
            className="rounded-lg border px-3 py-2.5 mt-4 flex items-start gap-2"
            style={{
              background: "var(--color-warning-bg)",
              borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)",
            }}
          >
            <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
            <p className="text-xs" style={{ color: "var(--color-warning)" }}>
              This applies to <strong>past days too</strong>. Sales, finance and stock figures for
              earlier days will shift once as orders near the boundary move to a neighbouring
              business day. Your totals don&apos;t change — only which day they land on.
              Yesterday&apos;s and today&apos;s daily summaries are sent again with the new
              figures; for older days, use Resend in Report history.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 mt-5 flex-wrap">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save closing time"}
          </Button>
          {saved && (
            <span
              className="text-sm flex items-center gap-1.5"
              style={{ color: "var(--color-success)" }}
            >
              <CheckCircle2 size={15} /> Saved
            </span>
          )}
          {errored && (
            <span className="text-sm" style={{ color: "var(--color-ruby)" }}>
              {(state as { error: string }).error}
            </span>
          )}
        </div>
      </form>

      <CloseTodayCard day={day} />
    </div>
  );
}

/**
 * "Close today's business" — end the current business day now, for today only.
 *
 * A controlled click + transition rather than a form action, and an inline
 * two-step confirm rather than window.confirm: this moves every sale made from
 * now on to tomorrow, so it should take a deliberate second tap.
 */
function CloseTodayCard({ day }: { day: BusinessDaySettings }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && "error" in res) {
        setError(res.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  };

  return (
    <div
      className="rounded-xl border px-5 py-5"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p
        className="text-sm font-medium mb-1 flex items-center gap-2"
        style={{ color: "var(--color-ink)" }}
      >
        <Power size={15} /> Close today&apos;s business
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
        Closing early tonight? End the business day now and every sale from this moment counts
        toward the next day. Only today is affected — tomorrow closes at your normal time again.
      </p>

      <div
        className="rounded-lg border px-3 py-2.5 text-xs flex flex-col gap-1"
        style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
      >
        <span>
          Current business day:{" "}
          <strong style={{ color: "var(--color-ink)" }}>{dayName(day.today)}</strong>
        </span>
        <span>
          Started {when(day.startedAt)} · ends {when(day.endsAt)}
        </span>
        {day.previousClosedEarlyAt && (
          <span>
            {dayName(day.previousDay)} was closed early at{" "}
            <strong style={{ color: "var(--color-ink)" }}>{time(day.previousClosedEarlyAt)}</strong>.
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-4 flex-wrap">
        {!confirming ? (
          <Button
            type="button"
            variant="primary"
            disabled={busy || !day.canCloseNow}
            onClick={() => setConfirming(true)}
          >
            Close {dayName(day.today)} now
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => run(closeBusinessDayNow)}
            >
              {busy ? "Closing…" : "Yes, close it now"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </>
        )}

        {day.canReopen && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => run(reopenBusinessDay)}
          >
            <span className="flex items-center gap-1.5">
              <Undo2 size={14} /> Reopen {dayName(day.previousDay)}
            </span>
          </Button>
        )}
      </div>

      {confirming && (
        <p className="text-xs mt-3" style={{ color: "var(--color-warning)" }}>
          Every sale from now on counts toward {dayName(day.nextDay)}. {dayName(day.today)}&apos;s
          daily summary goes out on the next scheduled run.
        </p>
      )}
      {!day.canCloseNow && (
        <p className="text-xs mt-3" style={{ color: "var(--color-ink-mute)" }}>
          {dayName(day.today)} only started {when(day.startedAt)}, so there is nothing to close
          yet. It can be closed from {when(day.closableFrom)}.
        </p>
      )}
      {error && (
        <p className="text-sm mt-3" style={{ color: "var(--color-ruby)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
