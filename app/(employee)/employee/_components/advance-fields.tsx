"use client";

// The advance-payment fields, shared by the check-in modal and the folio's "add advance"
// form. One component, because the two places must agree on what a valid deposit is —
// the auto-filling Cash + Online split especially, which the checkout screen also uses
// and which a second copy would eventually drift away from.
//
// It renders form INPUTS with fixed names (advance_amount, advance_method, advance_cash,
// advance_online, advance_note) and is submitted by the parent's <form>. The server
// re-derives the split from these regardless — see `resolveAdvanceSplit` in
// app/actions/rooms.ts. Nothing here is a security boundary.

import { useState } from "react";

export const ADVANCE_METHODS = [
  { key: "cash" as const, label: "Cash" },
  { key: "online" as const, label: "Online" },
  { key: "card" as const, label: "Card" },
  { key: "mixed" as const, label: "Cash + Online" },
];

export type AdvanceMethod = (typeof ADVANCE_METHODS)[number]["key"];

const rupee = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

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
  const cashNum = parseFloat(cash) || 0;
  const onlineNum = parseFloat(online) || 0;

  // Typing one half fills the other, so the two always total the deposit — the same
  // behaviour the checkout split has.
  function handleCash(v: string) {
    setCash(v);
    const n = parseFloat(v);
    setOnline(
      !isNaN(n) && n >= 0 ? Math.max(0, Math.round((amountNum - n) * 100) / 100).toFixed(2) : ""
    );
  }
  function handleOnline(v: string) {
    setOnline(v);
    const n = parseFloat(v);
    setCash(
      !isNaN(n) && n >= 0 ? Math.max(0, Math.round((amountNum - n) * 100) / 100).toFixed(2) : ""
    );
  }

  // A new amount strands any split typed against the old one — clear it rather than
  // submit a pair that no longer adds up.
  function handleAmount(v: string) {
    setAmount(v);
    setCash("");
    setOnline("");
  }

  const mixedOk =
    method !== "mixed" ||
    amountNum === 0 ||
    (cash !== "" && online !== "" && Math.abs(cashNum + onlineNum - amountNum) < 0.01);
  const valid = (mode === "optional" ? amountNum >= 0 : amountNum > 0) && mixedOk;

  // Report validity during render rather than in an effect: the parent only needs it to
  // disable a button, and an effect would leave the button briefly wrong on first paint.
  const [lastReported, setLastReported] = useState<boolean | null>(null);
  if (onValidChange && lastReported !== valid) {
    setLastReported(valid);
    onValidChange(valid);
  }

  const input =
    "w-full h-10 rounded-sm border px-3 text-sm tabular";
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
          className={input}
          style={inputStyle}
        />
      </div>

      {amountNum > 0 && (
        <>
          <input type="hidden" name="advance_method" value={method} />
          <div className="flex flex-wrap gap-1.5">
            {ADVANCE_METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setMethod(m.key);
                  setCash("");
                  setOnline("");
                }}
                className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                style={{
                  borderColor: method === m.key ? "var(--color-primary)" : "var(--color-hairline)",
                  background: method === m.key ? "var(--color-primary)" : "var(--color-canvas)",
                  color: method === m.key ? "#fff" : "var(--color-ink)",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {method === "mixed" && (
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Cash", "advance_cash", cash, handleCash],
                  ["Online", "advance_online", online, handleOnline],
                ] as const
              ).map(([label, name, val, set]) => (
                <div key={name}>
                  <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                    {label}
                  </label>
                  <input
                    name={name}
                    type="number"
                    min="0"
                    max={amountNum}
                    step="0.01"
                    inputMode="decimal"
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    className={input}
                    style={inputStyle}
                  />
                </div>
              ))}
              {!mixedOk && (
                <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
                  Cash and Online must add up to {rupee(amountNum)}.
                </p>
              )}
            </div>
          )}

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
