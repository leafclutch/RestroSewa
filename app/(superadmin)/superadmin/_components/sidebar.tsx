"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { logoutSuperAdmin } from "@/app/actions/auth";
import { Store, LogOut, Settings } from "lucide-react";
import { PlatformWordmark, PoweredBy } from "@/components/branding/platform-logo";

const NAV = [
  { label: "Restaurants", href: "/superadmin/dashboard", icon: Store, exact: true },
  { label: "Settings", href: "/superadmin/settings", icon: Settings, exact: false },
];

export function SuperAdminSidebar() {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      await logoutSuperAdmin();
    });
  }

  return (
    <aside
      className="w-52 shrink-0 flex flex-col min-h-screen"
      style={{ background: "var(--color-brand-dark)" }}
    >
      {/* Logo */}
      <div className="px-5 py-6 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        {/* Super Admin is PLATFORM territory — RestroSewa is the only brand here. */}
        <Link href="/superadmin/dashboard" className="block">
          <PlatformWordmark size={16} className="block" />
          <p
            className="text-xs mt-0.5"
            style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}
          >
            Super Admin
          </p>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {NAV.map(({ label, href, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{
                color: active ? "#ffffff" : "rgba(255,255,255,0.5)",
                background: active ? "rgba(255,255,255,0.1)" : "transparent",
                fontWeight: active ? 400 : 300,
              }}
            >
              <Icon size={15} strokeWidth={1.5} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <button
          type="button"
          onClick={handleLogout}
          disabled={pending}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full transition-colors"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          <LogOut size={15} strokeWidth={1.5} />
          {pending ? "Signing out…" : "Sign out"}
        </button>
        <PoweredBy height={14} tone="light" className="px-3 pt-3" />
      </div>
    </aside>
  );
}
