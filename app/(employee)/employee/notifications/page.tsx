import { requireRestaurantStaff } from "@/lib/auth/guards";
import {
  getActiveNotifications,
  acknowledgeNotification,
  completeNotification,
} from "@/app/actions/notifications";
import { approveTableActivation, rejectTableActivation } from "@/app/actions/pos";
import type { NotificationRow } from "@/app/actions/notifications";
import { Bell, UtensilsCrossed, Check, CheckCheck, DoorOpen, X } from "lucide-react";
import { PushToggle } from "@/components/pwa/push-toggle";
import { NotificationPreferences } from "@/components/pwa/notification-preferences";
import { getMutedCategories } from "@/app/actions/push";

const TYPE_CONFIG = {
  call_waiter:  { label: "Call Waiter",   Icon: Bell,            color: "#6366f1" },
  request_bill: { label: "Request Bill",  Icon: UtensilsCrossed, color: "#f97316" },
  table_activation_request: { label: "Table Activation Request", Icon: DoorOpen, color: "#0891b2" },
} as const;

const rupee = (n: number) => `₹${n.toFixed(0)}`;

function timeSince(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// A no-PIN table activation request: the customer has placed an order but the
// table is NOT active yet. Staff review the order and Accept (activate + send to
// kitchen) or Reject (keep the table free).
function ActivationCard({ n }: { n: NotificationRow }) {
  const cfg = TYPE_CONFIG.table_activation_request;
  const where = n.table_number ? `Table ${n.table_number}` : n.room_number ? `Room ${n.room_number}` : "Walk-in";
  const items = n.order_summary ?? [];

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: cfg.color + "08", borderColor: cfg.color + "44" }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: cfg.color + "15" }}>
          <cfg.Icon size={16} style={{ color: cfg.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {cfg.label}
            <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-ink-mute)" }}>{where}</span>
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{timeSince(n.created_at)} · awaiting your approval</p>
        </div>
      </div>

      {items.length > 0 && (
        <div className="px-4 pb-2">
          <div className="rounded-lg px-3 py-2" style={{ background: "var(--color-canvas)" }}>
            {items.map((it, i) => (
              <div key={i} className="flex items-center justify-between py-0.5 text-sm">
                <span style={{ color: "var(--color-ink)" }}>
                  <span className="text-xs mr-1" style={{ color: "var(--color-ink-mute)" }}>×{it.quantity}</span>
                  {it.name}
                </span>
                <span className="tabular" style={{ color: "var(--color-ink-mute)" }}>{rupee(it.price * it.quantity)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1.5 mt-1 border-t text-sm font-medium" style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}>
              <span>Total</span>
              <span className="tabular">{rupee(n.order_total ?? 0)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-3">
        <form
          className="flex-1"
          action={async () => {
            "use server";
            await rejectTableActivation(n.id);
          }}
        >
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium border"
            style={{ background: "var(--color-canvas)", color: "#dc2626", borderColor: "#dc262644" }}
          >
            <X size={13} /> Reject
          </button>
        </form>
        <form
          className="flex-1"
          action={async () => {
            "use server";
            await approveTableActivation(n.id);
          }}
        >
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium"
            style={{ background: cfg.color, color: "#fff" }}
          >
            <Check size={13} /> Accept &amp; Activate
          </button>
        </form>
      </div>
    </div>
  );
}

function NotifCard({ n }: { n: NotificationRow }) {
  if (n.type === "table_activation_request") return <ActivationCard n={n} />;
  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.call_waiter;
  const isNew = n.status === "new";

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-xl border"
      style={{
        background: isNew ? cfg.color + "08" : "var(--color-canvas)",
        borderColor: isNew ? cfg.color + "44" : "var(--color-hairline)",
      }}
    >
      {/* Icon */}
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: cfg.color + "15" }}
      >
        <cfg.Icon size={16} style={{ color: cfg.color }} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {cfg.label}
          {n.table_number && (
            <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-ink-mute)" }}>
              Table {n.table_number}
            </span>
          )}
          {!n.table_number && n.room_number && (
            <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-ink-mute)" }}>
              Room {n.room_number}
            </span>
          )}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
          {timeSince(n.created_at)}
          {n.status === "acknowledged" && " · Acknowledged"}
        </p>
      </div>

      {/* Actions */}
      {isNew && (
        <form
          action={async () => {
            "use server";
            await acknowledgeNotification(n.id);
          }}
        >
          <button
            type="submit"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: cfg.color, color: "#fff" }}
          >
            <Check size={12} />
            Accept
          </button>
        </form>
      )}

      {n.status === "acknowledged" && (
        <form
          action={async () => {
            "use server";
            await completeNotification(n.id);
          }}
        >
          <button
            type="submit"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: "#1a7a4a", color: "#fff" }}
          >
            <CheckCheck size={12} />
            Done
          </button>
        </form>
      )}
    </div>
  );
}

export default async function NotificationsPage() {
  const { restaurantUser } = await requireRestaurantStaff();
  const notifications = await getActiveNotifications(restaurantUser.restaurant_id, restaurantUser);
  const muted = await getMutedCategories();

  const newNotifs = notifications.filter((n) => n.status === "new");
  const ackNotifs = notifications.filter((n) => n.status === "acknowledged");

  return (
    <div className="p-4 sm:p-5 max-w-lg mx-auto">
      <h1
        className="text-xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Notifications
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-mute)" }}>
        {notifications.length === 0
          ? "All clear — no pending notifications."
          : `${newNotifs.length} new · ${ackNotifs.length} acknowledged`}
      </p>

      {/* Per-DEVICE, not per-account: a waiter who works from a phone and a till has
          to switch it on in both places, because a push subscription belongs to a
          browser. It hides itself where push cannot work at all. */}
      <PushToggle />

      {/* Per-ACCOUNT, unlike the toggle above: muting Finance means you meant it, and
          shouldn't have to mean it again on every device you sign in to. */}
      <NotificationPreferences muted={muted} />

      {notifications.length === 0 && (
        <div
          className="rounded-xl border px-6 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No pending notifications.
          </p>
        </div>
      )}

      {newNotifs.length > 0 && (
        <section className="mb-6">
          <p
            className="text-xs uppercase tracking-wide mb-2 font-medium"
            style={{ color: "#6366f1", letterSpacing: "0.06em" }}
          >
            New
          </p>
          <div className="flex flex-col gap-2">
            {newNotifs.map((n) => <NotifCard key={n.id} n={n} />)}
          </div>
        </section>
      )}

      {ackNotifs.length > 0 && (
        <section>
          <p
            className="text-xs uppercase tracking-wide mb-2 font-medium"
            style={{ color: "#f97316", letterSpacing: "0.06em" }}
          >
            Acknowledged
          </p>
          <div className="flex flex-col gap-2">
            {ackNotifs.map((n) => <NotifCard key={n.id} n={n} />)}
          </div>
        </section>
      )}
    </div>
  );
}
