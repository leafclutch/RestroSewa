# Advanced Payout (Rota-based payroll) — Plan

## Context
RestroSewa is gaining foreign (UK/US) clients whose restaurants pay staff **by the hour from a weekly rota** (see `public/WhatsApp Image … .jpeg` — Mon–Sun grid, role codes GM/AM/DM/TL/TM, times like `17:00–01:30` crossing midnight, *Holiday*, *Sickness (SSP only)*; and `public/IMG_8706.PNG` — staff "My Rotas" weekly view).
Today every restaurant uses the monthly-salary / 30-day-cycle payroll (`lib/payroll.ts`, `app/actions/payroll.ts`, `/admin/staff`). We add a per-restaurant **payout mode** chosen by the super admin:
- **Default staff payout** — the current system, unchanged (default for everyone, incl. existing clients).
- **Advanced payout** — rota system: shifts × hourly rate, per pay period, with Unpaid / Partial / Paid status.

Decisions confirmed with user:
- Paid hours = planned rota shift, **manager may edit actual start/end** afterwards. No clock-in.
- Pay period frequency is **per restaurant**: weekly / fortnightly / monthly.
- Each shift has **unpaid break minutes**; **Holiday** can carry paid hours; **Sick** is unpaid in-app (SSP handled outside).
- Staff get a **read-only "My Rota"** reachable from the staff top navbar to check their shifts.

Out of scope (v1): tax/NI/pension, overtime multipliers, clock-in, shift-swap requests, per-restaurant timezone (app is Nepal-time everywhere — flagged as follow-up, rota itself stores plain dates/times so it isn't affected).

## Data model — new migration `supabase/migrations/20261014000000_rota_payroll.sql`
1. `restaurants.settings` JSON (already holds `currency`, see `app/actions/settings.ts:407-441`) gains:
   - `payout_mode`: `"standard" | "advanced"` (missing ⇒ standard)
   - `rota_pay_period`: `"weekly" | "fortnightly" | "monthly"` (default weekly)
   - `rota_week_start`: `1` (Monday) default
   Stored in settings JSON → no column migration, existing restaurants untouched.
2. `staff_hourly_rates` (restaurant_id, restaurant_user_id, hourly_rate numeric(12,2), effective_from date, unique(user, effective_from)) — mirrors `staff_salaries` revision pattern; rate in force on a shift date = latest `effective_from <= shift_date`.
3. `rota_shifts`:
   - restaurant_id, restaurant_user_id, `shift_date` (the day the shift STARTS), `kind` text check in (`shift`,`holiday`,`sick`,`off`)
   - `role_code` text null (GM/TL/TM… free text with presets in UI)
   - `planned_start time`, `planned_end time` (end < start ⇒ ends next day)
   - `actual_start time null`, `actual_end time null` (manager edit; null ⇒ use planned)
   - `break_minutes int default 0`, `paid_hours numeric(5,2) null` (only for holiday; e.g. 8)
   - `hourly_rate_snapshot numeric(12,2)` frozen when the period is locked/paid
   - `notes`, created_by, timestamps; unique(restaurant_user_id, shift_date, planned_start) (allows split shifts)
4. `rota_pay_periods` (restaurant_id, period_start, period_end, `locked_at`, `locked_by`) — stored like `salary_cycles` because frequency can change later and history must not move (same reasoning as `20260824000000_salary_cycles.sql` header).
5. `salary_payments` gains `rota_period_id uuid null references rota_pay_periods`. Rota wage payments are inserted into **`salary_payments`** (salary_month = 1st of period_start month, kind `advance|salary`, method cash/online/mixed) ⇒ `finance_report` ledger picks them up with **no finance change**. `payroll_summary()` outstanding: extend its `owed` CTE to add rota outstanding when restaurant is advanced (keep signature).
6. RLS enabled, service_role grants like existing payroll tables.

## Pure logic — `lib/rota.ts` (+ `lib/rota.test.ts`, run by `npm test`)
- `shiftMinutes(start, end, breakMin)` — handles overnight (`17:00–01:30` = 510 min), never negative.
- `shiftPaidHours(shift)` — shift ⇒ (actual ?? planned) − break; holiday ⇒ `paid_hours ?? 0`; sick/off ⇒ 0.
- `shiftPay(hours, rate)` — round once to 2dp (same rule as `payableAmount` in `lib/payroll.ts:196`).
- `periodContainingRota(date, frequency, weekStart, anchor)` — weekly/fortnightly/monthly windows; reuse `addDays`, `daysBetween`, `dayLabel` from `lib/payroll.ts`.
- `weekDays(weekStart)`, `formatShift("TL", "16:00","01:30")`.
- Reuse `payrollStatus`, `PAYROLL_STATUS_*`, `PAY_METHOD_LABEL`, `PaymentKind` from `lib/payroll.ts`.
- `lib/payout-mode.ts`: `normalizePayoutMode(settings)`, `isAdvancedPayout(...)` — single place for the rule, like `lib/business-type.ts`.

## Server actions — `app/actions/rota.ts`
Guards reuse `requireAdminOrPermission` + `PAYROLL_ACCESS` (`lib/permissions.ts:503`); writing shifts requires `manage_payroll`, reading requires `view_payroll`; each action rejects if restaurant isn't in advanced mode.
- `getRotaWeek(weekStart)` → staff rows × 7 days of shifts.
- `upsertShift`, `deleteShift`, `copyPreviousWeek(weekStart)` (fast rota building).
- `setActualTimes(shiftId, start, end, breakMin)` — manager edits after the shift.
- `setHourlyRate(staffId, rate, effectiveFrom)` / `getHourlyRates(staffId)`.
- `getRotaPayrollSheet(periodStart?)` → per staff: hours, rate, gross, paid, remaining, status; ensures `rota_pay_periods` row exists.
- `recordRotaPayment(staffId, periodId, amount, kind, method, notes)` → inserts into `salary_payments`, locks period rates (snapshot), fires realtime topic like `recordSalaryPayment` (`app/actions/payroll.ts:679`).
- `getMyRota(weekStart)` — employee's own shifts only (no pay figures unless they hold payroll perms).
- Realtime: publish on existing `"staff"` topic so `RealtimeRefresh` pages update.

## Super admin — restaurant create / edit
- `app/(superadmin)/superadmin/restaurants/new/page.tsx` and `[id]/_components/edit-restaurant-form.tsx`: new **"Staff payout"** radio group (same styling as Business type): *Default staff payout* / *Advanced payout (rota, hourly)*; when advanced, show Pay period select (Weekly / Fortnightly / Monthly).
- `app/actions/restaurants.ts` `createRestaurant` (≈l.131) & `updateRestaurant` (≈l.223): read `payout_mode`, `rota_pay_period`, validate, merge into `settings` JSON (don't clobber `currency`).
- Switching mode later is allowed; both datasets are kept, the inactive one is just hidden.

## Admin UI — `/admin/staff`
`app/(admin)/admin/staff/page.tsx`: branch on payout mode.
- standard ⇒ existing `PayrollClient` (unchanged).
- advanced ⇒ new `_components/rota/`:
  - `rota-board.tsx` — week grid like the paper rota (staff rows × Mon–Sun), prev/next week, "Copy last week", tap a cell → shift editor sheet (kind, role code, start, end, break, holiday paid hours, notes). Overnight shown as `TL 16:00–01:30`. Daily & weekly hour totals per staff.
  - `shift-editor.tsx` — create/edit/delete + "Actual times" section for managers.
  - `rota-payroll.tsx` — period selector, table: staff · hours · rate · gross · paid · remaining · status chip; Pay / Advance button opening payment dialog (reuse the method/kind UI pattern from `payroll-client.tsx`).
  - `hourly-rate-setup.tsx` — per-staff rate with effective-from history (pattern from `payroll-setup.tsx`).
- Mobile-first layout: grid horizontally scrolls inside its card only (no page scroll), follows `DESIGN.md` tokens.
- Employee-side `/employee/payroll` (`app/(employee)/employee/payroll`) and dashboard `payroll-section.tsx` branch the same way for managers with payroll perms.

## Staff "My Rota"
- `app/(employee)/employee/_components/staff-nav.tsx`: add a **"My Rota"** icon/button in the top navbar (only when restaurant is advanced) → `/employee/rota`.
- New `app/(employee)/employee/rota/page.tsx`: weekly cards like the screenshot (week tabs, each day with `17:00–01:30`, role, break, total hours for week; Holiday / Sick badges; "Shift times may be subject to change"). Read-only, any logged-in staff, own shifts only.

## Docs
- Spec copy to `docs/superpowers/specs/2026-10-14-rota-payout-design.md`.
- Update `memory-bank/modules/staff.md`, `memory-bank/database.md`, `memory-bank/changelog.md`.

## Verification
1. `npm test` — new `lib/rota.test.ts` (overnight, break, holiday paid hours, sick=0, rate revision mid-period, weekly/fortnightly/monthly period boundaries, rounding).
2. `npm run migrate:up` on dev (via session pooler per memory) → `npm run migrate` shows applied; do **not** touch prod until user says so.
3. `npm run lint` + `npx tsc --noEmit`.
4. `npm run dev` and in Chrome:
   - Super admin: create restaurant with Advanced payout + Weekly; edit existing one → still Default, currency preserved.
   - Admin `/admin/staff` on advanced restaurant: build week (incl. 17:00–01:30, holiday 8h, sick), copy week, set rates, edit actual times → hours/gross correct; record partial then full payment → status Partial → Paid; Finance ledger shows the wage payment.
   - Default-mode restaurant: `/admin/staff` unchanged.
   - Employee login: "My Rota" in navbar shows own shifts only, no pay figures.

## Deviations made during implementation
- **One rota entry per person per day** (unique `restaurant_user_id, shift_date`) — split shifts deferred; keeps a board cell a single editable thing.
- **No `hourly_rate_snapshot`** — instead `setHourlyRate` refuses a rate starting on/before the end of any period the person has already been paid in, so settled periods can't change.
- **No `rota_week_start` setting** — weeks are always Mon–Sun; weekly/fortnightly periods align on Monday 2026-01-05 (`ROTA_PERIOD_ANCHOR`).
- Default-payroll SQL functions re-issued with `rota_period_id is null` filters: `record_salary_payment`, `payroll_cycle_sheet`, `payroll_month`, `payroll_summary` (+ `rota_outstanding`).
