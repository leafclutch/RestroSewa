"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { logoutSuperAdmin } from "@/app/actions/auth";
import { Store, LogOut, Settings } from "lucide-react";
import { PlatformLogo, PlatformWordmark, PoweredBy } from "@/components/branding/platform-logo";

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
      // sticky top-0 h-screen pins it to the viewport while the main column scrolls past — it stays
      // in the flex row (unlike `fixed`), so the content keeps its width. It used to be
      // `min-h-screen`, which grew with the page and scrolled away with it.
      className="w-52 shrink-0 flex flex-col sticky top-0 h-screen"
      style={{ background: "var(--color-brand-dark)" }}
    >
      {/* Logo */}
      <div className="px-5 py-6 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        {/* Super Admin is PLATFORM territory — HRestroSewa is the only brand here. */}
        <Link href="/superadmin/dashboard" className="block">
          <span className="flex items-center gap-2.5">
            {/* White plate: this sidebar is brand-dark indigo (#1c1e54), almost the emblem tile's
                own navy (#19204f), so the badge would blend right in. A small white plate lifts it
                off the background as a crisp app-icon badge. (Login/marketing sit on near-black, so
                the emblem pops there without a plate.) */}
            <span className="inline-flex shrink-0" style={{ background: "#fff", borderRadius: 8, padding: 3 }}>
              <PlatformLogo size={26} priority />
            </span>
            <PlatformWordmark size={16} />
          </span>
          <p
            className="text-xs mt-1.5"
            style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}
          >
            Super Admin
          </p>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 flex flex-col gap-0.5">
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
        <PoweredBy height={12} tone="light" className="px-3 pt-3" />
      </div>
    </aside>
  );
}
