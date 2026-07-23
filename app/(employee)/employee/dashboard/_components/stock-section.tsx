import Link from "next/link";
import { Boxes, AlertTriangle, TriangleAlert, ArrowRight } from "lucide-react";
import { getStockSummary } from "@/app/actions/stock";
import { accentOf } from "@/lib/section-colors";

const rupee = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * Stock, as a summary on the staff dashboard.
 *
 * A card, not the whole StockClient: a storekeeper glances at what's low or out and taps
 * through to the full page (`/employee/stock`) to actually work. Everything here comes
 * from `getStockSummary`, which is already gated on `canViewStock` — a read-only viewer
 * sees the same numbers; the write controls only exist on the full page, behind
 * `canManage`.
 *
 * The section is only mounted when the caller can view stock (see the dashboard page), so
 * there is no permission check to repeat here.
 */
export async function StockSection() {
  const s = await getStockSummary();
  // No dedicated stock accent in the palette; accentOf() falls back to neutral ink.
  const accent = accentOf("stock");

  const tiles: { label: string; value: string; tone: string; Icon: typeof Boxes }[] = [
    { label: "Products", value: String(s.productCount), tone: "var(--color-ink)", Icon: Boxes },
    { label: "Low stock", value: String(s.lowCount), tone: "var(--color-warning)", Icon: AlertTriangle },
    { label: "Out of stock", value: String(s.outCount), tone: "var(--color-ruby)", Icon: TriangleAlert },
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

      <div
        className="flex items-baseline justify-between rounded-lg px-3 py-2"
        style={{ background: "var(--color-canvas-soft)" }}
      >
        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Inventory value
        </span>
        <span className="text-sm tabular font-medium" style={{ color: "var(--color-ink)" }}>
          {rupee(s.inventoryValue)}
        </span>
      </div>

      {s.unlinkedMenuItems > 0 && (
        <p className="text-xs" style={{ color: "var(--color-warning)" }}>
          {s.unlinkedMenuItems} menu item{s.unlinkedMenuItems === 1 ? "" : "s"} deduct no stock —
          link them to a product.
        </p>
      )}

      <Link
        href="/employee/stock"
        className="inline-flex items-center justify-center gap-1.5 rounded-pill py-2 text-sm font-medium transition-colors"
        style={{ background: accent.soft, color: accent.color }}
      >
        Open stock <ArrowRight size={14} />
      </Link>
    </div>
  );
}
