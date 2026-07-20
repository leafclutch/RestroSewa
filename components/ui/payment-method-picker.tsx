"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

// Every payment screen used to hand-roll its own method pills, and only billing
// ever grew a working mixed-payment panel (auto-complement, sum validation,
// inline confirmation). The others were left with cash-or-online radio buttons.
//
// This is that billing panel, extracted — so adding "Mixed" to a screen means
// reusing the one implementation that has already been through a cashier's
// hands, rather than writing a second set of rounding bugs.

export type PaymentMethod = "cash" | "online" | "card" | "mixed" | "credit";

const LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  mixed: "Mixed",
  credit: "Credit",
};

/** Two decimal places, and never `-0`. */
const round2 = (n: number) => Math.round(n * 100) / 100 || 0;

export function PaymentMethodPicker({
  methods,
  value,
  onChange,
  total,
  cash,
  online,
  onSplitChange,
  disabled,
  mixedLabel = "Cash + Online",
}: {
  /** Which methods this screen actually supports, in display order. */
  methods: PaymentMethod[];
  value: PaymentMethod;
  onChange: (m: PaymentMethod) => void;
  /** The amount the split must add up to. */
  total: number;
  cash: string;
  online: string;
  onSplitChange: (next: { cash: string; online: string }) => void;
  disabled?: boolean;
  mixedLabel?: string;
}) {
  const cashNum = parseFloat(cash) || 0;
  const onlineNum = parseFloat(online) || 0;
  const bothFilled = cash !== "" && online !== "";
  const valid = Math.abs(cashNum + onlineNum - total) < 0.01;

  // Typing one side fills the other. A cashier splitting ₹2,000 knows one of the
  // two numbers, never both — making them do the subtraction is how a ₹1 gap
  // ends up in the books.
  const setCash = (v: string) => {
    const n = parseFloat(v);
    onSplitChange({ cash: v, online: v === "" || isNaN(n) ? "" : String(round2(total - n)) });
  };
  const setOnline = (v: string) => {
    const n = parseFloat(v);
    onSplitChange({ cash: v === "" || isNaN(n) ? "" : String(round2(total - n)), online: v });
  };

  // If the total moves (a discount applied, a different bill selected) a split
  // typed against the OLD total is silently wrong — so clear it.
  useEffect(() => {
    if (value === "mixed" && bothFilled && !valid) onSplitChange({ cash: "", online: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {methods.map((m) => {
          const active = value === m;
          return (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => onChange(m)}
              className="text-sm px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
              style={{
                borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                background: active ? "var(--color-primary)" : "var(--color-canvas)",
                color: active ? "#fff" : "var(--color-ink)",
                fontWeight: active ? 500 : 400,
              }}
            >
              {m === "mixed" ? mixedLabel : LABEL[m]}
            </button>
          );
        })}
      </div>

      {value === "mixed" && (
        <div className="flex flex-col gap-3">
          {(["cash", "online"] as const).map((side) => (
            <div key={side} className="flex flex-col gap-1.5">
              <label
                htmlFor={`pmp_${side}`}
                className="text-xs uppercase tracking-wide"
                style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
              >
                {side === "cash" ? "Cash amount (₹)" : "Online amount (₹)"}
              </label>
              <div className="relative">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none"
                  style={{ color: "var(--color-ink-mute)" }}
                >
                  ₹
                </span>
                <Input
                  id={`pmp_${side}`}
                  type="number"
                  min="0"
                  max={total}
                  step="0.01"
                  placeholder="0.00"
                  disabled={disabled}
                  value={side === "cash" ? cash : online}
                  onChange={(e) => (side === "cash" ? setCash : setOnline)(e.target.value)}
                  className="pl-7"
                />
              </div>
            </div>
          ))}

          {bothFilled && !valid && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
              Cash and Online together must equal ₹{total.toFixed(2)}.
            </p>
          )}
          {bothFilled && valid && (
            <p className="text-xs" style={{ color: "var(--color-success)" }}>
              ✓ Amounts match
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Whether the current selection is submittable.
 *
 * Exported so a screen's submit button and its server action agree on what
 * "valid" means — the server re-checks regardless (the DB has a CHECK
 * constraint), but the button should not offer to do something that will bounce.
 */
export function splitIsValid(method: PaymentMethod, total: number, cash: string, online: string): boolean {
  if (method !== "mixed") return true;
  if (cash === "" || online === "") return false;
  const c = parseFloat(cash);
  const o = parseFloat(online);
  if (isNaN(c) || isNaN(o) || c < 0 || o < 0) return false;
  return Math.abs(c + o - total) < 0.01;
}
