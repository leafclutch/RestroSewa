"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { logout } from "@/app/actions/auth";
import {
  LayoutDashboard,
  BookOpen,
  LayoutGrid,
  DoorOpen,
  Zap,
  Users,
  Truck,
  Package,
  ShoppingCart,
  Wallet,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { RestaurantLogo } from "@/components/branding/restaurant-logo";
import { PlatformWordmark, PoweredBy } from "@/components/branding/platform-logo";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  exact: boolean;
  /** Finance-only: needs `view_finance`, which stock permissions do NOT grant. */
  financeOnly?: boolean;
};

const NAV: NavItem[] = [
  { label: "Dashboard",    href: "/admin/dashboard",     icon: LayoutDashboard, exact: true },
  { label: "Menu",         href: "/admin/menu",           icon: BookOpen,        exact: false },
  { label: "Tables",       href: "/admin/tables",         icon: LayoutGrid,      exact: false },
  { label: "Rooms",        href: "/admin/rooms",          icon: DoorOpen,        exact: false },
  { label: "Workstations", href: "/admin/workstations",   icon: Zap,             exact: false },
  { label: "Staff",        href: "/admin/staff",          icon: Users,           exact: false },
];

// Stock & Finance. Shown only to staff permitted to see the module — and Finance
// is gated separately again, so a storekeeper never sees a link that would just
// bounce them (nav and route guard must agree).
const STOCK_NAV: NavItem[] = [
  { label: "Stock",     href: "/admin/stock",     icon: Package,      exact: false },
  { label: "Purchases", href: "/admin/purchases", icon: ShoppingCart, exact: false },
  { label: "Vendors",   href: "/admin/vendors",   icon: Truck,        exact: false },
  { label: "Finance",   href: "/admin/finance",   icon: Wallet,       exact: false, financeOnly: true },
];

const stockNavFor = (canSeeStock: boolean, canSeeFinance: boolean) =>
  STOCK_NAV.filter((i) =>
    i.financeOnly ? canSeeFinance : canSeeStock
  );

const isActive = (pathname: string, item: NavItem) =>
  item.exact ? pathname === item.href : pathname.startsWith(item.href);

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
      style={{
        color: active ? "#fff" : "rgba(255,255,255,0.5)",
        background: active ? "rgba(255,255,255,0.1)" : "transparent",
        fontWeight: active ? 400 : 300,
      }}
    >
      <Icon size={15} strokeWidth={1.5} />
      {item.label}
    </Link>
  );
}

function NavLinks({
  pathname,
  showStock,
  showFinance,
  onNavigate,
}: {
  pathname: string;
  showStock: boolean;
  showFinance: boolean;
  onNavigate?: () => void;
}) {
  const stockItems = stockNavFor(showStock, showFinance);
  return (
    <>
      {NAV.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}

      {stockItems.length > 0 && (
        <>
          <p
            className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wide"
            style={{ color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em" }}
          >
            Stock &amp; Finance
          </p>
          {stockItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </>
  );
}

export function AdminSidebar({
  restaurantName,
  restaurantLogo = null,
  showStock = false,
  showFinance = false,
}: {
  restaurantName: string;
  restaurantLogo?: string | null;
  showStock?: boolean;
  showFinance?: boolean;
}) {
  const pathname = usePathname();
  const [logoutPending, startLogout] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);

  // With the drawer open, the page behind it must not scroll away underneath.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  function handleLogout() {
    startLogout(async () => { await logout(); });
  }

  return (
    <>
      {/* ── Desktop sidebar (md+) ─────────────────────────────────────────────
          `sticky top-0 h-screen` pins it to the viewport while the page scrolls
          past. It stays in the flex row (unlike `fixed`), so the content column
          keeps its width automatically and no layout shifts. */}
      <aside
        className="w-52 shrink-0 hidden md:flex flex-col sticky top-0 h-screen"
        style={{ background: "var(--color-brand-dark)" }}
      >
        {/* The RESTAURANT leads — this is their dashboard. RestroSewa stays as the
            quiet platform mark beneath it. */}
        <div className="px-5 py-5 border-b shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <Link href="/admin/dashboard" className="flex items-center gap-2.5 min-w-0">
            <RestaurantLogo name={restaurantName} logoUrl={restaurantLogo} size={34} priority />
            <span
              className="text-sm truncate"
              style={{ color: "#fff", fontWeight: 400, letterSpacing: "-0.2px" }}
            >
              {restaurantName}
            </span>
          </Link>
          <PlatformWordmark size={11} className="block mt-2 opacity-50" />
        </div>

        {/* The nav itself scrolls if it ever outgrows the viewport, so Sign out
            can never be pushed off-screen. */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 flex flex-col gap-0.5">
          <NavLinks pathname={pathname} showStock={showStock} showFinance={showFinance} />
        </nav>

        <div className="px-3 py-4 border-t shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
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
          <PoweredBy height={14} tone="light" className="px-3 pt-3" />
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
        <Link href="/admin/dashboard" className="flex-1 min-w-0 flex items-center gap-2">
          <RestaurantLogo name={restaurantName} logoUrl={restaurantLogo} size={26} priority />
          <span className="text-sm truncate" style={{ color: "#fff", fontWeight: 400, letterSpacing: "-0.2px" }}>
            {restaurantName}
          </span>
        </Link>

        {/* Icon-only nav for quick access */}
        <nav className="flex items-center gap-0.5">
          {[...NAV, ...stockNavFor(showStock, showFinance)].map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
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
          {/* Drawer panel — h-full (not min-h-screen) so it never grows past the
              viewport; the nav inside scrolls instead. */}
          <div
            className="w-64 flex flex-col h-full"
            style={{ background: "var(--color-brand-dark)" }}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b shrink-0"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <RestaurantLogo name={restaurantName} logoUrl={restaurantLogo} size={30} />
                <span className="text-sm truncate" style={{ color: "#fff", fontWeight: 400 }}>
                  {restaurantName}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                style={{ color: "rgba(255,255,255,0.5)" }}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <PlatformWordmark size={11} className="block px-5 pt-2 pb-1 opacity-50" />

            <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-0.5">
              <NavLinks
                pathname={pathname}
                showStock={showStock}
                showFinance={showFinance}
                onNavigate={() => setMobileOpen(false)}
              />
            </nav>

            <div className="px-3 py-4 border-t shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
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
