"use client";

import { useActionState, useState } from "react";
import { updateCurrencySetting, type ActionResult } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { CURRENCIES, currencyFormatter } from "@/lib/currency";
import { Banknote, CheckCircle2, TriangleAlert } from "lucide-react";

/**
 * The currency every amount is shown in — customer menu, bills, sales, finance, reports.
 *
 * Its own card and its own action, like the business day: it changes every figure on
 * every screen and must never ride along with an unrelated "Save".
 */
export function CurrencyClient({ currency }: { currency: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    updateCurrencySetting,
    null
  );
  const [code, setCode] = useState(currency);

  const saved = state !== null && "ok" in state;
  const errored = state !== null && "error" in state;
  const changed = code !== currency;
  const preview = currencyFormatter(code);

  return (
    <form
      action={action}
      className="rounded-xl border px-5 py-5 max-w-lg"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p
        className="text-sm font-medium mb-1 flex items-center gap-2"
        style={{ color: "var(--color-ink)" }}
      >
        <Banknote size={15} /> Currency
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
        The currency every price and amount is shown in — the customer menu, bills, sales,
        finance and reports, for admins and staff alike.
      </p>

      <label className="flex flex-col gap-1.5 mb-1">
        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Currency
        </span>
        <select
          name="currency"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-9 w-72 max-w-full rounded-lg border px-3 text-sm"
          style={{
            borderColor: "var(--color-hairline-input)",
            color: "var(--color-ink)",
            background: "var(--color-canvas)",
          }}
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.symbol} — {c.name} ({c.code})
            </option>
          ))}
        </select>
      </label>

      <p className="text-xs mt-3" style={{ color: "var(--color-ink-mute)" }}>
        Amounts will look like <strong>{preview.money(12500)}</strong> and{" "}
        <strong>{preview.money2(1234.5)}</strong>.
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
            This only changes the <strong>symbol</strong>. Existing prices and amounts are not
            converted — a 500 menu price stays 500, now shown in {preview.name}.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 mt-5 flex-wrap">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save currency"}
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
  );
}
