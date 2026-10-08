"use client";

import type { DiscountMode } from "@/lib/billing/discount";

/** The ₹ / % switch beside a discount field — the table bill and the room checkout share it. */
export function DiscountUnitToggle({
  mode,
  onChange,
}: {
  mode: DiscountMode;
  onChange: (m: DiscountMode) => void;
}) {
  return (
    <div className="flex shrink-0 rounded-md overflow-hidden border text-sm" style={{ borderColor: "var(--color-hairline)" }}>
      {(["amount", "percent"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className="px-2.5 py-1"
          style={
            mode === m
              ? { background: "var(--color-primary)", color: "#fff" }
              : { background: "var(--color-canvas)", color: "var(--color-ink-mute)" }
          }
        >
          {m === "amount" ? "₹" : "%"}
        </button>
      ))}
    </div>
  );
}
