"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { logout } from "@/app/actions/auth";
import { CalendarDays, Clock, Home, LogOut } from "lucide-react";
import { RestaurantLogo } from "@/components/branding/restaurant-logo";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * Today's date and a ticking clock, for the top bar. Read on the client only (empty on
 * the server, filled after mount): the server's clock and zone are not the till's, and
 * rendering it there would mismatch on hydration. Hidden on phones, where the bar has
 * no room to spare.
 */
function NavClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span className="hidden md:block w-[230px]" aria-hidden />;

  return (
    <span
      className="hidden md:inline-flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap"
      style={{ background: "rgba(255,255,255,0.08)", color: "#fff" }}
    >
      <span className="inline-flex items-center gap-1.5">
        <CalendarDays size={15} strokeWidth={1.7} style={{ color: "rgba(255,255,255,0.7)" }} />
        {now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
      </span>
      <span aria-hidden className="w-px h-4" style={{ background: "rgba(255,255,255,0.25)" }} />
      <span className="inline-flex items-center gap-1.5 tabular font-semibold">
        <Clock size={15} strokeWidth={1.7} style={{ color: "rgba(255,255,255,0.7)" }} />
        {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </span>
  );
}

// The staff top bar. STICKY: it stays pinned while the dashboard scrolls, so
// Notifications and Logout are always one tap away — which matters when a waiter
// call arrives while someone is halfway down the Orders queue.
//
// Actionable requests (waiter call, bill request, table activation) are now
// handled entirely in the bell's dropdown — no navigation to a separate page.
export function StaffNav({
  restaurantName,
  restaurantLogo = null,
  displayName,
  notificationCount = 0,
  showRota = false,
}: {
  restaurantName: string;
  restaurantLogo?: string | null;
  displayName: string;
  notificationCount?: number;
  /** Restaurant is on advanced (rota) payout — every staff member gets "My Rota". */
  showRota?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();
  const atHome = pathname === "/employee/dashboard";
  const atRota = pathname === "/employee/rota";

  return (
    <header
      // z-40 keeps it above the dashboard's own sticky section-nav (z-30), which
      // parks itself directly beneath this bar.
      className="sticky top-0 z-40 flex items-center gap-2 px-3 sm:px-5 border-b"
      style={{
        background: "var(--color-brand-dark)",
        borderColor: "rgba(255,255,255,0.08)",
        // The viewport is `viewport-fit: cover`, so on a notched phone the page
        // starts at the physical top of the screen — under the clock. Padding the
        // bar by the inset makes it grow UP into that strip and paint it brand-dark,
        // which is what puts the status bar on the header instead of in front of it.
        // On a device with no notch the inset is 0px and this is exactly the old 56.
        height: "calc(56px + env(safe-area-inset-top, 0px))",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      {/* Brand / user — tapping it returns to the dashboard. Staff work for the
          RESTAURANT, so its logo leads here; HRestroSewa is the platform underneath
          and doesn't compete for the space. */}
      <Link href="/employee/dashboard" className="flex-1 min-w-0 flex items-center gap-2.5">
        <RestaurantLogo
          name={restaurantName}
          logoUrl={restaurantLogo}
          size={32}
          priority
        />
        <span className="min-w-0">
          <span className="text-sm font-medium truncate block" style={{ color: "#fff", letterSpacing: "-0.2px" }}>
            <span className="hidden sm:inline">{restaurantName}</span>
            <span className="sm:hidden" style={{ color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>
              {displayName}
            </span>
          </span>
          <span className="text-xs hidden sm:block" style={{ color: "rgba(255,255,255,0.4)" }}>
            {displayName}
          </span>
        </span>
      </Link>

      <NavClock />

      {/* Home — one tap back to the dashboard from a session, queue or menu
          screen. The label collapses on narrow phones; the icon never does. */}
      <Link
        href="/employee/dashboard"
        aria-label="Home"
        aria-current={atHome ? "page" : undefined}
        className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg text-sm transition-colors"
        style={{
          color: atHome ? "#fff" : "rgba(255,255,255,0.85)",
          background: atHome ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
        }}
      >
        <Home size={15} strokeWidth={1.5} />
        <span className="hidden sm:inline">Home</span>
      </Link>

      {/* My Rota — this week's shifts, for a rota (advanced payout) restaurant. */}
      {showRota && (
        <Link
          href="/employee/rota"
          aria-label="My Rota"
          aria-current={atRota ? "page" : undefined}
          className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{
            color: atRota ? "#fff" : "rgba(255,255,255,0.85)",
            background: atRota ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
          }}
        >
          <CalendarDays size={15} strokeWidth={1.5} />
          <span className="hidden sm:inline">My Rota</span>
        </Link>
      )}

      {/* Notifications — the bell owns the dropdown, the badge and the stream. */}
      <NotificationBell initialCount={notificationCount} />

      <ThemeToggle />

      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => { await logout(); })}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm transition-colors hover:bg-white/5 active:bg-white/10"
        style={{ color: "rgba(255,255,255,0.4)" }}
      >
        <LogOut size={14} strokeWidth={1.5} />
        <span className="hidden sm:inline">{pending ? "…" : "Out"}</span>
      </button>
    </header>
  );
}
