"use client";

import { useState } from "react";
import { CalendarDays, Wallet } from "lucide-react";
import type { RotaPayrollSheet, RotaWeek } from "@/lib/rota";
import { RotaBoard } from "./rota-board";
import { RotaPayroll } from "./rota-payroll";

// Advanced payout: the rota and the wages it produces, side by side as two tabs.
// Replaces the monthly PayrollClient for restaurants on rota payout.

type Tab = "rota" | "pay";

export function RotaPayout({
  week,
  sheet,
  canManage,
}: {
  week: RotaWeek;
  sheet: RotaPayrollSheet;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<Tab>("rota");

  const tabs: { id: Tab; label: string; Icon: typeof Wallet }[] = [
    { id: "rota", label: "Rota", Icon: CalendarDays },
    { id: "pay", label: "Wages", Icon: Wallet },
  ];

  return (
    <section className="mt-10 flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2
            className="text-lg"
            style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.3px" }}
          >
            Rota & Payroll
          </h2>
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            Advanced payout — shifts and hourly wages.
          </p>
        </div>

        <div
          className="inline-flex rounded-lg p-0.5"
          role="tablist"
          style={{ background: "var(--color-canvas-soft)", border: "1px solid var(--color-hairline)" }}
        >
          {tabs.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors"
                style={{
                  background: active ? "var(--color-canvas)" : "transparent",
                  color: active ? "var(--color-ink)" : "var(--color-ink-mute)",
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                }}
              >
                <Icon size={14} strokeWidth={1.5} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Both stay mounted so switching tabs keeps the week/period you were on. */}
      <div hidden={tab !== "rota"}>
        <RotaBoard initial={week} canManage={canManage} />
      </div>
      <div hidden={tab !== "pay"}>
        <RotaPayroll initial={sheet} canManage={canManage} />
      </div>
    </section>
  );
}
