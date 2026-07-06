import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isTenantProtected =
    pathname.startsWith("/admin") || pathname.startsWith("/employee");

  const isSuperAdminProtected =
    pathname.startsWith("/superadmin") && pathname !== "/superadmin/login";

  // Only redirect when we're certain there is no session.
  // If getUser() returned an error (network/transient failure), pass through —
  // the page-level guards will enforce auth correctly on the next render.
  if (!error && !user) {
    if (isTenantProtected) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (isSuperAdminProtected) {
      return NextResponse.redirect(new URL("/superadmin/login", request.url));
    }
  }

  return supabaseResponse;
}

export const proxyConfig = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|c/).*)"],
};
