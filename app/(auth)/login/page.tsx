import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "./_components/admin-form";
import { StaffLogin } from "./_components/staff-login";
import { RestaurantSearch } from "./_components/restaurant-search";
import {
  getRestaurantStaff,
  lastRestaurantSlug,
  signOutStrandedSession,
} from "@/app/actions/auth";
import { getAuthUser, getCurrentStaff, isSuperAdmin } from "@/lib/auth/current-user";
import { PoweredBy } from "@/components/branding/platform-logo";
import { InstallPrompt } from "@/components/pwa/install-prompt";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; slug?: string; returnTo?: string }>;
}) {
  const user = await getAuthUser();

  // Signed in, but this device is neither a super admin nor staff anywhere. See below —
  // this is the state that used to bounce forever instead of saying anything.
  let strandedSession = false;

  if (user) {
    if (await isSuperAdmin(user.id)) redirect("/superadmin/dashboard");

    // THE SAME LOOKUP THE PAGE GUARDS USE, deliberately — not a second query that can
    // disagree with them.
    //
    // This page and `requireRestaurantStaff` both answer "is this auth user staff?", and
    // they redirect AT EACH OTHER: a `null` here sends you to /employee/dashboard, and a
    // `null` there sends you back to /login. When the two queries were written separately
    // they drifted (this one had no `deleted_at` filter, no `permissions` column and no
    // `restaurants` embed), so on the self-hosted deployment one succeeded while the other
    // failed and staff ping-ponged between the two URLs with no error anywhere. One
    // predicate, one verdict — they can no longer disagree. Do not re-inline this query.
    const staff = await getCurrentStaff();
    if (staff) {
      redirect(staff.role === "restaurant_admin" ? "/admin/dashboard" : "/employee/dashboard");
    }

    strandedSession = true;
  }

  const { mode, slug } = await searchParams;

  // Fall back to the restaurant this DEVICE last signed into.
  //
  // Without this, a staff member whose session ended lands on the admin email form with no
  // route to their own name-picker and PIN pad — they had to go and find the manager's
  // link again, which is the "rejoin the restaurant" complaint. An explicit `?slug=` still
  // wins, so a manager's link for a DIFFERENT restaurant behaves exactly as before.
  const explicitStaffMode = mode === "staff" && typeof slug === "string" && slug.length > 0;
  const effectiveSlug = explicitStaffMode ? slug! : mode ? null : await lastRestaurantSlug();

  const staff = effectiveSlug ? await getRestaurantStaff(effectiveSlug) : null;

  // An EXPLICIT link keeps staff mode even when the lookup fails, so a wrong or deactivated
  // slug still says "Restaurant not found" instead of quietly showing the admin form. A
  // REMEMBERED slug that no longer resolves degrades silently — the device simply forgets.
  const isStaffMode = explicitStaffMode || !!staff;

  return (
    <div className="w-full max-w-[440px] mx-auto">
      {/* The brand lives in the auth layout (panel on desktop, header on phones). */}

      {/* Offered here and nowhere else: it is the one screen a staff member is
          looking at while NOT mid-service. It hides itself when already installed,
          when dismissed, and in browsers with no install path at all. */}
      <InstallPrompt />

      <div className="rounded-3xl border border-[#e3e8ee] bg-white px-5 py-7 shadow-[0_24px_60px_-28px_rgba(11,18,48,0.35)] sm:px-9 sm:py-9">
        {strandedSession ? (
          /* A valid session that resolves to nobody — the state that used to loop.
             Say so, and offer the one action that fixes it. Signing out has to be a
             button, not something this render does: a Server Component cannot write
             cookies (see lib/supabase/server.ts), so the clear must come from an action. */
          <div className="text-center py-4">
            <h1
              className="text-lg mb-2"
              style={{ color: "var(--color-ink)", fontWeight: 400, letterSpacing: "-0.3px" }}
            >
              You&apos;re signed in, but this account has no access
            </h1>
            <p className="text-sm mb-5" style={{ color: "var(--color-ink-mute)" }}>
              It may have been deactivated or removed from this restaurant. Sign out and sign
              back in with your PIN, or ask your manager to check your account.
            </p>
            <form action={signOutStrandedSession}>
              <button
                type="submit"
                className="w-full rounded-lg py-3 text-sm"
                style={{ background: "var(--color-primary)", color: "#fff" }}
              >
                Sign out
              </button>
            </form>
          </div>
        ) : isStaffMode && staff ? (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#0d1b33]">Staff sign in</h1>
              <p className="mt-1 text-sm text-[#64748d]">Pick your name, then enter your PIN</p>
            </div>
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
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#0d1b33] sm:text-[28px]">
              Welcome back
            </h1>
            <p className="mt-1 mb-7 text-sm text-[#64748d]">
              Sign in as a restaurant owner or manager
            </p>
            <AdminLoginForm />
            {/* The way back in for staff who have no manager's link — see RestaurantSearch. */}
            <RestaurantSearch />
          </>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-[#64748d]">
        New to HRestroSewa?{" "}
        <Link href="/#pricing" className="font-semibold text-[#15803d] hover:underline">
          See plans &amp; pricing
        </Link>
      </p>
      <div className="flex justify-center mt-5">
        <PoweredBy height={16} />
      </div>
    </div>
  );
}
