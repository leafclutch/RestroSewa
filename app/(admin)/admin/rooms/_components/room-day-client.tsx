"use client";

import { useState, useTransition } from "react";
import { updateRoomDaySettings } from "@/app/actions/rooms-admin";
import { Button } from "@/components/ui/button";
import { Clock, CheckCircle2, TriangleAlert } from "lucide-react";

// Whole hours only, for the same reason the business-day card uses them: every
// real checkout time is on the hour, and a dropdown is far harder to mis-set on
// a phone than a free time field.
//
// The new-day list stops at 11 AM deliberately — past that it stops being "they
// arrived in the small hours" and starts being a data-entry mistake. The
// price-double list is the full day, because a hotel really can run an evening
// checkout.
const NEW_DAY_HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DOUBLE_HOURS = Array.from({ length: 24 }, (_, i) => i);

function label(h: number): string {
  if (h === 0) return "12:00 AM (midnight)";
  if (h === 12) return "12:00 PM (noon)";
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

/** "8 PM" / "3 AM" — compact, for the worked example. */
function short(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/**
 * When a room charge steps up to the next night.
 *
 * Its own card and its own action, like the business-day boundary it mirrors:
 * this changes what every guest is CHARGED, and it must never ride along with
 * an unrelated "Save".
 */
export function RoomDayClient({
  newDayHour,
  doubleHour,
}: {
  newDayHour: number;
  doubleHour: number;
}) {
  // useActionState is wrong here: this action returns `null` for SUCCESS, which
  // is also the hook's initial state, so a freshly loaded page would claim
  // "Saved" before anyone touched it. An explicit transition keeps the two apart.
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDay, setNewDay] = useState(newDayHour);
  const [dbl, setDbl] = useState(doubleHour);

  const changed = newDay !== newDayHour || dbl !== doubleHour;

  function submit(formData: FormData) {
    startTransition(async () => {
      const res = await updateRoomDaySettings(null, formData);
      if (res && "error" in res) {
        setError(res.error);
        setSaved(false);
      } else {
        setError(null);
        setSaved(true);
      }
    });
  }

  // The two arrivals that make the rule click, recomputed live. An arrival an
  // hour BEFORE the new-day hour is the interesting one: it belongs to the
  // previous day and so its price steps up the very same day it walked in.
  const evening = newDay <= 20 ? 20 : 23;
  const early = newDay === 0 ? 23 : newDay - 1;

  const selectStyle = {
    borderColor: "var(--color-hairline-input)",
    color: "var(--color-ink)",
    background: "var(--color-canvas)",
  };

  return (
    <form
      action={submit}
      className="rounded-xl border px-5 py-5 mb-6"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p
        className="text-sm font-medium mb-1 flex items-center gap-2"
        style={{ color: "var(--color-ink)" }}
      >
        <Clock size={15} /> Room night boundary
      </p>
      <p className="text-xs mb-4 max-w-2xl" style={{ color: "var(--color-ink-mute)" }}>
        When a room charge steps up to the next night. A night ends at the same time for every
        guest, rather than 24 hours after each one happened to arrive.
      </p>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Room new day starts at
          </span>
          <select
            name="new_day_hour"
            value={newDay}
            onChange={(e) => setNewDay(Number(e.target.value))}
            className="h-9 w-56 rounded-lg border px-3 text-sm"
            style={selectStyle}
          >
            {NEW_DAY_HOURS.map((h) => (
              <option key={h} value={h}>
                {label(h)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Price doubles at
          </span>
          <select
            name="double_hour"
            value={dbl}
            onChange={(e) => setDbl(Number(e.target.value))}
            className="h-9 w-56 rounded-lg border px-3 text-sm"
            style={selectStyle}
          >
            {DOUBLE_HOURS.map((h) => (
              <option key={h} value={h}>
                {label(h)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* A worked example beats a definition. These are the two cases the rule
          exists for, and the second is the one that surprises people. */}
      <div
        className="rounded-lg border px-3 py-2.5 mt-4 max-w-2xl"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        <p className="text-xs mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          A guest arriving at <strong>{short(evening)}</strong> is charged a second night from{" "}
          <strong>tomorrow {short(dbl)}</strong>.
        </p>
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          A guest arriving at <strong>{short(early)}</strong> counts as the previous night&apos;s
          guest, so they are charged a second night from{" "}
          <strong>today {short(dbl)}</strong>.
        </p>
      </div>

      {changed && (
        <div
          className="rounded-lg border px-3 py-2.5 mt-4 flex items-start gap-2 max-w-2xl"
          style={{
            background: "var(--color-warning-bg)",
            borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)",
          }}
        >
          <TriangleAlert
            size={14}
            className="mt-0.5 shrink-0"
            style={{ color: "var(--color-warning)" }}
          />
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            Guests <strong>already checked in</strong> keep the times that applied when they
            arrived, and <strong>past bills never change</strong>. This affects new check-ins from
            now on.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 mt-5 flex-wrap">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save night boundary"}
        </Button>
        {saved && !pending && (
          <span
            className="text-sm flex items-center gap-1.5"
            style={{ color: "var(--color-success)" }}
          >
            <CheckCircle2 size={15} /> Saved
          </span>
        )}
        {error && (
          <span className="text-sm" style={{ color: "var(--color-ruby)" }}>
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
