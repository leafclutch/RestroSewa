"use client";

// The advance-payment fields, shared by the check-in modal and the folio's "add advance"
// form. One component, because the two places must agree on what a valid deposit is —
// using the shared PaymentMethodPicker so payment options (Cash, Online, Card, Mixed)
// and split validation match the rest of the application.
//
// It renders form INPUTS with fixed names (advance_amount, advance_method, advance_cash,
// advance_online, advance_note) and is submitted by the parent's <form>. The server
// re-derives the split from these regardless — see `resolveAdvanceSplit` in
// app/actions/rooms.ts. Nothing here is a security boundary.

import { useState } from "react";
import { PaymentMethodPicker, splitIsValid } from "@/components/ui/payment-method-picker";

export const ADVANCE_METHODS = [
  { key: "cash" as const, label: "Cash" },
  { key: "online" as const, label: "Online" },
  { key: "card" as const, label: "Card" },
  { key: "mixed" as const, label: "Cash + Online" },
];

export type AdvanceMethod = "cash" | "online" | "card" | "mixed";

export function AdvanceFields({
  /** "optional" on check-in (blank writes nothing); "required" on the folio's own form. */
  mode,
  onValidChange,
}: {
  mode: "optional" | "required";
  /** Lets the parent disable its submit button while the split doesn't add up. */
  onValidChange?: (valid: boolean) => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<AdvanceMethod>("cash");
  const [cash, setCash] = useState("");
  const [online, setOnline] = useState("");

  const amountNum = parseFloat(amount) || 0;

  function handleAmount(v: string) {
    setAmount(v);
    setCash("");
    setOnline("");
  }

  const mixedOk = method !== "mixed" || amountNum === 0 || splitIsValid("mixed", amountNum, cash, online);
  const valid = (mode === "optional" ? amountNum >= 0 : amountNum > 0) && mixedOk;

  // Report validity during render rather than in an effect: the parent only needs it to
  // disable a button, and an effect would leave the button briefly wrong on first paint.
  const [lastReported, setLastReported] = useState<boolean | null>(null);
  if (onValidChange && lastReported !== valid) {
    setLastReported(valid);
    onValidChange(valid);
  }

  const inputClass = "w-full h-10 rounded-sm border px-3 text-sm tabular";
  const inputStyle = {
    borderColor: "var(--color-hairline-input)",
    background: "var(--color-canvas)",
    color: "var(--color-ink)",
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Amount
        </label>
        <input
          name="advance_amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => handleAmount(e.target.value)}
          placeholder="0.00"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      {amountNum > 0 && (
        <>
          <input type="hidden" name="advance_method" value={method} />
          <input type="hidden" name="advance_cash" value={method === "mixed" ? cash : ""} />
          <input type="hidden" name="advance_online" value={method === "mixed" ? online : ""} />

          <PaymentMethodPicker
            methods={["cash", "online", "card", "mixed"]}
            value={method}
            onChange={(m) => {
              setMethod(m as AdvanceMethod);
              setCash("");
              setOnline("");
            }}
            total={amountNum}
            cash={cash}
            online={online}
            onSplitChange={(s) => {
              setCash(s.cash);
              setOnline(s.online);
            }}
            mixedLabel="Cash + Online"
          />

          <input
            name="advance_note"
            placeholder="Note (optional)"
            autoComplete="off"
            className="w-full h-10 rounded-sm border px-3 text-sm"
            style={inputStyle}
          />
        </>
      )}
    </div>
  );
}
