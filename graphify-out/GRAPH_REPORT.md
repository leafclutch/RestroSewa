# Graph Report - RestroSewa  (2026-08-27)

## Corpus Check
- Large corpus: 466 files · ~732,734 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 2252 nodes · 6024 edges · 172 communities (125 shown, 47 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 151 edges (avg confidence: 0.88)
- Token cost: 346,341 input · 61,118 output

## Community Hubs (Navigation)
- Payroll Actions
- Security & Settings
- Expenses & Savings Actions
- Stock Management Actions
- Purchases Actions
- Mock Bill Client
- Menu Management Actions
- POS Session Actions
- Credit Payments Actions
- Security PIN Operations
- Finance Actions & Client
- Room Admin Actions
- Table Admin Actions
- Customer Menu UI
- Deductions Client
- Sales Reporting
- TS Config & Next Types
- Admin Dashboard Sections
- Menu Browser Client
- Vendors Actions
- Business Day Utilities
- Deduction Report & Menu Items
- Notifications Actions
- Staff Management Actions
- Order Ticket Printing
- Room Folio & Advances
- Room & Table Dashboard Analytics
- Restaurant Admin Actions
- Staff & Workstations Pages
- Auth Actions
- Room Bill Ticket UI
- Expense Categories & Daily Summary
- Staff Form UI
- Room Check-in Grid UI
- NPM UI Dependencies
- Notification Visibility & Push Payload
- Restaurant Setup Reset
- Room & Session Overview Actions
- Subscription Expiry Cron
- Advances & Expenses DB Tables
- DB Clone Script
- Order Item Status UI
- Web Push Subscriptions
- Room Advance Payments Plan
- Lint & Tooling Dependencies
- Email Mailer Service
- Room Billing Folio Builder
- Table Session Grid UI
- Custom Items DB & Decisions
- Admin Sidebar Nav
- Customer Actions
- Session Order Actions
- Parity Verification Script
- Dashboard Analytics Actions
- Auth Forms UI
- Super Admin Auth Route
- Extra Income Actions
- Order Queue UI
- Realtime Route
- shadcn/ui Config
- Report PDF Builder
- Modal & Dialog UI
- Order Session Print Types
- Assignments & Permissions
- Menu Import Script
- DB Migration Script
- Restaurant Onboarding UI
- Active Room Stays UI
- App Layouts
- Sessions Table & Module Docs
- PWA Asset Generator
- Notification Dispatch
- Session Transfer Logic
- Marketing Landing Page
- Room Bill Builder
- Custom Items Resolution
- NPM Scripts
- DB Structure Diff Script
- Restaurant Branding Actions
- Finance Reporting Actions
- Stock Client & Options
- Advance Payment Fields UI
- Root App Layout
- Realtime Connection Hook
- Stripi Design System
- Assignment Visibility Scope
- Storage Copy Script
- Notification Preferences UI
- Session Split View Layout
- Customer Activation State
- Customer Cart & Order UI
- Derived Balances Permissions
- Security PIN Authorization Service
- Current User & Auth Helpers
- Report PDF Styling Constants
- Room Day Settings UI
- Daily Summary Cron Route
- DB Environments & Cancellation Log
- Postgres HTTP Client Script
- Restaurant Detail Page
- Daily Finance Report Setup
- Memory Bank Docs Index
- Checkout Form Handlers
- Offline Screen UI
- Food Type Marks
- Menu Data Model Rules
- Room Bill Rendering Rules
- Room Billing Unification Docs
- Payment & Purchase Edit RPCs
- Unit Cancellation Event Log
- Package Metadata
- Auth Proxy Redirect
- Web Manifest Route
- Room Checkout Discount
- Derived State Principles
- Auth Flow JWT & PIN
- Next Config Image Host
- Production Migration Runbook
- RPC Signature Change Rule
- Enum Migration Rule
- Check-in RPC Params
- Security PIN Audit Design
- Saving Titles Table
- ESLint Config
- lucide-react Dependency
- Finance & Stock Flow Docs
- Folder & Admin Overview
- Performance & Race Conditions
- Extra Expenses Changelog
- Cancelled-at Semantics
- Cancellation Idempotency Rule
- Mock Bill Isolation Rule
- Saving Pot Reset Rule
- nodemailer Dependency
- pdf-lib Dependency
- react-dom Dependency
- server-only Dependency
- supabase-js Dependency
- tailwind-merge Dependency
- web-push Dependency
- PostCSS Config
- User Role Type
- Migration Script Entry
- Credit Bill Advance RPC
- Room Advance RPC
- Accrual Rule Note
- Advances Held Balance
- No Back-dating Rule
- Saving as Category Rule
- Billing Flow Note
- Modal Layout Bug Fix
- Dark Mode CSS Bug
- Pull-to-refresh Fix
- Thermal Print Width Fix
- Room Night Boundary Rule
- Assignment Visibility Source of Truth
- Restaurant Cascade Delete Rule
- Close Bills Permission
- Process Payments Permission

## God Nodes (most connected - your core abstractions)
1. `createServiceClient()` - 296 edges
2. `getRestaurantUser()` - 169 edges
3. `hasPermission()` - 77 edges
4. `requireRestaurantStaff()` - 55 edges
5. `Button` - 48 edges
6. `buildVisibilityFilter()` - 39 edges
7. `Input` - 34 edges
8. `getRestaurantConfig()` - 33 edges
9. `useRealtime()` - 32 edges
10. `getWorkstations()` - 29 edges

## Surprising Connections (you probably didn't know these)
- `Timezone: yesterday shows in today's sales` --semantically_similar_to--> `Why */15 not 0 * * * *`  [INFERRED] [semantically similar]
  memory-bank/bugs.md → docs/daily-summary-setup.md
- `Completed: 45-minute delay fixed (pg_cron GMT)` --semantically_similar_to--> `Why */15 not 0 * * * *`  [INFERRED] [semantically similar]
  memory-bank/completed.md → docs/daily-summary-setup.md
- `workstation_id derived from category` --semantically_similar_to--> `A product's workstation is metadata, not mechanism`  [INFERRED] [semantically similar]
  docs/menu-import.md → memory-bank/decisions.md
- `DB before app golden rule` --semantically_similar_to--> `Current: Unit-wise cancellation`  [INFERRED] [semantically similar]
  docs/runbooks/migrating-to-production.md → memory-bank/current-task.md
- `alter type add value must be alone in its file` --semantically_similar_to--> `Enum ADD VALUE and its first use cannot share a migration`  [INFERRED] [semantically similar]
  docs/runbooks/migrating-to-production.md → memory-bank/decisions.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **payments.advance_amount lockstep readers** — docs_superpowers_specs_2026_08_11_room_advance_payments_design_check_out_room, docs_superpowers_specs_2026_08_11_room_advance_payments_design_close_bill_with_credit, docs_superpowers_specs_2026_08_11_room_advance_payments_design_edit_payment_tender, docs_superpowers_specs_2026_08_11_room_advance_payments_design_finance_transactions, memory_bank_database_payments_table [INFERRED 0.85]
- **Signed-row pattern implementations (advances, savings)** — docs_superpowers_plans_2026_08_11_room_advance_payments_signed_rows_rationale, docs_superpowers_specs_2026_08_13_extra_expenses_design_withdrawal_negative_row, memory_bank_database_room_advances_table, memory_bank_database_extra_expenses_table [INFERRED 0.85]
- **Unit-wise cancellation model components** — memory_bank_current_task_counters_plus_event_log, memory_bank_current_task_cas_idempotency, memory_bank_current_task_cancelled_at_meaning_preserved, memory_bank_database_session_order_item_cancellations_table, memory_bank_decisions_unit_cancellation_counters_and_log [INFERRED 0.85]
- **Security PIN Authorization Service Operations** — memory_bank_modules_security_pin_lib_security_authorize_ts, memory_bank_modules_security_pin_open_mock_bill, memory_bank_modules_permissions_cancel_room_stay, memory_bank_modules_security_pin_set_opening_balance, memory_bank_modules_security_pin_edit_payment_tender, memory_bank_modules_security_pin_edit_purchase [INFERRED 0.85]
- **Derived-State Architecture Pattern (never store, always compute)** — memory_bank_modules_stock_derived_stock_model, memory_bank_modules_finance_four_derived_balances, memory_bank_modules_tables_session_lifecycle, memory_bank_modules_finance_advances_held_fifth_balance [INFERRED 0.85]
- **SSE Realtime Channel Consumers** — memory_bank_modules_realtime_use_realtime_hook, memory_bank_modules_tables_module, memory_bank_modules_stock_module, memory_bank_modules_notifications_module, memory_bank_modules_rooms_module, memory_bank_modules_walkins_module [INFERRED 0.75]

## Communities (172 total, 47 thin omitted)

### Community 0 - "Payroll Actions"
Cohesion: 0.06
Nodes (75): ActionResult, EMPTY_CYCLE_SHEET(), EMPTY_SHEET(), getCycleAttendance(), getPayrollCycleSheet(), getPayrollHistory(), getPayrollSheet(), normaliseDay() (+67 more)

### Community 1 - "Security & Settings"
Cohesion: 0.07
Nodes (63): getSecurityAuditLog(), getSecurityPinStatus(), updateSecurityPin(), ActionResult, BillingSettings, BusinessDaySettings, getBillingSettings(), getBusinessDaySettings() (+55 more)

### Community 2 - "Expenses & Savings Actions"
Cohesion: 0.07
Nodes (50): ActionResult, addExtraExpense(), addSaving(), closeSavingTitle(), createSavingTitle(), deleteSavingTitle(), EMPTY_EXPENSE_SUMMARY, ExpenseSummary (+42 more)

### Community 3 - "Stock Management Actions"
Cohesion: 0.07
Nodes (47): ActionResult, adjustStock(), createProduct(), deleteProduct(), getMenuItemLinks(), getProductDetail(), getProductHistory(), linkMenuItem() (+39 more)

### Community 4 - "Purchases Actions"
Cohesion: 0.10
Nodes (41): ActionResult, getPurchaseDetail(), getPurchaseLines(), getPurchases(), getPurchaseSummary(), getVendorOptions(), ItemInput, PurchaseDetail (+33 more)

### Community 5 - "Mock Bill Client"
Cohesion: 0.09
Nodes (35): BillItem, MockBillClient(), CARD_STYLE, DOWN_TENDERS, HAIRLINE, METHODS, MockBillEditor(), rupee() (+27 more)

### Community 6 - "Menu Management Actions"
Cohesion: 0.11
Nodes (38): ActionResult, AddonRow, AvailabilityStatus, createAddon(), createCategory(), createMenuItem(), createVariant(), deleteAddon() (+30 more)

### Community 7 - "POS Session Actions"
Cohesion: 0.09
Nodes (33): ActiveSessionPin, clearSessionPin(), csvCell(), exportSalesCsv(), getActiveSessionsWithPins(), getMyWalkIns(), getPaidBill(), getSalesReport() (+25 more)

### Community 8 - "Credit Payments Actions"
Cohesion: 0.10
Nodes (33): ActionResult, addCreditPayment(), CreditBill, CreditCustomerDetail, CreditFilter, CreditPaymentEntry, CreditReceipt, EMPTY_STATS (+25 more)

### Community 9 - "Security PIN Operations"
Cohesion: 0.12
Nodes (33): setOpeningBalance(), unlockMockBill(), UnlockResult, cancelRoomStay(), EDIT_ERRORS, friendlyAdvanceError(), friendlyEditError(), getPaymentTender() (+25 more)

### Community 10 - "Finance Actions & Client"
Cohesion: 0.11
Nodes (30): ActionResult, csvCell(), EMPTY(), OpeningBalance, PURCHASE_METHOD_LABEL, IncomeMethod, IncomeRow(), LedgerRow() (+22 more)

### Community 11 - "Room Admin Actions"
Cohesion: 0.11
Nodes (28): ActionResult, createRoom(), createRoomType(), deleteRoom(), deleteRoomType(), regenerateRoomQr(), RoomDaySettings, RoomRow (+20 more)

### Community 12 - "Table Admin Actions"
Cohesion: 0.12
Nodes (25): ActionResult, createTable(), createTableGroup(), deleteTable(), deleteTableGroup(), getTablesWithGroups(), GroupWithTables, regenerateTableQr() (+17 more)

### Community 13 - "Customer Menu UI"
Cohesion: 0.08
Nodes (15): verifyCustomerPin(), CATEGORY_ICONS, FoodKey, isSpicy(), ItemCard(), keyOf(), LineKey, NotifEntry (+7 more)

### Community 14 - "Deductions Client"
Cohesion: 0.14
Nodes (23): DeductionReport, WorkstationRow, DeductionsClient(), money(), money2(), PERIODS, REASON_COLOR, reasonColor() (+15 more)

### Community 15 - "Sales Reporting"
Cohesion: 0.09
Nodes (25): SalesPeriod, SalesReport, SalesTxn, bucketLabel(), DateGrain, daysBetween(), EMPTY_CREDIT_STATS, grainFor() (+17 more)

### Community 16 - "TS Config & Next Types"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts (+20 more)

### Community 17 - "Admin Dashboard Sections"
Cohesion: 0.16
Nodes (20): getExpenseSummary(), ExpensesSection(), rupee(), PayrollSection(), rupee(), PurchasesSection(), rupee(), DashboardSection (+12 more)

### Community 18 - "Menu Browser Client"
Cohesion: 0.11
Nodes (24): CategoryRow, VariantRow, ActionResult, CartItem, MenuClient(), CustomLine, keyOf(), LineKey (+16 more)

### Community 19 - "Vendors Actions"
Cohesion: 0.16
Nodes (21): ActionResult, getVendorDetail(), getVendors(), getVendorSummary(), PAYMENT_METHODS, RPC_ERRORS, sanitizeSearch(), toRow() (+13 more)

### Community 20 - "Business Day Utilities"
Cohesion: 0.16
Nodes (24): addBusinessDays(), addDaysStr(), businessDate(), businessDayStart(), BusinessPeriod, businessPeriodBounds(), businessPeriodDateBounds(), businessToday() (+16 more)

### Community 21 - "Deduction Report & Menu Items"
Cohesion: 0.19
Nodes (17): getDeductionReport(), getAllMenuItems(), getMenuCategories(), getMenuItemsByCategory(), MenuItemRow, normalizeItem(), getWorkstations(), DeductionsPage() (+9 more)

### Community 22 - "Notifications Actions"
Cohesion: 0.14
Nodes (23): acknowledgeNotification(), ActivationSummaryItem, assertCanActOn(), completeNotification(), getActiveNotifications(), getMyNotifications(), getNotificationCount(), NotificationRow (+15 more)

### Community 23 - "Staff Management Actions"
Cohesion: 0.16
Nodes (21): createStaffMember(), deleteStaffMember(), DENIED, parsePermissions(), requireStaffManagerOf(), requireSuperAdminGuard(), resetStaffPin(), softDeleteStaffMember() (+13 more)

### Community 24 - "Order Ticket Printing"
Cohesion: 0.14
Nodes (22): generateOrderTicket(), generateVoidTicket(), getPendingVoids(), OrderTicketRow, VoidTicketLine, WorkstationRow(), TicketCodeField(), Line() (+14 more)

### Community 25 - "Room Folio & Advances"
Cohesion: 0.14
Nodes (20): PaidBill, addRoomAdvance(), RoomAdvance, RoomFolioView, setRoomPriceShift(), AddAdvanceForm(), AddChargeForm(), EditAdvanceButton() (+12 more)

### Community 26 - "Room & Table Dashboard Analytics"
Cohesion: 0.18
Nodes (23): getDashboardAnalytics(), markTableClean(), getMutedCategories(), addRoomCharge(), getRoomDaySettings(), getRoomTypesWithRooms(), checkOutRoom(), getActiveStays() (+15 more)

### Community 27 - "Restaurant Admin Actions"
Cohesion: 0.14
Nodes (15): ActionResult, getAllRestaurants(), RestaurantDetail, RestaurantRow, toggleRestaurantStatus(), updateRestaurant(), SuperAdminDashboardPage(), TIER_COLORS (+7 more)

### Community 28 - "Staff & Workstations Pages"
Cohesion: 0.12
Nodes (19): AdminStaffPage(), AssignmentRow, StaffRow, WorkstationsPage(), EmployeeDashboardPage(), requireAdminOrPermission(), getStaffNav(), hasAllPermissions() (+11 more)

### Community 29 - "Auth Actions"
Cohesion: 0.17
Nodes (18): getRestaurantStaff(), lastRestaurantSlug(), loginWithEmail(), loginWithPin(), minutesLeft(), rememberRestaurant(), searchRestaurants(), signOutStrandedSession() (+10 more)

### Community 30 - "Room Bill Ticket UI"
Cohesion: 0.13
Nodes (21): BillCredit, BillCustomer, BillPayment, BillSection, BillStay, BillTicket(), CreditReceiptEntry, CreditReceiptTicket() (+13 more)

### Community 31 - "Expense Categories & Daily Summary"
Cohesion: 0.15
Nodes (20): RFC-5322, expenseCategoryLabel(), ExpenseCategoryTotal, isExpenseCategory(), buildDailySummary(), DailySummaryModel, EMAIL_RE, MAX_SUMMARY_EMAILS (+12 more)

### Community 32 - "Staff Form UI"
Cohesion: 0.19
Nodes (10): ActionResult, AddStaffForm(), KEYPAD, EditPermissionsForm(), KEYPAD, PermissionPicker(), PresetPicker(), BusinessType (+2 more)

### Community 33 - "Room Check-in Grid UI"
Cohesion: 0.16
Nodes (18): SessionTransferRow, checkInRoom(), markRoomClean(), RoomOverview, CheckInModal(), RoomCard, rupee(), untilNextNight() (+10 more)

### Community 34 - "NPM UI Dependencies"
Cohesion: 0.10
Nodes (21): class-variance-authority, clsx, next, dependencies, class-variance-authority, clsx, next, pg (+13 more)

### Community 35 - "Notification Visibility & Push Payload"
Cohesion: 0.18
Nodes (19): canSeeNotification(), canSeeWorkstationEvent(), getAssignedWorkstationIds, categoryOf(), buildPushPayload(), describeItems(), FOCUS, NotifiableRow (+11 more)

### Community 36 - "Restaurant Setup Reset"
Cohesion: 0.17
Nodes (15): deleteRestaurantSetup(), getRestaurantSummary(), resetRestaurantFinance(), RestaurantSummary, revalidateEverything(), setOpeningBalanceFor(), count(), DangerZone() (+7 more)

### Community 37 - "Room & Session Overview Actions"
Cohesion: 0.18
Nodes (16): getSessionDetail(), getTableStatusOverview(), ActionResult, getRoomFolio(), getRoomsOverview(), loadStayPayment(), RawAdvance, RoomStayInfo (+8 more)

### Community 38 - "Subscription Expiry Cron"
Cohesion: 0.17
Nodes (16): StaffRow, updateSubscriptionDates(), authorised(), dynamic, notFound(), POST(), runtime, Detail (+8 more)

### Community 39 - "Advances & Expenses DB Tables"
Cohesion: 0.14
Nodes (20): extra_expenses table, finance_openings table, room_advances table, room_stays table, Advances held (fifth balance), Extra expenses feature, Extra income feature, Ledger colours by direction, not kind (+12 more)

### Community 40 - "DB Clone Script"
Cohesion: 0.14
Nodes (18): args, AUTH_TABLES, baseTables(), columns(), confirmed, connect(), copyTable(), dryRun (+10 more)

### Community 41 - "Order Item Status UI"
Cohesion: 0.30
Nodes (16): updateOrderItemStatus(), OrderItem(), doCancel(), STATUS_COLOR, STATUS_LABEL, activeQuantity(), cancellableQuantity(), cancelledQuantity() (+8 more)

### Community 42 - "Web Push Subscriptions"
Cohesion: 0.20
Nodes (14): BrowserSubscription, isPushSubscribed(), sendTestPush(), subscribeToPush(), unsubscribeFromPush(), BeforeInstallPromptEvent, InstallPrompt(), PushPrompt() (+6 more)

### Community 43 - "Room Advance Payments Plan"
Cohesion: 0.12
Nodes (19): Room Advance Payments Plan, room_advances table (plan), Signed room_advances rows, is_custom explicit marker, manage_custom_items permission, resolveCustomItems(), session_order_items immutable snapshot, Security PIN (+11 more)

### Community 44 - "Lint & Tooling Dependencies"
Cohesion: 0.11
Nodes (19): eslint, @next/eslint-plugin-next, devDependencies, eslint, @next/eslint-plugin-next, tailwindcss, @tailwindcss/postcss, @types/node (+11 more)

### Community 45 - "Email Mailer Service"
Cohesion: 0.21
Nodes (16): EmailAttachment, getTransport(), WHY: DigitalOcean silently DROPS outbound packets on every SMTP port to every, sendEmail(), SendEmailInput, SendResult, sendViaResend(), sleep() (+8 more)

### Community 46 - "Room Billing Folio Builder"
Cohesion: 0.13
Nodes (17): buildFolio(), CHARGE_LABEL, CHARGE_TYPES, ExtraInput, FolioConfig, FoodInput, money(), MS_PER_NIGHT (+9 more)

### Community 47 - "Table Session Grid UI"
Cohesion: 0.17
Nodes (14): getMyTables(), openTableSession(), TableStatus, NUMBER_STYLE, NUMBER_STYLE_COMPACT, TableCard, TablesGrid(), OpenTablePage() (+6 more)

### Community 48 - "Custom Items DB & Decisions"
Cohesion: 0.16
Nodes (18): order_tickets table, restaurants table, session_order_items table, workstations table, Decisions Log, lib/custom-items.ts (resolveCustomItems), lib/order-items.ts, Custom Items Module (+10 more)

### Community 49 - "Admin Sidebar Nav"
Cohesion: 0.17
Nodes (14): logout(), AdminSidebar(), handleLogout(), isActive(), NAV, NavItem, NavLink(), NavLinks() (+6 more)

### Community 50 - "Customer Actions"
Cohesion: 0.17
Nodes (16): ActivationRequestResult, CustomerCartItem, CustomerNotifState, CustomerOrder, CustomerOrderFeed, CustomerOrderItem, CustomerOrderStatus, ensureCustomerSession() (+8 more)

### Community 51 - "Session Order Actions"
Cohesion: 0.18
Nodes (14): canAccessSession(), cancelOrder(), cancelOrderItem(), closeSessionWithPayment(), forceCloseSession(), submitOrder(), walkInWriteBlocked(), PaymentForm() (+6 more)

### Community 52 - "Parity Verification Script"
Cohesion: 0.17
Nodes (14): args, bad(), canon(), diff(), LEGACY_SERVICE_ROLE_GRANT(), main(), noSsl, ok() (+6 more)

### Community 53 - "Dashboard Analytics Actions"
Cohesion: 0.17
Nodes (10): DashboardAnalytics, DashboardStats, EMPTY_STATS, RecentPurchase, RecentSale, ActionResult, METHOD_LABEL, money() (+2 more)

### Community 54 - "Auth Forms UI"
Cohesion: 0.30
Nodes (8): AuthResult, ActionResult, Button, ButtonProps, buttonVariants, Input, InputProps, cn()

### Community 55 - "Super Admin Auth Route"
Cohesion: 0.21
Nodes (12): loginWithEmailSuperAdmin(), authorisedByToken(), dynamic, GET(), runtime, stats(), SuperAdminLoginForm(), SuperAdminLoginPage() (+4 more)

### Community 56 - "Extra Income Actions"
Cohesion: 0.17
Nodes (12): ActionResult, addExtraIncome(), ExtraIncome, mapIncome(), resolveIncomeSplit(), resolveAdvanceSplit(), AddIncomeForm(), resolveSplit() (+4 more)

### Community 57 - "Order Queue UI"
Cohesion: 0.17
Nodes (13): byCreatedThenId(), getMyOrderQueue(), QueueOrder, QueueOrderItem, OrdersSection(), OrdersBody(), locationLabel(), OrderCard() (+5 more)

### Community 58 - "Realtime Route"
Cohesion: 0.19
Nodes (14): dynamic, GET(), resolveRestaurant(), runtime, getCurrentStaff, Bus, connect(), dispatch() (+6 more)

### Community 59 - "shadcn/ui Config"
Cohesion: 0.13
Nodes (14): aliases, components, hooks, lib, ui, utils, rsc, $schema (+6 more)

### Community 61 - "Modal & Dialog UI"
Cohesion: 0.21
Nodes (9): logoutSuperAdmin(), ConfirmDialog(), Modal(), Sheet(), SuperAdminLayout(), NAV, SuperAdminSidebar(), handleLogout() (+1 more)

### Community 62 - "Order Session Print Types"
Cohesion: 0.15
Nodes (13): CreditCustomer, OrderItemRow, SessionDetail, updateWalkInCustomer(), RestaurantInfo, PrintStation, DOWN_TENDERS, DownTender (+5 more)

### Community 63 - "Assignments & Permissions"
Cohesion: 0.20
Nodes (14): payments table, Assignment scoping (who sees which tables/rooms), lib/assignments.ts, lib/permissions.ts, manage_expenses permission, manage_payroll permission, manage_walkins permission, Permissions Module (+6 more)

### Community 64 - "Menu Import Script"
Cohesion: 0.14
Nodes (11): args, catByName, confirmed, dryRun, env, envFile, file, itemByName (+3 more)

### Community 65 - "DB Migration Script"
Cohesion: 0.19
Nodes (13): applied(), args, confirmed, connect(), DIR, ensureLedger(), envIdx, files() (+5 more)

### Community 66 - "Restaurant Onboarding UI"
Cohesion: 0.18
Nodes (9): createRestaurant(), BusinessType, NewRestaurantPage(), onNameInput(), Tier, TIER_DEFAULTS, TIERS, toSlug() (+1 more)

### Community 67 - "Active Room Stays UI"
Cohesion: 0.21
Nodes (9): ActiveStay, ActiveStaysClient(), rupee(), CancelStayForm(), submit(), CancelTarget, inputStyle, rupee() (+1 more)

### Community 68 - "App Layouts"
Cohesion: 0.24
Nodes (8): AdminLayout(), EmployeeLayout(), viewport, OfflineGate(), insideScrolledContainer(), PullToRefresh(), SubscriptionWatermark(), useOnline()

### Community 69 - "Sessions Table & Module Docs"
Cohesion: 0.29
Nodes (13): sessions table, Architecture Doc, Customer Module, Notifications Module, PWA Module, components/pwa/offline-gate.tsx, Do NOT queue offline writes, QR Module (+5 more)

### Community 70 - "PWA Asset Generator"
Cohesion: 0.23
Nodes (12): DEVICES, entries, LOGO, logoBuf(), makeIcon(), PUBLIC, require, ROOT (+4 more)

### Community 71 - "Notification Dispatch"
Cohesion: 0.21
Nodes (10): sendNotification(), runServiceRequest(), emitGeneralNewOrder(), emitPaymentReceived(), ItemRow, OrderContext, OrderItemRow, ServiceClient (+2 more)

### Community 72 - "Session Transfer Logic"
Cohesion: 0.30
Nodes (9): explain(), getTransferTargets(), mayTransfer(), TransferInput, TransferOptions, transferSession(), TransferTarget, TransferModal() (+1 more)

### Community 73 - "Marketing Landing Page"
Cohesion: 0.29
Nodes (7): FEATURES, ACCENT, BASE, PlatformLogo(), PlatformWordmark(), PoweredBy(), Tone

### Community 74 - "Room Bill Builder"
Cohesion: 0.20
Nodes (10): BillSection, BillSectionLine, BillStay, folioToBill(), RoomBillInput, RoomBillView, folio, toLine() (+2 more)

### Community 75 - "Custom Items Resolution"
Cohesion: 0.20
Nodes (8): CustomItemRequest, resolveCustomItems(), ResolveCustomResult, ResolvedCustomItem, CartRequest, ResolvedOrderItem, resolveOrderItems(), ResolveResult

### Community 76 - "NPM Scripts"
Cohesion: 0.17
Nodes (12): scripts, build, dev, lint, lint:fix, migrate, migrate:prod, migrate:prod:up (+4 more)

### Community 77 - "DB Structure Diff Script"
Cohesion: 0.20
Nodes (10): compare(), DST, m, main(), normalise(), prod, Q, WHY: scripts/verify-parity.mjs compares NAMES, not DEFINITIONS — (+2 more)

### Community 78 - "Restaurant Branding Actions"
Cohesion: 0.38
Nodes (8): ActionResult, ALLOWED, bucketPathOf(), removeRestaurantLogo(), revalidateBranding(), uploadRestaurantLogo(), LogoUploader(), requireSuperAdmin()

### Community 79 - "Finance Reporting Actions"
Cohesion: 0.53
Nodes (10): exportFinanceCsv(), getFinanceReport(), getFinanceTransactions(), getOpeningBalance(), getPeriodPurchases(), listExtraIncome(), getPayrollSummary(), FinanceClient() (+2 more)

### Community 80 - "Stock Client & Options"
Cohesion: 0.47
Nodes (9): getLinkTargets(), getProductOptions(), getStock(), getStockSummary(), money(), StockClient(), StockPage(), EmployeeStockPage() (+1 more)

### Community 81 - "Advance Payment Fields UI"
Cohesion: 0.25
Nodes (8): ADVANCE_METHODS, AdvanceFields(), AdvanceMethod, LABEL, PaymentMethod, PaymentMethodPicker(), round2(), splitIsValid()

### Community 82 - "Root App Layout"
Cohesion: 0.24
Nodes (6): inter, metadata, viewport, RegisterServiceWorker(), ThemeSync(), APPLE_SPLASH

### Community 83 - "Realtime Connection Hook"
Cohesion: 0.27
Nodes (9): RealtimeRefresh(), acquire(), Conn, conns, dispatch(), open(), Subscriber, Topic (+1 more)

### Community 84 - "Stripi Design System"
Cohesion: 0.18
Nodes (11): button-primary-pill Component, Gradient Mesh Backdrop, Sohne Thin Typography, Stripi Design Language, Tabular-Figure Money Type, advance_amount lockstep invariant, check_out_room (spec), close_bill_with_credit (spec) (+3 more)

### Community 85 - "Assignment Visibility Scope"
Cohesion: 0.27
Nodes (10): Assignments, buildVisibilityFilter(), loadAssignments, makeFilter(), resolveViewerScope(), SEES_EVERYTHING, StaffViewer, ViewerScope (+2 more)

### Community 86 - "Storage Copy Script"
Cohesion: 0.20
Nodes (9): args, confirmed, main(), noSsl, readEnv(), ROOT, sourceEnv, targetEnv (+1 more)

### Community 87 - "Notification Preferences UI"
Cohesion: 0.33
Nodes (8): setCategoryEnabled(), NotificationPreferences(), ALL_CATEGORIES, CATEGORY_HINT, CATEGORY_OF, isCategory(), NOTIFICATION_CATEGORIES, NotificationCategory

### Community 88 - "Session Split View Layout"
Cohesion: 0.33
Nodes (5): NAV_HEIGHT, RAIL_BOX_WIDTH, SessionSplitView(), SessionLayout(), AddItemsMenuData

### Community 89 - "Customer Activation State"
Cohesion: 0.36
Nodes (8): ActivationStatus, getCustomerActivationState(), getCustomerNotifState(), getAvailableVariants(), poll(), QrSplash(), CustomerMenuPage(), isItemOnMenuNow()

### Community 90 - "Customer Cart & Order UI"
Cohesion: 0.25
Nodes (6): checkSessionActive(), CartDrawer(), CustomerMenu(), buildOrderItems(), iconForCategory(), parseKey()

### Community 91 - "Derived Balances Permissions"
Cohesion: 0.22
Nodes (9): purchases table, Four derived balances model, manage_purchases permission, manage_stock permission, manage_vendors permission, view_stock permission, Derived stock model, Stock Module (+1 more)

### Community 92 - "Security PIN Authorization Service"
Cohesion: 0.33
Nodes (9): security_audit_log table, cancel_room_stay permission/operation, Reusable Security PIN authorization service, edit_payment_tender operation, edit_purchase operation, lib/security/authorize.ts, Security PIN Module, open_mock_bill security operation (+1 more)

### Community 93 - "Current User & Auth Helpers"
Cohesion: 0.33
Nodes (7): AuthIdentity, getStaffRow, StaffRow, flushPerf(), perfEnabled, span, store

### Community 94 - "Report PDF Styling Constants"
Cohesion: 0.22
Nodes (8): A4, FAINT, HAIR, HEADING, INK, MUTE, ReportLogo, ReportPdfInit

### Community 95 - "Room Day Settings UI"
Cohesion: 0.36
Nodes (7): updateRoomDaySettings(), DOUBLE_HOURS, label(), NEW_DAY_HOURS, RoomDayClient(), submit(), short()

### Community 96 - "Daily Summary Cron Route"
Cohesion: 0.39
Nodes (7): authorised(), dynamic, notFound(), POST(), runtime, normalizeClosingHour(), normalizeDailySummaryConfig()

### Community 97 - "DB Environments & Cancellation Log"
Cohesion: 0.25
Nodes (8): Three databases: DEV / PRODUCTION / self-hosted, DB before app golden rule, Changelog: Cancel individual units, Current: Unit-wise cancellation, Cancelling an item on a PAID bill is refused, Self-hosted cutover complete 2026-08-27, Self-hosted migration: replay migrations, copy data over Kong, Two Supabase projects (dev/prod)

### Community 98 - "Postgres HTTP Client Script"
Cohesion: 0.36
Nodes (3): escapeLiteral(), HttpClient, toLiteral()

### Community 99 - "Restaurant Detail Page"
Cohesion: 0.38
Nodes (6): getRestaurantWithStaff(), RestaurantDetailClient(), StaffSection(), RestaurantDetailPage(), selectRestaurant(), normalizeBusinessType()

### Community 100 - "Daily Finance Report Setup"
Cohesion: 0.29
Nodes (7): Daily Finance Report Setup, Gmail App Password Setup, Why */15 not 0 * * * *, report_deliveries dedupe table, Timezone: yesterday shows in today's sales, Completed: 45-minute delay fixed (pg_cron GMT), finance_openings table

### Community 101 - "Memory Bank Docs Index"
Cohesion: 0.38
Nodes (7): Bugs Doc, Changelog Doc, Completed Doc, Current Task Doc, Database Doc, RestroSewa Project, Roadmap

### Community 103 - "Offline Screen UI"
Cohesion: 0.40
Nodes (3): OfflineScreen(), dynamic, metadata

### Community 104 - "Food Type Marks"
Cohesion: 0.47
Nodes (4): FoodMark(), FOOD_TYPE_KEYS, FOOD_TYPES, foodType

### Community 105 - "Menu Data Model Rules"
Cohesion: 0.33
Nodes (6): has_variants trigger-maintained, scripts/import-menu.mjs, Menu Data Model, Variant price REPLACES item price, workstation_id derived from category, A product's workstation is metadata, not mechanism

### Community 106 - "Room Bill Rendering Rules"
Cohesion: 0.33
Nodes (6): BillTicket component (sections/stay props), folioToBill() mapper, buildFolio advancePaid/balanceDue/refundDue, D1: hand-built room bill renderer, D2: paid room bill missing money, Discount-before-tax rule

### Community 107 - "Room Billing Unification Docs"
Cohesion: 0.40
Nodes (5): Room Billing Unification Plan, Room Billing Unification Design Spec, Changelog: Room bill same document, Completed: Room billing unification, room_stays table

### Community 108 - "Payment & Purchase Edit RPCs"
Cohesion: 0.40
Nodes (5): edit_payment_tender RPC, edit_purchase RPC, security_audit_log table (spec), verifySecurityPin(), security_audit_log table (db)

### Community 110 - "Unit Cancellation Event Log"
Cohesion: 0.50
Nodes (4): Counters on line + append-only event log, session_order_item_cancellations table, Releases got their OWN view, order_item_release, Unit-wise cancellation: counters + event log, both

### Community 111 - "Package Metadata"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 112 - "Auth Proxy Redirect"
Cohesion: 0.67
Nodes (3): config, proxy(), redirectKeepingCookies()

### Community 114 - "Room Checkout Discount"
Cohesion: 0.67
Nodes (3): check_out_room RPC (p_discount), check_out_room + refund params, D3: room discount not recorded

### Community 115 - "Derived State Principles"
Cohesion: 0.67
Nodes (3): Re-derive paid bill from frozen stay, Derived stock, not cached, Four derived balances

## Ambiguous Edges - Review These
- `Tabular-Figure Money Type` → `payments table`  [AMBIGUOUS]
  DESIGN.md · relation: conceptually_related_to
- `report_deliveries dedupe table` → `finance_openings table`  [AMBIGUOUS]
  memory-bank/database.md · relation: conceptually_related_to

## Knowledge Gaps
- **524 isolated node(s):** `NavItem`, `NAV`, `STOCK_NAV`, `SETTINGS_ITEM`, `METHOD_LABEL` (+519 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **47 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Tabular-Figure Money Type` and `payments table`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `report_deliveries dedupe table` and `finance_openings table`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `createServiceClient()` connect `Room & Table Dashboard Analytics` to `Payroll Actions`, `Security & Settings`, `Expenses & Savings Actions`, `Stock Management Actions`, `Purchases Actions`, `Menu Management Actions`, `POS Session Actions`, `Credit Payments Actions`, `Security PIN Operations`, `Finance Actions & Client`, `Room Admin Actions`, `Table Admin Actions`, `Customer Menu UI`, `Deductions Client`, `Admin Dashboard Sections`, `Vendors Actions`, `Deduction Report & Menu Items`, `Notifications Actions`, `Staff Management Actions`, `Order Ticket Printing`, `Room Folio & Advances`, `Restaurant Admin Actions`, `Staff & Workstations Pages`, `Auth Actions`, `Expense Categories & Daily Summary`, `Room Check-in Grid UI`, `Notification Visibility & Push Payload`, `Restaurant Setup Reset`, `Room & Session Overview Actions`, `Subscription Expiry Cron`, `Order Item Status UI`, `Web Push Subscriptions`, `Table Session Grid UI`, `Admin Sidebar Nav`, `Customer Actions`, `Session Order Actions`, `Dashboard Analytics Actions`, `Super Admin Auth Route`, `Extra Income Actions`, `Order Queue UI`, `Realtime Route`, `Order Session Print Types`, `Restaurant Onboarding UI`, `App Layouts`, `Notification Dispatch`, `Session Transfer Logic`, `Restaurant Branding Actions`, `Finance Reporting Actions`, `Stock Client & Options`, `Assignment Visibility Scope`, `Notification Preferences UI`, `Customer Activation State`, `Customer Cart & Order UI`, `Current User & Auth Helpers`, `Room Day Settings UI`, `Daily Summary Cron Route`, `Restaurant Detail Page`?**
  _High betweenness centrality (0.199) - this node is a cross-community bridge._
- **Why does `getRestaurantUser()` connect `Room & Table Dashboard Analytics` to `Payroll Actions`, `Security & Settings`, `Expenses & Savings Actions`, `Stock Management Actions`, `Purchases Actions`, `Menu Management Actions`, `POS Session Actions`, `Credit Payments Actions`, `Finance Actions & Client`, `Room Admin Actions`, `Table Admin Actions`, `Deductions Client`, `Admin Dashboard Sections`, `Vendors Actions`, `Deduction Report & Menu Items`, `Notifications Actions`, `Order Ticket Printing`, `Room Folio & Advances`, `Room Check-in Grid UI`, `Room & Session Overview Actions`, `Order Item Status UI`, `Web Push Subscriptions`, `Table Session Grid UI`, `Session Order Actions`, `Dashboard Analytics Actions`, `Extra Income Actions`, `Order Queue UI`, `Realtime Route`, `Order Session Print Types`, `Session Transfer Logic`, `Finance Reporting Actions`, `Stock Client & Options`, `Notification Preferences UI`, `Room Day Settings UI`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `Button` connect `Auth Forms UI` to `Payroll Actions`, `Security & Settings`, `Expenses & Savings Actions`, `Stock Management Actions`, `Purchases Actions`, `Mock Bill Client`, `Menu Management Actions`, `Credit Payments Actions`, `Finance Actions & Client`, `Room Admin Actions`, `Table Admin Actions`, `Menu Browser Client`, `Vendors Actions`, `Room Folio & Advances`, `Restaurant Admin Actions`, `Auth Actions`, `Room Bill Ticket UI`, `Staff Form UI`, `Room Check-in Grid UI`, `Restaurant Setup Reset`, `Subscription Expiry Cron`, `Modal & Dialog UI`, `Order Session Print Types`, `Restaurant Onboarding UI`, `Active Room Stays UI`, `Session Transfer Logic`, `Restaurant Branding Actions`, `Room Day Settings UI`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **What connects `NavItem`, `NAV`, `STOCK_NAV` to the rest of the system?**
  _524 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Payroll Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.06142728093947606 - nodes in this community are weakly interconnected._