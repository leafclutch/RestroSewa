"use client";

import { useOptimistic, useState, useTransition } from "react";
import { SlidersHorizontal, ChevronDown } from "lucide-react";
import { setCategoryEnabled } from "@/app/actions/push";
import {
  NOTIFICATION_CATEGORIES,
  CATEGORY_HINT,
  ALL_CATEGORIES,
} from "@/lib/push/categories";
import type { NotificationCategory } from "@/lib/push/categories";

/**
 * What this staff member is willing to be interrupted by.
 *
 * Collapsed by default. This is a screen people visit to DEAL WITH a waiting request,
 * not to configure things — so the settings sit behind one tap and stay out of the
 * way of the queue.
 *
 * The toggles are optimistic: a switch that waits for a round-trip before moving
 * feels broken, and there is nothing at stake in being wrong for 200ms. If the write
 * fails, the state snaps back on the next render, which is the honest outcome.
 *
 * `embedded` drops the standalone card chrome so it can sit as a strip inside the
 * notification dropdown — which is now its only home, the standalone settings page
 * having been folded into the single workspace.
 */
export function NotificationPreferences({
  muted,
  embedded = false,
}: {
  muted: NotificationCategory[];
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const [optimisticMuted, toggleOptimistic] = useOptimistic(
    new Set(muted),
    (current, category: NotificationCategory) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    }
  );

  const mutedCount = optimisticMuted.size;

  return (
    <div
      className={embedded ? "border-b overflow-hidden" : "rounded-xl border mb-6 overflow-hidden"}
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 text-left ${embedded ? "px-4 py-2.5" : "px-4 py-3"}`}
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--color-ink-mute)" + "15" }}
        >
          <SlidersHorizontal size={15} style={{ color: "var(--color-ink-mute)" }} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            What you get alerted about
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {mutedCount === 0
              ? "Everything is on"
              : `${mutedCount} categor${mutedCount === 1 ? "y" : "ies"} muted`}
          </p>
        </div>

        <ChevronDown
          size={16}
          style={{
            color: "var(--color-ink-mute)",
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 160ms ease",
          }}
        />
      </button>

      {open && (
        <div className="border-t" style={{ borderColor: "var(--color-hairline)" }}>
          {ALL_CATEGORIES.map((category) => {
            const on = !optimisticMuted.has(category);

            return (
              <label
                key={category}
                className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 cursor-pointer"
                style={{ borderColor: "var(--color-hairline)" }}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className="text-sm block"
                    style={{ color: "var(--color-ink)", fontWeight: 400 }}
                  >
                    {NOTIFICATION_CATEGORIES[category]}
                  </span>
                  <span
                    className="text-xs block mt-0.5 break-words"
                    style={{ color: "var(--color-ink-mute)" }}
                  >
                    {CATEGORY_HINT[category]}
                  </span>
                </span>

                {/* A real checkbox underneath, so it is reachable by keyboard and
                    announced by a screen reader — the pill is only paint. */}
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => {
                    startTransition(async () => {
                      toggleOptimistic(category);
                      await setCategoryEnabled(category, !on);
                    });
                  }}
                />

                <span
                  aria-hidden
                  className="shrink-0 relative rounded-full"
                  style={{
                    width: 44,
                    height: 26,
                    background: on ? "var(--color-primary)" : "var(--color-hairline-input)",
                    transition: "background 160ms ease",
                  }}
                >
                  <span
                    className="absolute rounded-full"
                    style={{
                      width: 20,
                      height: 20,
                      top: 3,
                      left: on ? 21 : 3,
                      background: "#fff",
                      transition: "left 160ms cubic-bezier(0.22,0.61,0.36,1)",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    }}
                  />
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
