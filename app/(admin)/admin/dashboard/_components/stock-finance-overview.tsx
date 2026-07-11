import Link from "next/link";
import type { DashboardAnalytics } from "@/app/actions/analytics";
import {
  Boxes,
  TrendingUp,
  ShoppingCart,
  Coins,
  HandCoins,
  Truck,
  TriangleAlert,
  PackageX,
} from "lucide-react";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  mixed: "Cash + Online",
  credit: "Credit",
  upi: "UPI",
  other: "Other",
};

function Card({
  label,
  value,
  hint,
  href,
  icon: Icon,
  tone,
  hintTone,
}: {
  label: string;
  value: string;
  hint?: string;
  href: string;
  icon: React.ElementType;
  tone?: string;
  hintTone?: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border px-4 py-3.5 flex items-start gap-3 transition-colors"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "var(--color-canvas-soft)" }}
      >
        <Icon size={16} strokeWidth={1.6} style={{ color: tone ?? "var(--color-primary)" }} />
      </div>
      <div className="min-w-0">
        <p
          className="text-lg tabular-nums"
          style={{ color: tone ?? "var(--color-ink)", fontWeight: 400, letterSpacing: "-0.3px" }}
        >
          {value}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{label}</p>
        {hint && (
          <p className="text-[11px] mt-0.5" style={{ color: hintTone ?? "var(--color-ink-mute)" }}>
            {hint}
          </p>
        )}
      </div>
    </Link>
  );
}

export function StockFinanceOverview({ data }: { data: DashboardAnalytics }) {
  const { stats, canSeeMoney, recentPurchases, recentSales } = data;
  if (!stats) return null;

  // How much of today's revenue we actually know the cost of. Anything above it
  // earned revenue with no cost, so "profit" is optimistic by that much — say so
  // rather than letting the number be read as gospel.
  const untracked = Math.max(0, stats.salesToday - stats.trackedRevenue);
  const profitHint =
    stats.salesToday === 0
      ? "No sales yet today"
      : untracked > 0.5
      ? `${money(untracked)} of sales have no cost data`
      : "Cost known for all of today's sales";

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <p
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Stock &amp; Finance
        </p>
        <Link href="/admin/stock" className="text-xs" style={{ color: "var(--color-primary)" }}>
          Manage →
        </Link>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <Card
          label="Inventory value"
          value={money(stats.inventoryValue)}
          hint={`${stats.productCount} product${stats.productCount !== 1 ? "s" : ""}`}
          href="/admin/stock"
          icon={Boxes}
        />

        {canSeeMoney && (
          <>
            <Card
              label="Today's sales"
              value={money(stats.salesToday)}
              hint="Billed, credit included"
              href="/admin/finance"
              icon={TrendingUp}
              tone="#1a7a4a"
            />
            <Card
              label="Today's purchases"
              value={money(stats.purchasesToday)}
              hint="Cash, online & credit"
              href="/admin/purchases"
              icon={ShoppingCart}
            />
            <Card
              label="Today's profit (est.)"
              value={money(stats.estimatedProfit)}
              hint={profitHint}
              hintTone={untracked > 0.5 ? "#9a3412" : undefined}
              href="/admin/finance"
              icon={Coins}
              tone={stats.estimatedProfit >= 0 ? "#1a7a4a" : "#dc2626"}
            />
            <Card
              label="Customers owe us"
              value={money(stats.customerCreditOutstanding)}
              hint="Outstanding customer credit"
              href="/admin/finance"
              icon={HandCoins}
              tone={stats.customerCreditOutstanding > 0 ? "#dc2626" : undefined}
            />
            <Card
              label="We owe vendors"
              value={money(stats.vendorCreditOutstanding)}
              hint="Outstanding vendor credit"
              href="/admin/vendors"
              icon={Truck}
              tone={stats.vendorCreditOutstanding > 0 ? "#dc2626" : undefined}
            />
          </>
        )}

        <Card
          label="Low stock items"
          value={String(stats.lowCount)}
          hint={stats.lowCount > 0 ? "Running out soon" : "Nothing running low"}
          href="/admin/stock"
          icon={TriangleAlert}
          tone={stats.lowCount > 0 ? "#f97316" : undefined}
        />
        <Card
          label="Out of stock"
          value={String(stats.outCount)}
          hint={stats.outCount > 0 ? "Reorder now" : "Everything in stock"}
          href="/admin/stock"
          icon={PackageX}
          tone={stats.outCount > 0 ? "#dc2626" : undefined}
        />
      </div>

      {/* Recent activity */}
      <div className="grid gap-4 mt-4 lg:grid-cols-2">
        <div className="rounded-xl border overflow-hidden" style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}>
          <div
            className="flex items-center justify-between px-4 py-2.5 border-b"
            style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
          >
            <p className="text-xs uppercase tracking-wide font-medium" style={{ color: "var(--color-ink)", letterSpacing: "0.06em" }}>
              Recent purchases
            </p>
            <Link href="/admin/purchases" className="text-xs" style={{ color: "var(--color-primary)" }}>All →</Link>
          </div>

          {recentPurchases.length === 0 ? (
            <p className="text-sm px-4 py-6 text-center" style={{ color: "var(--color-ink-mute)" }}>
              No purchases yet.
            </p>
          ) : (
            recentPurchases.map((p, i) => (
              <div
                key={p.id}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>{p.vendor_name}</p>
                  <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                    {p.purchase_code} ·{" "}
                    {new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm tabular-nums" style={{ color: "var(--color-ink)" }}>{money(p.total_amount)}</p>
                  <p
                    className="text-[10px] uppercase tracking-wide"
                    style={{ color: p.credit_amount > 0 ? "#f97316" : "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                  >
                    {p.credit_amount > 0 ? "On credit" : METHOD_LABEL[p.method] ?? p.method}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {canSeeMoney && (
          <div className="rounded-xl border overflow-hidden" style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}>
            <div
              className="flex items-center justify-between px-4 py-2.5 border-b"
              style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
            >
              <p className="text-xs uppercase tracking-wide font-medium" style={{ color: "var(--color-ink)", letterSpacing: "0.06em" }}>
                Recent sales
              </p>
              <Link href="/admin/finance" className="text-xs" style={{ color: "var(--color-primary)" }}>Report →</Link>
            </div>

            {recentSales.length === 0 ? (
              <p className="text-sm px-4 py-6 text-center" style={{ color: "var(--color-ink-mute)" }}>
                No sales yet.
              </p>
            ) : (
              recentSales.map((s, i) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>{s.location}</p>
                    <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                      {new Date(s.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm tabular-nums" style={{ color: "var(--color-ink)" }}>{money(s.amount)}</p>
                    <p
                      className="text-[10px] uppercase tracking-wide"
                      style={{ color: s.onCredit ? "#f97316" : "#1a7a4a", letterSpacing: "0.06em" }}
                    >
                      {s.onCredit ? "On credit" : METHOD_LABEL[s.method] ?? s.method}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
