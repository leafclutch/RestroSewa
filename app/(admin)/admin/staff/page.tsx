import { requireAdminOrPermission } from "@/lib/auth/guards";
import { PAYROLL_ACCESS, PERMISSIONS } from "@/lib/permissions";
import { createServiceClient } from "@/lib/supabase/service";
import { getWorkstations } from "@/app/actions/workstations";
import { getPayrollSheet } from "@/app/actions/payroll";
import { WorkstationAssign } from "./_components/workstation-assign";
import { PayrollClient } from "./_components/payroll-client";

type StaffRow = {
  id: string;
  display_name: string;
  title: string | null;
  role: string;
  is_active: boolean;
  auth_user_id: string | null;
  permissions: string[];
};

type AssignmentRow = {
  restaurant_user_id: string;
  workstation_id: string;
};

export default async function AdminStaffPage() {
  const { restaurantUser } = await requireAdminOrPermission(PERMISSIONS.VIEW_STAFF);
  const { restaurant_id } = restaurantUser;

  const service = createServiceClient();

  const [staffResult, workstations] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurant_users")
      .select("id, display_name, title, role, is_active, auth_user_id, permissions")
      .eq("restaurant_id", restaurant_id)
      .is("deleted_at", null)
      .order("role")
      .order("display_name"),
    getWorkstations(restaurant_id),
  ]);

  const members = (staffResult.data as StaffRow[]) ?? [];
  const admins = members.filter((s) => s.role === "restaurant_admin");
  const employees = members.filter((s) => s.role === "restaurant_employee");

  const staffIds = members.map((s) => s.id);
  let assignments: AssignmentRow[] = [];
  if (staffIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (service as any)
      .from("restaurant_user_workstations")
      .select("restaurant_user_id, workstation_id")
      .in("restaurant_user_id", staffIds);
    assignments = (data as AssignmentRow[]) ?? [];
  }

  const assignedFor = (staffId: string) =>
    assignments.filter((a) => a.restaurant_user_id === staffId).map((a) => a.workstation_id);

  const canAssignWorkstations = restaurantUser.role === "restaurant_admin";

  // Payroll is gated separately from `view_staff`: seeing the roster is not the
  // same as seeing what everyone earns. `getPayrollSheet` re-checks this itself,
  // so a caller who slipped past here would still get an empty sheet.
  const canViewPayroll = PAYROLL_ACCESS.canViewPayroll(restaurantUser);
  const payroll = canViewPayroll ? await getPayrollSheet() : null;

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <h1
        className="text-xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Staff
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-ink-mute)" }}>
        {members.length} members. Staff accounts are managed by the platform super admin.
      </p>

      {[
        { label: "Admins", list: admins },
        { label: "Staff", list: employees },
      ].map(({ label, list }) =>
        list.length > 0 ? (
          <div key={label} className="mb-6">
            <p
              className="text-xs uppercase tracking-wide mb-2"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              {label}
            </p>
            <div className="flex flex-col gap-2">
              {list.map((s) => (
                <div
                  key={s.id}
                  className="flex items-start gap-3 px-4 py-3 rounded-lg border"
                  style={{
                    background: "var(--color-canvas)",
                    borderColor: "var(--color-hairline)",
                    opacity: s.is_active ? 1 : 0.5,
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0 mt-0.5"
                    style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
                  >
                    {s.display_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                      {s.display_name}
                    </p>
                    {s.title && (
                      <p className="text-xs mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                        {s.title}
                      </p>
                    )}
                    {/* Workstation assignment â€” employees only, admins skip all workstations */}
                    {s.role === "restaurant_employee" && canAssignWorkstations && (
                      <div className="mt-1.5">
                        <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>
                          Workstations
                        </p>
                        <WorkstationAssign
                          staffId={s.id}
                          restaurantId={restaurant_id}
                          workstations={workstations}
                          initialAssigned={assignedFor(s.id)}
                        />
                      </div>
                    )}
                  </div>
                  <div
                    className="w-2 h-2 rounded-full mt-2 shrink-0"
                    title={s.auth_user_id ? "Has login" : "No login yet"}
                    style={{ background: s.auth_user_id ? "#1a7a4a" : "#d1d5db" }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null
      )}

      {members.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
          No staff yet. Ask your platform admin to add team members.
        </p>
      )}

      {/* Payroll — the same people, with what they earn. Not a separate module
          and not a separate employee list; it hangs off the staff above. */}
      {payroll && (
        <PayrollClient
          initial={payroll}
          canManage={PAYROLL_ACCESS.canManagePayroll(restaurantUser)}
        />
      )}
    </div>
  );
}
