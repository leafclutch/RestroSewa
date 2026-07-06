"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { logout } from "@/app/actions/auth";
import { Banknote, Bell, BookOpen, LayoutGrid, ListOrdered, LogOut } from "lucide-react";

export function StaffNav({
  restaurantName,
  displayName,
  notificationCount = 0,
  canManageMenu = false,
}: {
  restaurantName: string;
  displayName: string;
  notificationCount?: number;
  canManageMenu?: boolean;
}) {
  const NAV = [
    { label: "Tables",        href: "/employee/dashboard",     icon: LayoutGrid,  exact: true  },
    { label: "Orders",        href: "/employee/queue",         icon: ListOrdered, exact: false },
    ...(canManageMenu ? [{ label: "Menu", href: "/employee/menu", icon: BookOpen, exact: false }] : []),
    { label: "Sales",         href: "/employee/sales",         icon: Banknote,    exact: false },
    { label: "Notifications", href: "/employee/notifications", icon: Bell,        exact: false },
  ];
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <header
      className="flex items-center gap-2 px-3 sm:px-5 py-3 border-b"
      style={{
        background: "var(--color-brand-dark)",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      {/* Brand / user info */}
      <div className="flex-1 min-w-0">
        <span
          className="text-sm font-medium truncate block"
          style={{ color: "#fff", letterSpacing: "-0.2px" }}
        >
          <span className="hidden sm:inline">{restaurantName}</span>
          <span className="sm:hidden" style={{ color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>
            {displayName}
          </span>
        </span>
        <span className="text-xs hidden sm:block" style={{ color: "rgba(255,255,255,0.4)" }}>
          {displayName}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex items-center gap-0.5">
        {NAV.map(({ label, href, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          const showBadge = label === "Notifications" && notificationCount > 0;
          return (
            <Link
              key={href}
              href={href}
              className="relative flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg text-sm transition-colors"
              style={{
                color: active ? "#fff" : "rgba(255,255,255,0.5)",
                background: active ? "rgba(255,255,255,0.1)" : "transparent",
              }}
            >
              <Icon size={15} strokeWidth={1.5} />
              {/* Label hidden on very small screens */}
              <span className="hidden xs:inline sm:inline">{label}</span>
              {showBadge && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-medium flex items-center justify-center"
                  style={{ background: "#ef4444", color: "#fff" }}
                >
                  {notificationCount > 9 ? "9+" : notificationCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

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
  );
}
