"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { getMyNotifications } from "@/app/actions/notifications";
import type { NotificationRow } from "@/app/actions/notifications";
import {
  Bell,
  DoorOpen,
  LogOut,
  UtensilsCrossed,
  X,
} from "lucide-react";

const ALERT_CONFIG = {
  call_waiter: { label: "Waiter call", Icon: Bell, color: "#6366f1", href: "/employee/notifications" },
  request_bill: { label: "Bill requested", Icon: UtensilsCrossed, color: "#f97316", href: "/employee/notifications" },
  table_activation_request: { label: "Table activation request", Icon: DoorOpen, color: "#0891b2", href: "/employee/notifications" },
} as const;

const POLL_MS = 8000;

function alertText(n: NotificationRow): { label: string; color: string; href: string; Icon: React.ComponentType<{ size?: number }> } {
  const cfg = ALERT_CONFIG[n.type as keyof typeof ALERT_CONFIG] ?? ALERT_CONFIG.call_waiter;
  const where = n.table_number
    ? ` · Table ${n.table_number}`
    : n.room_number
    ? ` · Room ${n.room_number}`
    : "";
  return { label: cfg.label + where, color: cfg.color, href: cfg.href, Icon: cfg.Icon };
}

// Minimal top bar: brand + the two things that must always be one tap away —
// Notifications (with a live unread badge) and Logout. Every other section now
// lives on the scrollable dashboard, gated by the same permissions. This still
// polls notifications so the badge stays live and new alerts toast.
export function StaffNav({
  restaurantName,
  displayName,
  notificationCount = 0,
}: {
  restaurantName: string;
  displayName: string;
  notificationCount?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Service calls (waiter/bill/activation) + new orders drive the badge.
  const [alertCount, setAlertCount] = useState(notificationCount);
  const [toasts, setToasts] = useState<{ id: string; label: string; color: string; href: string; Icon: React.ComponentType<{ size?: number }> }[]>([]);
  // Track which notification ids we've already seen so we only alert on new ones.
  const seenIds = useRef<Set<string> | null>(null);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const { items } = await getMyNotifications();
        if (!active) return;

        const newRows = items.filter((n) => n.status === "new");
        setAlertCount(newRows.length);

        if (seenIds.current === null) {
          // First poll: seed the baseline without alerting for pre-existing items.
          seenIds.current = new Set(newRows.map((n) => n.id));
        } else {
          const fresh = newRows.filter((n) => !seenIds.current!.has(n.id));
          if (fresh.length > 0) {
            setToasts((prev) => [
              ...fresh.map((n) => ({ id: n.id, ...alertText(n) })),
              ...prev,
            ].slice(0, 4));
            // Refresh so embedded sections (orders, tables) reflect the change.
            router.refresh();
          }
          seenIds.current = new Set(newRows.map((n) => n.id));
        }
      } catch {
        // transient network / auth hiccup — keep the last known state
      }
    }

    poll();
    const iv = setInterval(poll, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss toasts after a while.
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((prev) => prev.slice(0, -1)), 6000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <>
      <header
        className="flex items-center gap-2 px-3 sm:px-5 py-3 border-b"
        style={{ background: "var(--color-brand-dark)", borderColor: "rgba(255,255,255,0.08)" }}
      >
        {/* Brand / user info — tapping the name returns to the dashboard. */}
        <Link href="/employee/dashboard" className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate block" style={{ color: "#fff", letterSpacing: "-0.2px" }}>
            <span className="hidden sm:inline">{restaurantName}</span>
            <span className="sm:hidden" style={{ color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>{displayName}</span>
          </span>
          <span className="text-xs hidden sm:block" style={{ color: "rgba(255,255,255,0.4)" }}>{displayName}</span>
        </Link>

        {/* Notifications */}
        <Link
          href="/employee/notifications"
          className="relative flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{ color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.08)" }}
        >
          <Bell size={15} strokeWidth={1.5} />
          <span className="hidden xs:inline sm:inline">Notifications</span>
          {alertCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-medium flex items-center justify-center"
              style={{ background: "#ef4444", color: "#fff" }}
            >
              {alertCount > 9 ? "9+" : alertCount}
            </span>
          )}
        </Link>

        {/* Logout */}
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => { await logout(); })}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          <LogOut size={14} strokeWidth={1.5} />
          <span className="hidden sm:inline">{pending ? "…" : "Out"}</span>
        </button>
      </header>

      {/* Live alert toasts */}
      {toasts.length > 0 && (
        <div className="fixed top-16 right-3 z-50 flex flex-col gap-2 w-[min(320px,calc(100vw-24px))]">
          {toasts.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { dismiss(t.id); router.push(t.href); }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border text-left shadow-lg"
              style={{ background: "var(--color-canvas)", borderColor: t.color + "55", boxShadow: "0 8px 24px rgba(13,37,61,0.12)" }}
            >
              <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: t.color + "18", color: t.color }}>
                <t.Icon size={16} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium" style={{ color: "var(--color-ink)" }}>{t.label}</span>
                <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>Tap to open</span>
              </span>
              <span onClick={(e) => { e.stopPropagation(); dismiss(t.id); }} style={{ color: "var(--color-ink-mute)" }}>
                <X size={14} />
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
