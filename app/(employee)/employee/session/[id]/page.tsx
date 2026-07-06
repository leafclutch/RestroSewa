import { notFound } from "next/navigation";
import Link from "next/link";
import { getSessionDetail, getEffectiveWaiters } from "@/app/actions/pos";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { SessionClient } from "./_components/session-client";
import { ChevronLeft } from "lucide-react";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [session, { restaurantUser }] = await Promise.all([
    getSessionDetail(id),
    requireRestaurantStaff(),
  ]);

  if (!session) notFound();

  const canCreateOrders = hasPermission(restaurantUser, PERMISSIONS.CREATE_ORDERS);
  const canCloseBills   = hasPermission(restaurantUser, PERMISSIONS.CLOSE_BILLS);
  const canForceClose   =
    hasPermission(restaurantUser, PERMISSIONS.CLOSE_BILLS) ||
    hasPermission(restaurantUser, PERMISSIONS.MANAGE_TABLES);

  // PIN visibility: admin and MANAGE_TABLES (workstation) always see it.
  // For assigned sessions, only the effective waiter(s) can see the PIN.
  // Walk-in sessions have no assignment concept, so anyone can see the PIN.
  const isAdmin = restaurantUser.role === "restaurant_admin";
  const isWorkstation = hasPermission(restaurantUser, PERMISSIONS.MANAGE_TABLES);
  const isWalkIn = session.type === "walk_in";
  let canSeePIN = isAdmin || isWorkstation || isWalkIn;
  if (!canSeePIN) {
    const effectiveWaiters = await getEffectiveWaiters(session.table_id, session.room_id);
    const hasAssignment = effectiveWaiters.length > 0;
    canSeePIN = !hasAssignment || effectiveWaiters.includes(restaurantUser.id);
  }

  const label =
    session.type === "table" && session.table_number
      ? `Table ${session.table_number}`
      : session.type === "walk_in"
      ? "Walk-in"
      : session.type === "room_service"
      ? "Room service"
      : "Session";

  return (
    <div className="p-5 max-w-lg">
      <Link
        href="/employee/dashboard"
        className="inline-flex items-center gap-1 text-sm mb-4"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ChevronLeft size={14} />
        Tables
      </Link>

      <div className="flex items-center justify-between mb-5">
        <h1
          className="text-xl"
          style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
        >
          {label}
        </h1>
        <span
          className="text-xs px-2 py-0.5 rounded-full border"
          style={{
            color: session.status === "active" ? "#1a7a4a" : "var(--color-ink-mute)",
            borderColor: session.status === "active" ? "#1a7a4a44" : "var(--color-hairline)",
            background: session.status === "active" ? "#f0fdf4" : "transparent",
          }}
        >
          {session.status}
        </span>
      </div>

      <SessionClient
        session={session}
        canCreateOrders={canCreateOrders}
        canCloseBills={canCloseBills}
        canForceClose={canForceClose}
        canSeePIN={canSeePIN}
      />
    </div>
  );
}
