"use client";

import { useActionState, useEffect, useRef } from "react";
import { importCreditCustomer } from "@/app/actions/credits";
import type { ActionResult } from "@/app/actions/credits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Info } from "lucide-react";

/**
 * Register a debt the restaurant was already owed before it started using
 * HRestroSewa.
 *
 * It creates an ordinary credit account with an opening balance — not a special
 * "imported" kind — so the customer appears in the staff Credits screen and
 * repayments run through the same flow as any other credit. What it does NOT do
 * is write a bill: the sale happened elsewhere, and counting it here would
 * inflate this restaurant's reported revenue. The note below says so plainly,
 * because "will this show up as today's sales?" is the first thing an owner
 * typing a ₹50,000 figure will wonder.
 */
export function ImportCreditForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    importCreditCustomer,
    null
  );

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;

  return (
    <form action={action} className="flex flex-col gap-3">
      <div
        className="rounded-lg border px-3 py-2.5 flex items-start gap-2"
        style={{
          background: "var(--color-canvas-soft)",
          borderColor: "var(--color-hairline)",
        }}
      >
        <Info size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-ink-mute)" }} />
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          For money a customer already owed you <strong>before</strong> using HRestroSewa. It is
          added to Credit to Us and appears in the staff Credits screen — but it is{" "}
          <strong>not counted as a sale</strong>, because the sale didn&apos;t happen here.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ic_name" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Customer name
          </label>
          <Input id="ic_name" name="name" required placeholder="e.g. Ram Bahadur" autoComplete="off" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ic_phone" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Phone (optional)
          </label>
          <Input id="ic_phone" name="phone" placeholder="98…" inputMode="tel" autoComplete="off" />
          {/* The phone is how a returning customer is recognised, so it decides
              whether this lands on an existing account or opens a new one. */}
          <p className="text-[11px]" style={{ color: "var(--color-ink-mute)" }}>
            Used to match an existing account, so they keep one Credit ID.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ic_amount" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Amount owed (₹)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "var(--color-ink-mute)" }}>₹</span>
            <Input id="ic_amount" name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" className="pl-7" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ic_date" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Credit given on
          </label>
          <input
            id="ic_date"
            name="credit_date"
            type="date"
            required
            max={localToday}
            defaultValue={localToday}
            className="w-full text-sm rounded-lg border px-3 py-2"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
          />
          {/* Dating it correctly is what puts the debt on the right day in the
              finance report and the ledger, rather than the day it was typed. */}
          <p className="text-[11px]" style={{ color: "var(--color-ink-mute)" }}>
            The debt will show from this date.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ic_notes" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Note (optional)
        </label>
        <Input id="ic_notes" name="notes" placeholder="e.g. carried over from the old register" autoComplete="off" />
      </div>

      {state?.error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Importing…" : "Import credit"}
      </Button>
    </form>
  );
}
