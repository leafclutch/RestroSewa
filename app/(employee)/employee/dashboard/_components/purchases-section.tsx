import Link from "next/link";
import { ShoppingCart, Coins, Clock, ArrowRight } from "lucide-react";
import { getPurchaseSummary } from "@/app/actions/purchases";
import { accentOf } from "@/lib/section-colors";

const rupee = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * Purchases, as a summary on the staff dashboard.
 *
 * A card, not the whole PurchasesClient: a purchaser glances at today's spend and taps
 * through to the full page (`/employee/purchases`) to record a bill. `getPurchaseSummary`
 * is already gated on `canViewPurchases`; the section is only mounted for staff who can
 * see purchases, and the full page enforces `manage_purchases` for writes.
 */
export async function PurchasesSection() {
  const s = await getPurchaseSummary();
  const accent = accentOf("purchases");

  const tiles: { label: string; value: string; tone: string; Icon: typeof ShoppingCart }[] = [
    { label: "Today", value: String(s.purchaseCount), tone: "var(--color-ink)", Icon: ShoppingCart },
    { label: "Spent today", value: rupee(s.totalPurchases), tone: "var(--color-ink)", Icon: Coins },
    { label: "On credit", value: rupee(s.creditPurchases), tone: "var(--color-warning)", Icon: Clock },
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
            <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--color-ink-mute)" }}>
              <t.Icon size={12} style={{ color: t.tone }} /> {t.label}
            </span>
            <span className="text-lg tabular font-medium" style={{ color: t.tone }}>
              {t.value}
            </span>
          </div>
        ))}
      </div>

      <Link
        href="/employee/purchases"
        className="inline-flex items-center justify-center gap-1.5 rounded-pill py-2 text-sm font-medium transition-colors"
        style={{ background: accent.soft, color: accent.color }}
      >
        Open purchases <ArrowRight size={14} />
      </Link>
    </div>
  );
}
