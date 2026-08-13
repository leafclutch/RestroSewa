import Link from "next/link";
import { Receipt, Banknote, Landmark, PiggyBank, ArrowRight } from "lucide-react";
import { getExpenseSummary } from "@/app/actions/expenses";
import { accentOf } from "@/lib/section-colors";

const rupee = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * Extra Expenses, as a summary on the staff dashboard.
 *
 * A card, not the whole ExpensesClient: what went out today and how it was paid,
 * then tap through to `/employee/expenses` to file one. Follows VendorsSection.
 *
 * `getExpenseSummary` is permission-aware, so the add-only holder's payload
 * simply has no savings figure in it — the tile below is skipped rather than
 * rendering a zero, which would read as "the pots are empty" rather than
 * "you may not see this".
 */
export async function ExpensesSection() {
  const s = await getExpenseSummary();
  const accent = accentOf("expenses");

  const tiles: { label: string; value: string; tone: string; Icon: typeof Receipt }[] = [
    {
      label: "Today",
      value: rupee(s.todayTotal),
      tone: s.todayTotal > 0 ? "var(--color-ruby)" : "var(--color-ink)",
      Icon: Receipt,
    },
    { label: "Cash", value: rupee(s.todayCash), tone: "var(--color-ink)", Icon: Banknote },
    { label: "Online", value: rupee(s.todayOnline), tone: "var(--color-ink)", Icon: Landmark },
  ];

  if (s.savingsHeld !== null) {
    tiles.push({
      label: "Saved",
      value: rupee(s.savingsHeld),
      tone: "var(--color-success)",
      Icon: PiggyBank,
    });
  }

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
        {s.todayCount === 0
          ? "Nothing recorded today."
          : `${s.todayCount} ${s.todayCount === 1 ? "entry" : "entries"} today.`}
      </p>

      <Link
        href="/employee/expenses"
        className="inline-flex items-center justify-center gap-1.5 rounded-pill py-2 text-sm font-medium transition-colors"
        style={{ background: accent.soft, color: accent.color }}
      >
        Open expenses <ArrowRight size={14} />
      </Link>
    </div>
  );
}
