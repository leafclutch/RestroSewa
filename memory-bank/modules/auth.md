# Auth

# Overview
Authentication, session handling, and tenant isolation for admins & staff. See
`architecture.md` → "Authentication flow" for the request-path detail and `decisions.md` →
"local JWT verification" for the why.

# Responsibilities
- Log admins/staff in and resolve the caller into a request-scoped context.
- Enforce **restaurant (tenant) isolation** on every read/write.
- Distinguish super-admin authority from restaurant roles.

# Features
- **Synthetic email + 4-digit PIN** login for admins/staff (`auth-pin-model`); customers have no
  account (see `modules/qr.md`).
- **Local JWT verification** via `getClaims()` (cached JWKS, WebCrypto) — no network `getUser()`
  on the hot path; falls back to `getUser()` on verify error, never returns null.
- Request-memoised caller resolution → `RestaurantUserContext` (id, restaurant_id, role,
  permissions, display_name, closingHour) via `lib/auth/guards.ts`.
- PIN reset + Super Admin settings surface.

# Business Rules
- `restaurant_admin` bypasses permission checks; `restaurant_employee` is gated.
- **super_admin is a separate authority** (`isSuperAdmin`), not a `restaurant_user` — do NOT gate
  super-admin actions on `getRestaurantUser()` (it would reject them).
- Every action/query is scoped by `restaurant_id`; guards redirect unauthenticated/foreign users.
- The PIN is the login secret; the discount PIN is a separate thing (see `modules/settings.md`).

# Important Components
- `lib/auth/current-user.ts` (getAuthUser, getStaffRow, isSuperAdmin — local JWT).
- `lib/auth/guards.ts` (requireRestaurantStaff, requireAdminOrPermission, requireRestaurantAdmin,
  requireSuperAdmin).
- `lib/auth/get-restaurant-user.ts`, `lib/supabase/{server,service}.ts`.
- `app/actions/auth.ts`, `/login`, `/superadmin/login`.

# Database Relations
`restaurant_users.auth_user_id` ↔ Supabase Auth user; role + permissions live on
`restaurant_users`. See `database.md` → "Tenancy & identity".

# Permissions
Auth is the substrate under all permission checks (see `modules/permissions.md`). Role bypass and
tenant scoping happen here.

# Known Limitations
- 4-digit PIN is low-entropy by design (fast floor login); protected by the synthetic-email
  namespace + per-restaurant scoping, not brute-force hardening.

# Future Improvements
- Optional rate-limiting / lockout on repeated bad PINs.
- Optional per-device session management for staff.
