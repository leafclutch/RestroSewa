import { requireRestaurantStaff } from "@/lib/auth/guards";
import { getMyOrders, updateOrderItemStatus } from "@/app/actions/pos";
import type { QueueItem } from "@/app/actions/pos";

function QueueCard({ item }: { item: QueueItem }) {
  const isReady = item.item_status === "ready";
  const label = item.table_number
    ? `T${item.table_number}`
    : item.room_number
    ? `R${item.room_number}`
    : item.session_type === "walk_in"
    ? "WI"
    : "—";

  return (
    <div
      className="rounded-xl border px-4 py-3 flex items-center gap-3"
      style={{
        background: isReady ? "#f0fdf4" : "var(--color-canvas)",
        borderColor: isReady ? "#1a7a4a44" : "var(--color-hairline)",
      }}
    >
      {/* Table tag */}
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-medium shrink-0"
        style={{
          background: isReady ? "#dcfce7" : "var(--color-canvas-soft)",
          color: isReady ? "#1a7a4a" : "var(--color-ink-mute)",
        }}
      >
        {label}
      </div>

      {/* Item info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {item.quantity > 1 && (
            <span className="mr-1 text-xs" style={{ color: "var(--color-ink-mute)" }}>
              ×{item.quantity}
            </span>
          )}
          {item.item_name}
        </p>
        {item.workstation_name && (
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            {item.workstation_name}
          </p>
        )}
        {item.notes && (
          <p className="text-xs italic" style={{ color: "var(--color-ink-mute)" }}>
            {item.notes}
          </p>
        )}
      </div>

      {/* Mark ready / served */}
      {!isReady ? (
        <form
          action={async () => {
            "use server";
            await updateOrderItemStatus(item.id, "ready");
          }}
        >
          <button
            type="submit"
            className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: "#f97316", color: "#fff" }}
          >
            Mark ready
          </button>
        </form>
      ) : (
        <form
          action={async () => {
            "use server";
            await updateOrderItemStatus(item.id, "served");
          }}
        >
          <button
            type="submit"
            className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: "#1a7a4a", color: "#fff" }}
          >
            Served
          </button>
        </form>
      )}
    </div>
  );
}

export default async function OrdersPage() {
  const { restaurantUser } = await requireRestaurantStaff();
  const items = await getMyOrders(restaurantUser.id, restaurantUser.restaurant_id);

  const pending = items.filter((i) => i.item_status === "pending");
  const ready = items.filter((i) => i.item_status === "ready");

  return (
    <div className="p-5 max-w-lg">
      <h1
        className="text-xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Orders
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-mute)" }}>
        {items.length === 0 ? "All clear." : `${pending.length} pending · ${ready.length} ready`}
      </p>

      {items.length === 0 && (
        <div
          className="rounded-xl border px-6 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>No pending items.</p>
        </div>
      )}

      {ready.length > 0 && (
        <section className="mb-6">
          <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "#1a7a4a", letterSpacing: "0.06em" }}>
            Ready to serve
          </p>
          <div className="flex flex-col gap-2">
            {ready.map((i) => <QueueCard key={i.id} item={i} />)}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "#f97316", letterSpacing: "0.06em" }}>
            Pending
          </p>
          <div className="flex flex-col gap-2">
            {pending.map((i) => <QueueCard key={i.id} item={i} />)}
          </div>
        </section>
      )}
    </div>
  );
}
