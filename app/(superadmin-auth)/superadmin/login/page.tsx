import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SuperAdminLoginForm } from "./_components/super-admin-form";
import { PlatformWordmark, PoweredBy } from "@/components/branding/platform-logo";

export default async function SuperAdminLoginPage() {
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

  return (
    <div className="w-full max-w-[420px] mx-auto">
      {/* tone="light": this page sits on a near-black gradient. The wordmark was
          previously painted in `--color-ink` (the dark-text token) against it. */}
      <div className="mb-6 sm:mb-8 text-center">
        <PlatformWordmark size={24} accent="var(--color-lemon)" letterSpacing="-0.5px" />
        <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          Super Admin
        </p>
      </div>

      <div
        className="rounded-xl border px-5 py-6 sm:px-8 sm:py-8"
        style={{
          background: "var(--color-canvas)",
          borderColor: "var(--color-hairline)",
          boxShadow: "0 4px 24px 0 rgba(28,30,84,0.07)",
        }}
      >
        <h1
          className="text-lg mb-1"
          style={{ color: "var(--color-ink)", fontWeight: 400, letterSpacing: "-0.3px" }}
        >
          Super Admin sign in
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--color-ink-mute)" }}>
          Restricted access
        </p>
        <SuperAdminLoginForm />
      </div>

      <p className="text-xs text-center mt-5 sm:mt-6 px-2" style={{ color: "rgba(255,255,255,0.35)" }}>
        Restaurant admin or staff?{" "}
        <Link href="/login" style={{ color: "rgba(255,255,255,0.55)" }}>
          Sign in here
        </Link>
      </p>

      <div className="flex justify-center mt-6">
        <PoweredBy height={13} tone="light" />
      </div>
    </div>
  );
}
