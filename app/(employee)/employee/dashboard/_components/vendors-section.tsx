import Link from "next/link";
import { Truck, Wallet, Users, ArrowRight } from "lucide-react";
import { getVendorSummary } from "@/app/actions/vendors";
import { accentOf } from "@/lib/section-colors";

const rupee = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * Vendors, as a summary on the staff dashboard.
 *
 * A card, not the whole VendorsClient: a glance at how many suppliers there are and what
 * we still owe them, then tap through to the full page (`/employee/vendors`) to add one or
 * record a payment. `getVendorSummary` is already gated on `canViewVendors`; the section is
 * only mounted for staff who can see vendors, and the full page enforces `manage_vendors`.
 */
export async function VendorsSection() {
  const s = await getVendorSummary();
  const accent = accentOf("vendors");

  const tiles: { label: string; value: string; tone: string; Icon: typeof Truck }[] = [
    { label: "Vendors", value: String(s.activeCount), tone: "var(--color-ink)", Icon: Users },
    { label: "We owe", value: rupee(s.outstanding), tone: s.outstanding > 0 ? "var(--color-ruby)" : "var(--color-ink)", Icon: Wallet },
    { label: "Owed vendors", value: String(s.owingCount), tone: "var(--color-warning)", Icon: Truck },
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
        href="/employee/vendors"
        className="inline-flex items-center justify-center gap-1.5 rounded-pill py-2 text-sm font-medium transition-colors"
        style={{ background: accent.soft, color: accent.color }}
      >
        Open vendors <ArrowRight size={14} />
      </Link>
    </div>
  );
}
