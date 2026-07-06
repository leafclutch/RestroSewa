import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AdminLoginForm } from "./_components/admin-form";
import { StaffLogin } from "./_components/staff-login";
import { getRestaurantStaff } from "@/app/actions/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; slug?: string; returnTo?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const service = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sa } = await (service as any)
      .from("super_admins")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (sa) redirect("/superadmin/dashboard");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ru } = await (service as any)
      .from("restaurant_users")
      .select("role")
      .eq("auth_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (ru?.role === "restaurant_admin") redirect("/admin/dashboard");
    if (ru?.role === "restaurant_employee") redirect("/employee/dashboard");
  }

  const { mode, slug } = await searchParams;
  const isStaffMode = mode === "staff" && typeof slug === "string" && slug.length > 0;

  let staff = null;
  if (isStaffMode) {
    staff = await getRestaurantStaff(slug!);
  }

  return (
    <div className="w-full max-w-[420px] mx-auto">
      {/* Logo / wordmark */}
      <div className="mb-6 sm:mb-8 text-center">
        <span
          className="text-2xl tracking-tight"
          style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.5px" }}
        >
          Restro<span style={{ color: "var(--color-lemon)", fontWeight: 500 }}>Sewa</span>
        </span>
      </div>

      <div
        className="rounded-xl border px-5 py-6 sm:px-8 sm:py-8"
        style={{
          background: "var(--color-canvas)",
          borderColor: "var(--color-hairline)",
          boxShadow: "0 4px 24px 0 rgba(28,30,84,0.07)",
        }}
      >
        {isStaffMode && staff ? (
          <>
            <h1
              className="text-lg mb-6 text-center"
              style={{ color: "var(--color-ink)", fontWeight: 400, letterSpacing: "-0.3px" }}
            >
              Staff sign in
            </h1>
            <StaffLogin staff={staff} />
          </>
        ) : isStaffMode && !staff ? (
          <div className="text-center py-4">
            <p className="text-sm" style={{ color: "var(--color-ruby)" }}>
              Restaurant not found or inactive.
            </p>
            <Link
              href="/login"
              className="text-sm mt-2 inline-block"
              style={{ color: "var(--color-primary)" }}
            >
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <h1
              className="text-lg mb-1"
              style={{ color: "var(--color-ink)", fontWeight: 400, letterSpacing: "-0.3px" }}
            >
              Sign in
            </h1>
            <p
              className="text-sm mb-6"
              style={{ color: "var(--color-ink-mute)" }}
            >
              Admin &amp; restaurant manager access
            </p>
            <AdminLoginForm />
          </>
        )}
      </div>

      {!isStaffMode && (
        <p className="text-xs text-center mt-5 sm:mt-6 px-2" style={{ color: "rgba(255,255,255,0.35)" }}>
          Staff?{" "}
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            Use the PIN login link from your manager.
          </span>
        </p>
      )}
    </div>
  );
}
