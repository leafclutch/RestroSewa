import Link from "next/link";
import { Users, Wallet, CircleAlert, ArrowRight } from "lucide-react";
import { getPayrollSheet } from "@/app/actions/payroll";
import { accentOf } from "@/lib/section-colors";

const rupee = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * Payroll, as a summary on the staff dashboard.
 *
 * This month's sheet at a glance — who is on payroll, what has been paid, what is
 * still owed — then tap through to `/employee/payroll` to record a payment.
 *
 * `getPayrollSheet` is gated on `canViewPayroll` and computes the totals itself,
 * so nothing is re-derived here. Note the SECTION is mounted only for
 * `manage_payroll` (see dashboard/page.tsx) while the PAGE opens on either
 * payroll right — the dashboard is the tighter of the two on purpose: it puts
 * colleagues' salaries on a screen people leave open at the counter.
 */
export async function PayrollSection() {
  const sheet = await getPayrollSheet();
  const accent = accentOf("payroll");

  const month = new Date(sheet.month).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const tiles: { label: string; value: string; tone: string; Icon: typeof Users }[] = [
    { label: "On payroll", value: String(sheet.rows.length), tone: "var(--color-ink)", Icon: Users },
    { label: "Paid", value: rupee(sheet.totalPaid), tone: "var(--color-ink)", Icon: Wallet },
    {
      label: "Remaining",
      value: rupee(sheet.totalRemaining),
      tone: sheet.totalRemaining > 0 ? "var(--color-warning)" : "var(--color-success)",
      Icon: CircleAlert,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))" }}
      >
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-xl border px-3 py-2.5 flex flex-col gap-0.5"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
          >
            <span
              className="inline-flex items-center gap-1 text-xs"
              style={{ color: "var(--color-ink-mute)" }}
            >
              <t.Icon size={12} style={{ color: t.tone }} /> {t.label}
            </span>
            <span className="text-lg tabular font-medium" style={{ color: t.tone }}>
              {t.value}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        {month}
        {sheet.notOnPayroll.length > 0 &&
          ` · ${sheet.notOnPayroll.length} staff with no salary set`}
      </p>

      <Link
        href="/employee/payroll"
        className="inline-flex items-center justify-center gap-1.5 rounded-pill py-2 text-sm font-medium transition-colors"
        style={{ background: accent.soft, color: accent.color }}
      >
        Open payroll <ArrowRight size={14} />
      </Link>
    </div>
  );
}
