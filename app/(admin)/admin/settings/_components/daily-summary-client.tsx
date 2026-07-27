"use client";

import { useActionState, useState } from "react";
import { updateDailySummarySettings, type ActionResult } from "@/app/actions/settings";
import type { DailySummaryConfig } from "@/lib/reports/daily-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, CheckCircle2 } from "lucide-react";

const SLOTS = 3;

/**
 * Daily financial-summary recipients.
 *
 * Its own card and action, like the business-day boundary: turning it on and
 * choosing who receives the day's takings is an owner decision, not a print
 * detail. The send itself happens server-side after the business day closes.
 */
export function DailySummaryClient({ config }: { config: DailySummaryConfig }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    updateDailySummarySettings,
    null
  );

  const [enabled, setEnabled] = useState(config.enabled);
  const [emails, setEmails] = useState<string[]>(() => {
    const e = [...config.emails];
    while (e.length < SLOTS) e.push("");
    return e.slice(0, SLOTS);
  });

  const saved = state !== null && "ok" in state;
  const errored = state !== null && "error" in state;

  const setEmail = (i: number, v: string) =>
    setEmails((prev) => prev.map((e, idx) => (idx === i ? v : e)));

  return (
    <form
      action={action}
      className="rounded-xl border px-5 py-5 max-w-lg"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />

      <p
        className="text-sm font-medium mb-1 flex items-center gap-2"
        style={{ color: "var(--color-ink)" }}
      >
        <Mail size={15} /> Daily summary emails
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
        After your business day closes, email a financial summary — sales, purchases, balances,
        profit and stock alerts — to up to three addresses. Leave it off to send nothing.
      </p>

      <label className="flex items-center gap-2.5 mb-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
          style={{ accentColor: "var(--color-primary)" }}
        />
        <span className="text-sm" style={{ color: "var(--color-ink)" }}>
          Send a daily summary
        </span>
      </label>

      <div className="flex flex-col gap-2" style={{ opacity: enabled ? 1 : 0.55 }}>
        {emails.map((e, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Recipient {i + 1}{i === 0 ? "" : " (optional)"}
            </span>
            <Input
              name={`email_${i}`}
              type="email"
              autoComplete="off"
              placeholder="owner@example.com"
              value={e}
              disabled={!enabled}
              onChange={(ev) => setEmail(i, ev.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-5 flex-wrap">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved && (
          <span className="text-sm flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
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
  );
}
