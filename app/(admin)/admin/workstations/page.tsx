import { requireAdminOrPermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/permissions";
import { getWorkstations } from "@/app/actions/workstations";
import type { PaperWidth } from "@/app/actions/workstations";
import { createServiceClient } from "@/lib/supabase/service";
import { WorkstationsClient } from "./_components/workstations-client";

export default async function WorkstationsPage() {
  const { restaurantUser } = await requireAdminOrPermission(PERMISSIONS.MANAGE_MENU);
  const service = createServiceClient();
  const [workstations, { data: rest }] = await Promise.all([
    getWorkstations(restaurantUser.restaurant_id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurants")
      .select("settings")
      .eq("id", restaurantUser.restaurant_id)
      .maybeSingle(),
  ]);
  const paperWidth: PaperWidth = rest?.settings?.print_paper_width === "58" ? "58" : "80";

  return (
    <div className="p-4 md:p-8">
      <h1
        className="text-2xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Workstations
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-ink-mute)" }}>
        Stations where orders are prepared â€” Kitchen, Bar, Grill, etc. Menu items route to their
        workstation when ordered.
      </p>

      <WorkstationsClient
        workstations={workstations}
        restaurantId={restaurantUser.restaurant_id}
        paperWidth={paperWidth}
      />
    </div>
  );
}
