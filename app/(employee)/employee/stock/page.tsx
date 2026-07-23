import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import {
  getLinkTargets,
  getProductOptions,
  getStock,
  getStockSummary,
} from "@/app/actions/stock";
import { StockClient } from "@/app/(admin)/admin/stock/_components/stock-client";
import { businessToday } from "@/lib/business-day";

// The staff-surface Stock page. It renders the SAME StockClient the admin surface uses —
// there is no second stock UI to keep in step — but on the employee chrome, so a
// storekeeper who reaches it from the dashboard never lands in the admin sidebar.
//
// Viewing needs view_stock or manage_stock; every write action inside re-checks
// manage_stock server-side, and canManage below hides the write controls for a read-only
// viewer. Same guard, same actions as the admin page.
export default async function EmployeeStockPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewStock(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [stock, summary, products, targets] = await Promise.all([
    getStock({ filter: "all" }),
    getStockSummary(),
    getProductOptions(),
    getLinkTargets(),
  ]);

  return (
    <div className="p-4 sm:p-5 max-w-3xl mx-auto">
      <Link
        href="/employee/dashboard"
        className="inline-flex items-center gap-1 text-sm mb-4"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ChevronLeft size={14} />
        Dashboard
      </Link>

      <StockClient
        initialStock={stock}
        initialSummary={summary}
        products={products}
        targets={targets}
        today={businessToday(restaurantUser.closingHour)}
        canManage={STOCK_ACCESS.canManageStock(restaurantUser)}
      />
    </div>
  );
}
