"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition, useState } from "react";
import { logout } from "@/app/actions/auth";
import {
  LayoutDashboard,
  BookOpen,
  LayoutGrid,
  DoorOpen,
  Zap,
  Users,
  LogOut,
  Menu,
  X,
} from "lucide-react";

const NAV = [
  { label: "Dashboard",    href: "/admin/dashboard",     icon: LayoutDashboard, exact: true },
  { label: "Menu",         href: "/admin/menu",           icon: BookOpen,        exact: false },
  { label: "Tables",       href: "/admin/tables",         icon: LayoutGrid,      exact: false },
  { label: "Rooms",        href: "/admin/rooms",          icon: DoorOpen,        exact: false },
  { label: "Workstations", href: "/admin/workstations",   icon: Zap,             exact: false },
  { label: "Staff",        href: "/admin/staff",          icon: Users,           exact: false },
];

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {NAV.map(({ label, href, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{
              color: active ? "#fff" : "rgba(255,255,255,0.5)",
              background: active ? "rgba(255,255,255,0.1)" : "transparent",
              fontWeight: active ? 400 : 300,
            }}
          >
            <Icon size={15} strokeWidth={1.5} />
            {label}
          </Link>
        );
      })}
    </>
  );
}

export function AdminSidebar({ restaurantName }: { restaurantName: string }) {
  const pathname = usePathname();
  const [logoutPending, startLogout] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleLogout() {
    startLogout(async () => { await logout(); });
  }

  return (
    <>
      {/* ── Desktop sidebar (md+) ─────────────────────────────────── */}
      <aside
        className="w-52 shrink-0 hidden md:flex flex-col min-h-screen"
        style={{ background: "var(--color-brand-dark)" }}
      >
        <div className="px-5 py-5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <Link href="/admin/dashboard" className="block">
            <span
              className="text-base tracking-tight"
              style={{ color: "#fff", fontWeight: 300, letterSpacing: "-0.3px" }}
            >
              Restro<span style={{ color: "var(--color-primary-soft)", fontWeight: 500 }}>Sewa</span>
            </span>
          </Link>
          <p className="text-xs mt-1 truncate" style={{ color: "rgba(255,255,255,0.45)" }}>
            {restaurantName}
          </p>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
          <NavLinks pathname={pathname} />
        </nav>

        <div className="px-3 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <button
            type="button"
            disabled={logoutPending}
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            <LogOut size={15} strokeWidth={1.5} />
            {logoutPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      {/* ── Mobile top bar (below md) ─────────────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 border-b"
        style={{
          background: "var(--color-brand-dark)",
          borderColor: "rgba(255,255,255,0.08)",
          height: 48,
        }}
      >
        {/* Hamburger */}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          <Menu size={18} strokeWidth={1.5} />
        </button>

        {/* Brand */}
        <Link href="/admin/dashboard" className="flex-1 text-sm" style={{ color: "#fff", fontWeight: 300, letterSpacing: "-0.2px" }}>
          Restro<span style={{ color: "var(--color-primary-soft)", fontWeight: 500 }}>Sewa</span>
          <span className="ml-2 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            {restaurantName}
          </span>
        </Link>

        {/* Icon-only nav for quick access */}
        <nav className="flex items-center gap-0.5">
          {NAV.map(({ href, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
                style={{
                  background: active ? "rgba(255,255,255,0.12)" : "transparent",
                  color: active ? "#fff" : "rgba(255,255,255,0.45)",
                }}
              >
                <Icon size={15} strokeWidth={1.5} />
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── Mobile drawer overlay ──────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Drawer panel */}
          <div
            className="w-64 flex flex-col min-h-screen"
            style={{ background: "var(--color-brand-dark)" }}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <span className="text-sm" style={{ color: "#fff", fontWeight: 300 }}>
                Restro<span style={{ color: "var(--color-primary-soft)", fontWeight: 500 }}>Sewa</span>
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                style={{ color: "rgba(255,255,255,0.5)" }}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <p className="px-5 pt-2 pb-1 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
              {restaurantName}
            </p>

            <nav className="flex-1 px-3 py-3 flex flex-col gap-0.5">
              <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </nav>

            <div className="px-3 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <button
                type="button"
                disabled={logoutPending}
                onClick={handleLogout}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                <LogOut size={15} strokeWidth={1.5} />
                {logoutPending ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>

          {/* Backdrop */}
          <div
            className="flex-1"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}
    </>
  );
}
