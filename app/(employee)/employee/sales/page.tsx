import { requireRestaurantStaff } from "@/lib/auth/guards";
import { getRecentSales } from "@/app/actions/pos";
import type { PaymentRow } from "@/app/actions/pos";

function PaymentCard({ payment }: { payment: PaymentRow }) {
  const location = payment.table_number
    ? `Table T-${payment.table_number}`
    : payment.room_number
    ? `Room ${payment.room_number}`
    : payment.session_type === "walk_in"
    ? "Walk-in"
    : "—";

  const time = new Date(payment.created_at).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const date = new Date(payment.created_at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });

  const methodLabel =
    payment.payment_method === "cash"
      ? "Cash"
      : payment.payment_method === "online"
      ? "Online"
      : `Cash + Online`;

  return (
    <div
      className="rounded-xl border px-4 py-3 flex items-center gap-3"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-medium shrink-0"
        style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
      >
        {payment.payment_method === "cash" ? "₹" : payment.payment_method === "online" ? "⬡" : "⬡₹"}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {location}
        </p>
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          {methodLabel} · {time}, {date}
        </p>
      </div>

      <p className="text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
        ₹{Number(payment.total_amount).toFixed(0)}
      </p>
    </div>
  );
}

export default async function SalesPage() {
  const { restaurantUser } = await requireRestaurantStaff();
  const payments = await getRecentSales(restaurantUser.restaurant_id);

  const todayStr = new Date().toISOString().split("T")[0];
  const todayPayments = payments.filter((p) => p.created_at.startsWith(todayStr));
  const todayTotal = todayPayments.reduce((sum, p) => sum + Number(p.total_amount), 0);
  const todayCash = todayPayments.reduce((sum, p) => sum + Number(p.cash_amount), 0);
  const todayOnline = todayPayments.reduce((sum, p) => sum + Number(p.online_amount), 0);

  return (
    <div className="p-5 max-w-lg">
      <h1
        className="text-xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Sales
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-mute)" }}>
        {todayPayments.length === 0
          ? "No sales today yet."
          : `${todayPayments.length} bill${todayPayments.length !== 1 ? "s" : ""} today`}
      </p>

      {/* Today summary */}
      {todayPayments.length > 0 && (
        <div
          className="rounded-xl border px-4 py-4 mb-6 grid grid-cols-3 gap-3"
          style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        >
          <div className="text-center">
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Total</p>
            <p className="text-lg font-medium tabular-nums" style={{ color: "var(--color-ink)", fontWeight: 500 }}>
              ₹{todayTotal.toFixed(0)}
            </p>
          </div>
          <div className="text-center border-x" style={{ borderColor: "var(--color-hairline)" }}>
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Cash</p>
            <p className="text-lg tabular-nums" style={{ color: "var(--color-ink)", fontWeight: 400 }}>
              ₹{todayCash.toFixed(0)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Online</p>
            <p className="text-lg tabular-nums" style={{ color: "var(--color-ink)", fontWeight: 400 }}>
              ₹{todayOnline.toFixed(0)}
            </p>
          </div>
        </div>
      )}

      {payments.length === 0 ? (
        <div
          className="rounded-xl border px-6 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>No payments recorded yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {payments.map((p) => (
            <PaymentCard key={p.id} payment={p} />
          ))}
        </div>
      )}
    </div>
  );
}
