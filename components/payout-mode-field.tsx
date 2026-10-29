"use client";

import { useState } from "react";
import {
  ROTA_PAY_PERIOD_LABEL,
  type PayoutMode,
  type RotaPayPeriod,
} from "@/lib/payout-mode";

// The Super Admin's "Staff payout" choice, shared by the create and edit forms.
// Submits `payout_mode` and `rota_pay_period`; `parsePayoutForm` reads them back.

const OPTIONS: { value: PayoutMode; label: string; desc: string }[] = [
  {
    value: "standard",
    label: "Default staff payout",
    desc: "Monthly salary with advances and salary cycles",
  },
  {
    value: "advanced",
    label: "Advanced payout",
    desc: "Rota system (UK/US) — weekly shifts, hourly pay, paid per pay period",
  },
];

export function PayoutModeField({
  defaultMode = "standard",
  defaultPeriod = "weekly",
}: {
  defaultMode?: PayoutMode;
  defaultPeriod?: RotaPayPeriod;
}) {
  const [mode, setMode] = useState<PayoutMode>(defaultMode);

  return (
    <div className="flex flex-col gap-2">
      <p
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
      >
        Staff payout
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {OPTIONS.map((o) => {
          const active = mode === o.value;
          return (
            <label
              key={o.value}
              className="flex items-start gap-2.5 cursor-pointer px-3 py-2.5 rounded-lg border flex-1 transition-colors"
              style={{
                borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
              }}
            >
              <input
                type="radio"
                name="payout_mode"
                value={o.value}
                checked={active}
                onChange={() => setMode(o.value)}
                className="mt-0.5 accent-indigo-500"
              />
              <span>
                <span className="text-sm block" style={{ color: "var(--color-ink)" }}>
                  {o.label}
                </span>
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  {o.desc}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {mode === "advanced" ? (
        <label className="flex items-center gap-3 text-sm" style={{ color: "var(--color-ink)" }}>
          Pay period
          <select
            name="rota_pay_period"
            defaultValue={defaultPeriod}
            className="h-9 rounded-sm border px-3 text-sm"
            style={{
              borderColor: "var(--color-hairline-input)",
              color: "var(--color-ink)",
              background: "var(--color-canvas)",
            }}
          >
            {(Object.keys(ROTA_PAY_PERIOD_LABEL) as RotaPayPeriod[]).map((p) => (
              <option key={p} value={p}>
                {ROTA_PAY_PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        // Keep the restaurant's previous choice when it is switched back to default.
        <input type="hidden" name="rota_pay_period" value={defaultPeriod} />
      )}
    </div>
  );
}
