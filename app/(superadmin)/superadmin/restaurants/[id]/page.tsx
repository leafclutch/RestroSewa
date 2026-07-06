import Link from "next/link";
import { notFound } from "next/navigation";
import { getRestaurantWithStaff } from "@/app/actions/restaurants";
import { AddStaffForm } from "./_components/add-staff-form";
import { StaffSection } from "./_components/staff-section";
import { RestaurantDetailClient } from "./_components/restaurant-detail-client";
import { ChevronLeft } from "lucide-react";

export default async function RestaurantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getRestaurantWithStaff(id);

  if (!result) notFound();

  const { restaurant: r, staff } = result;

  return (
    <div className="p-8 max-w-2xl">
      <Link
        href="/superadmin/dashboard"
        className="inline-flex items-center gap-1.5 text-sm mb-6"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ChevronLeft size={14} />
        Restaurants
      </Link>

      {/* Restaurant info card — editable */}
      <RestaurantDetailClient restaurant={r} />

      {/* Staff section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-base"
            style={{ color: "var(--color-ink)", fontWeight: 400 }}
          >
            Staff members
            <span className="ml-2 text-sm" style={{ color: "var(--color-ink-mute)" }}>
              ({staff.length})
            </span>
          </h2>
        </div>

        <div className="mb-6">
          <StaffSection
            staff={staff}
            restaurantSlug={r.slug}
            restaurantId={r.id}
          />
        </div>

        <AddStaffForm restaurantId={r.id} />
      </div>
    </div>
  );
}
