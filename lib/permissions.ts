export const PERMISSIONS = {
  // Dashboard
  VIEW_DASHBOARD:   "view_dashboard",
  // Orders
  VIEW_ORDERS:      "view_orders",
  MANAGE_ORDERS:    "manage_orders",
  CREATE_ORDERS:    "create_orders",
  EDIT_ORDERS:      "edit_orders",
  CANCEL_ORDERS:    "cancel_orders",
  CLOSE_BILLS:      "close_bills",
  // Custom items — adding a manual, off-menu line with a STAFF-TYPED price. Held apart from
  // create_orders on purpose: a normal order can never set its own price (lib/order-items.ts),
  // so putting an arbitrary amount on a bill is a distinct, more-trusted act.
  MANAGE_CUSTOM_ITEMS: "manage_custom_items",
  // Mock billing — printing a demo/training bill that is indistinguishable from a real one
  // (see modules/mock-bill.md). Its OWN permission, not a rider on close_bills, for two
  // reasons: producing a convincing receipt is a distinct act from settling a real table,
  // and a demo/sales account should be grantable with this and nothing else. Still
  // Security-PIN gated on top — this decides who is offered it, the PIN authorizes it.
  PRINT_MOCK_BILLS: "print_mock_bills",
  // Menu
  VIEW_MENU:        "view_menu",
  MANAGE_MENU:      "manage_menu",
  // Tables
  VIEW_TABLES:      "view_tables",
  MANAGE_TABLES:    "manage_tables",
  // Walk-ins — own group, so a walk-in (takeaway/phone/delivery) desk can be granted
  // without dine-in tables. view = read-only; manage = open/edit/order/bill/close.
  VIEW_WALKINS:     "view_walkins",
  MANAGE_WALKINS:   "manage_walkins",
  // Rooms — three tiers. view_rooms is read-only; check_in starts stays without
  // granting room configuration; manage_rooms is the full CRUD (managers/admins).
  VIEW_ROOMS:       "view_rooms",
  CHECK_IN:         "check_in",
  MANAGE_ROOMS:     "manage_rooms",
  // Billing
  PROCESS_PAYMENTS: "process_payments",
  APPLY_DISCOUNTS:  "apply_discounts",
  REFUND_BILLS:     "refund_bills",
  // Stock & Finance
  VIEW_STOCK:       "view_stock",
  MANAGE_STOCK:     "manage_stock",
  // Purchasing is split OUT of manage_stock, and split again into two: recording
  // supplier bills (manage_purchases) vs managing + paying the vendor accounts
  // (manage_vendors). Both spend the restaurant's money and are a different trust
  // level from counting stock. See STOCK_ACCESS.canManagePurchases / canManageVendors.
  MANAGE_PURCHASES: "manage_purchases",
  MANAGE_VENDORS:   "manage_vendors",
  // Overheads — rent, electricity, water. Its own lane rather than a rider on
  // manage_purchases: recording a supplier bill and paying the landlord are
  // different trust levels, and an owner must be able to hand a manager the
  // second without the first. See STOCK_ACCESS.canManageExpenses.
  MANAGE_EXPENSES:  "manage_expenses",
  ADD_EXPENSES:     "add_expenses",
  VIEW_FINANCE:     "view_finance",
  // Reports
  VIEW_REPORTS:     "view_reports",
  // Staff
  VIEW_STAFF:       "view_staff",
  CREATE_STAFF:     "create_staff",
  EDIT_STAFF:       "edit_staff",
  DELETE_STAFF:     "delete_staff",
  // Payroll — deliberately separate from view_staff. Seeing the team is not the
  // same as seeing what everyone earns.
  VIEW_PAYROLL:     "view_payroll",
  MANAGE_PAYROLL:   "manage_payroll",
  // NOTE: view_customers/manage_customers and view_settings/manage_settings were removed
  // 2026-07-23 — they gated nothing. Customer accounts run through Credits (gated on
  // process_payments + close_bills); Settings gates on admin ROLE. Do not reintroduce
  // them without wiring them to something.
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type PermissionGroupDef = {
  label: string;
  items: { key: Permission; label: string }[];
};

export const PERMISSION_GROUPS: PermissionGroupDef[] = [
  {
    label: "Dashboard",
    items: [{ key: "view_dashboard", label: "View Dashboard" }],
  },
  {
    label: "Orders",
    items: [
      { key: "view_orders",    label: "View Orders" },
      { key: "manage_orders",  label: "Manage Orders" },
      { key: "create_orders",  label: "Create Orders" },
      { key: "edit_orders",    label: "Edit Orders" },
      { key: "cancel_orders",  label: "Cancel Orders" },
      { key: "close_bills",    label: "Close Bills" },
    ],
  },
  {
    label: "Custom Items",
    items: [
      // Adding a manual/off-menu line with a staff-typed price. Separate from Create Orders
      // because it lets staff put an arbitrary amount on a bill.
      { key: "manage_custom_items", label: "Add Custom Items" },
    ],
  },
  {
    label: "Mock Billing",
    items: [
      // Off every preset on purpose — like Payroll, this is only ever granted deliberately.
      // A mock bill prints indistinguishably from a real one, so nobody should acquire the
      // ability by inheriting a job template.
      { key: "print_mock_bills", label: "Print Mock Bills" },
    ],
  },
  {
    label: "Menu",
    items: [
      { key: "view_menu",   label: "View Menu" },
      { key: "manage_menu", label: "Manage Menu" },
    ],
  },
  {
    label: "Tables",
    items: [
      { key: "view_tables",   label: "View Tables" },
      { key: "manage_tables", label: "Manage Tables" },
    ],
  },
  {
    label: "Walk-ins",
    items: [
      // Manage Walk-ins automatically includes View Walk-ins — see WALKIN_ACCESS.
      { key: "view_walkins",   label: "View Walk-ins" },
      { key: "manage_walkins", label: "Manage Walk-ins" },
    ],
  },
  {
    label: "Rooms",
    items: [
      // Three tiers: view is read-only; check-in starts stays (front desk) without room
      // configuration; manage is full CRUD (managers). See ROOM_ACCESS below.
      { key: "view_rooms",   label: "View Rooms" },
      { key: "check_in",     label: "Check-in" },
      { key: "manage_rooms", label: "Manage Rooms" },
    ],
  },
  {
    label: "Billing",
    items: [
      { key: "process_payments", label: "Process Payments" },
      { key: "apply_discounts",  label: "Apply Discounts" },
      { key: "refund_bills",     label: "Refund Bills" },
    ],
  },
  {
    label: "Stock",
    items: [
      // Manage Stock automatically includes View Stock — see STOCK_ACCESS.canViewStock,
      // which passes on either permission. Ticking Manage alone is enough.
      { key: "view_stock",   label: "View Stock" },
      { key: "manage_stock", label: "Manage Stock" },
    ],
  },
  {
    label: "Purchases",
    items: [
      // Recording supplier bills (moves stock, cash and vendor credit). Write
      // implies the read of the Purchases page. See STOCK_ACCESS.canManagePurchases.
      { key: "manage_purchases", label: "Manage Purchases" },
    ],
  },
  {
    label: "Vendors",
    items: [
      // Creating/editing/deleting vendors and paying what they're owed. Write
      // implies the read of the Vendors page. See STOCK_ACCESS.canManageVendors.
      { key: "manage_vendors", label: "Manage Vendors" },
    ],
  },
  {
    label: "Extra Expenses",
    items: [
      // Recording rent, electricity and the rest. Write implies the read of the
      // Extra Expenses page. See STOCK_ACCESS.canManageExpenses.
      { key: "manage_expenses", label: "Manage Extra Expenses" },
      // The narrow one: file an expense or a saving, see TODAY's entries only,
      // and nothing else. Given to whoever actually pays the bills without
      // showing them the running totals — in particular, never a saving pot's
      // balance. Granting `manage_expenses` as well makes this one irrelevant.
      { key: "add_expenses", label: "Add Expenses & Saving" },
    ],
  },
  {
    label: "Finance",
    items: [
      // Kept apart from Stock: the daily report exposes takings, margins and every
      // outstanding debt, which a storekeeper has no business seeing.
      { key: "view_finance", label: "View Daily Finance Report" },
    ],
  },
  {
    label: "Reports",
    items: [{ key: "view_reports", label: "View Reports" }],
  },
  {
    label: "Staff",
    items: [
      { key: "view_staff",   label: "View Staff" },
      { key: "create_staff", label: "Create Staff" },
      { key: "edit_staff",   label: "Edit Staff" },
      { key: "delete_staff", label: "Delete Staff" },
    ],
  },
  {
    label: "Payroll",
    items: [
      // Salaries are the most sensitive thing on the staff record — a colleague
      // who can see the roster must not thereby see what everyone is paid. Held
      // apart from `view_staff` for exactly that reason, and off every preset by
      // default, so payroll is only ever granted on purpose.
      { key: "view_payroll",   label: "View Payroll & Salaries" },
      { key: "manage_payroll", label: "Set Salaries & Record Payments" },
    ],
  },
];

// restaurant_admin role always bypasses permission checks.
// Only restaurant_employee role is subject to per-permission enforcement.
export function hasPermission(
  user: { role: string; permissions: string[] },
  permission: Permission
): boolean {
  if (user.role === "restaurant_admin") return true;
  return user.permissions.includes(permission);
}

// True when the admin, or when the user holds ANY of the given permissions.
export function hasAnyPermission(
  user: { role: string; permissions: string[] },
  permissions: Permission[]
): boolean {
  if (user.role === "restaurant_admin") return true;
  return permissions.some((p) => user.permissions.includes(p));
}

// True when the admin, or when the user holds EVERY one of the given permissions.
export function hasAllPermissions(
  user: { role: string; permissions: string[] },
  permissions: Permission[]
): boolean {
  if (user.role === "restaurant_admin") return true;
  return permissions.every((p) => user.permissions.includes(p));
}

// ─── Staff Navigation (single source of truth) ────────────────────────────────
// The employee sidebar/nav is derived entirely from permissions so the visible
// items always match what the backend route guards allow. Each entry declares
// the permission(s) that unlock it; the layout renders only the allowed items
// and each page re-checks the same permission server-side.

const P_ = PERMISSIONS;

export type StaffNavKey = "tables" | "orders" | "menu" | "sales" | "credits" | "notifications";

export type StaffNavItem = {
  key: StaffNavKey;
  label: string;
  href: string;
  exact: boolean;
  /** Any of these permissions grants access. */
  anyOf: Permission[];
  /**
   * When set, EVERY one of these is also required. Used by Credits, which is
   * restricted to staff who both take payments and close bills (Cashier /
   * Receptionist) — holding just one of the two is not enough.
   */
  allOf?: Permission[];
};

export const STAFF_NAV: StaffNavItem[] = [
  {
    key: "tables",
    label: "Tables",
    href: "/employee/dashboard",
    exact: true,
    anyOf: [P_.VIEW_DASHBOARD, P_.VIEW_TABLES, P_.VIEW_ROOMS],
  },
  {
    key: "orders",
    label: "Orders",
    href: "/employee/queue",
    exact: false,
    anyOf: [P_.VIEW_ORDERS, P_.MANAGE_ORDERS, P_.CREATE_ORDERS, P_.EDIT_ORDERS],
  },
  {
    key: "menu",
    label: "Menu",
    href: "/employee/menu",
    exact: false,
    anyOf: [P_.MANAGE_MENU],
  },
  {
    key: "sales",
    label: "Sales",
    href: "/employee/sales",
    exact: false,
    anyOf: [P_.PROCESS_PAYMENTS, P_.CLOSE_BILLS, P_.VIEW_REPORTS],
  },
  {
    key: "credits",
    label: "Credits",
    href: "/employee/credits",
    exact: false,
    // Billing + Close Bills, both required — see `allOf` above.
    anyOf: [P_.PROCESS_PAYMENTS],
    allOf: [P_.PROCESS_PAYMENTS, P_.CLOSE_BILLS],
  },
  {
    key: "notifications",
    label: "Notifications",
    href: "/employee/notifications",
    exact: false,
    anyOf: [P_.VIEW_DASHBOARD, P_.VIEW_ORDERS, P_.MANAGE_ORDERS, P_.VIEW_TABLES, P_.CREATE_ORDERS, P_.EDIT_ORDERS],
  },
];

// Returns the nav items a given staff user is permitted to see.
export function getStaffNav(user: { role: string; permissions: string[] }): StaffNavItem[] {
  return STAFF_NAV.filter(
    (item) =>
      hasAnyPermission(user, item.anyOf) &&
      (!item.allOf || hasAllPermissions(user, item.allOf))
  );
}

// Convenience booleans used by page guards so nav ↔ route protection stay in sync.
export const NAV_ACCESS = {
  canSeeOrders: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_ORDERS, P_.MANAGE_ORDERS, P_.CREATE_ORDERS, P_.EDIT_ORDERS]),
  canManageOrders: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.MANAGE_ORDERS, P_.EDIT_ORDERS]),
  canSeeSales: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.PROCESS_PAYMENTS, P_.CLOSE_BILLS, P_.VIEW_REPORTS]),
  // Customer credits — create, view, take repayments, settle. Deliberately
  // stricter than Sales: a reports-only viewer must NOT reach customer debt.
  canManageCredits: (u: { role: string; permissions: string[] }) =>
    hasAllPermissions(u, [P_.PROCESS_PAYMENTS, P_.CLOSE_BILLS]),
};

// ─── Stock & Finance (Admin Dashboard module) ─────────────────────────────────
// Read vs write are split so a storekeeper can be given stock entry without the
// finance report, and the finance report can be granted without stock entry.
// `restaurant_admin` passes all three via hasPermission/hasAnyPermission.

// ─── Rooms (three tiers) ──────────────────────────────────────────────────────
// view_rooms is strictly read-only. check_in adds "put a guest in and run the stay"
// without room configuration. manage_rooms adds the CRUD. Write implies read, the same
// way manage_stock implies view_stock: a manager needs no separate check_in box, and a
// receptionist needs no separate view_rooms box.
//
// This REPLACES the old model where check-in rode on view_rooms ("a Receptionist is just
// a Cashier with view_rooms"). That is exactly what changed.

// Walk-ins (takeaway / phone / delivery slots). Own group so a walk-in desk can be
// granted without dine-in tables. Write implies read, like ROOM_ACCESS/STOCK_ACCESS.
export const WALKIN_ACCESS = {
  /** Sees the Walk-ins section, slots, sessions, customer & billing info (read-only). */
  canViewWalkins: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_WALKINS, P_.MANAGE_WALKINS]),
  /** Opens/edits/orders/bills/closes walk-in sessions (every write). */
  canManageWalkins: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.MANAGE_WALKINS),
};

export const ROOM_ACCESS = {
  /** Sees the Rooms section, folios and room bills (read-only is enough). */
  canViewRooms: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_ROOMS, P_.CHECK_IN, P_.MANAGE_ROOMS]),
  /** Checks guests in, starts room sessions, marks a room cleaned to turn it over. */
  canCheckIn: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.CHECK_IN, P_.MANAGE_ROOMS]),
  /** Creates/edits/deletes rooms and room types, changes availability. */
  canManageRooms: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.MANAGE_ROOMS),
};

// Three independent write lanes now live under one module:
//   • manage_stock     — products, stock counts/adjustments, recipe links.
//   • manage_purchases — record supplier bills (the buying workflow).
//   • manage_vendors   — the vendor accounts: add/edit/delete vendors and pay them.
// A storekeeper who logs wastage is no longer automatically able to buy, and a
// buyer is not automatically able to edit or pay vendor accounts. Each WRITE
// implies the READ of what it touches (a purchaser can view Purchases without
// view_stock; a vendor manager can view Vendors), mirroring how manage_stock
// implies view_stock.
export const STOCK_ACCESS = {
  /** Sees the Stock page (products, counts). */
  canViewStock: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_STOCK, P_.MANAGE_STOCK]),
  /** Adds/edits/deletes products, adjusts stock, edits recipe links. */
  canManageStock: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.MANAGE_STOCK),
  /** Sees the Purchases page (view-only is enough). Any stock or purchases right. */
  canViewPurchases: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_STOCK, P_.MANAGE_STOCK, P_.MANAGE_PURCHASES]),
  /** Records purchases. */
  canManagePurchases: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.MANAGE_PURCHASES),
  /** Sees the Vendors page (view-only is enough). Any stock or vendors right. */
  canViewVendors: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_STOCK, P_.MANAGE_STOCK, P_.MANAGE_VENDORS]),
  /** Creates/edits/deletes vendors and pays them. */
  canManageVendors: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.MANAGE_VENDORS),
  /**
   * Sees and records extra expenses (rent, electricity, …).
   *
   * Unlike Purchases and Vendors, a stock right does NOT open this page. Those
   * two are the buying workflow a storekeeper already lives in; the overheads
   * list is the landlord, the power bill and the licence fees — closer to the
   * Finance report than to the store room. So it takes its own permission, and
   * `view_finance` also passes because the report already prints every figure
   * this page holds.
   */
  canViewExpenses: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.MANAGE_EXPENSES, P_.VIEW_FINANCE, P_.ADD_EXPENSES]),
  /** Records, corrects and deletes extra expenses. */
  canManageExpenses: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.MANAGE_EXPENSES),
  /** May FILE an expense or a saving. The write gate on every add action. */
  canAddExpenses: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.MANAGE_EXPENSES, P_.ADD_EXPENSES]),
  /**
   * True for the ADD-ONLY holder: they may file entries but must never see a
   * running total — only what they themselves put in today.
   *
   * Defined as a single predicate, in this file, because it decides three
   * different things (which period the server will return, whether pot balances
   * are computed at all, and whether the UI offers a period picker or an edit
   * control). Re-deriving `has add && !has manage` at each of those sites is how
   * one of them eventually forgets the `!`, and a pot balance leaks.
   *
   * `restaurant_admin` never lands here: hasPermission returns true for owners,
   * so canManageExpenses already passed.
   */
  expensesTodayOnly: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.ADD_EXPENSES) &&
    !hasAnyPermission(u, [P_.MANAGE_EXPENSES, P_.VIEW_FINANCE]),
  /** Sees the Daily Finance Report (takings, margins, all outstanding debt). */
  canViewFinance: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.VIEW_FINANCE),
  /** Shows the Stock & Finance group in the admin sidebar at all. */
  canSeeModule: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_STOCK, P_.MANAGE_STOCK, P_.MANAGE_PURCHASES, P_.MANAGE_VENDORS, P_.MANAGE_EXPENSES, P_.ADD_EXPENSES, P_.VIEW_FINANCE]),
};

// ─── Payroll (Staff → Payroll) ────────────────────────────────────────────────
// Read and write are split so a bookkeeper can be given the payroll report
// without the ability to pay anyone. `restaurant_admin` passes both.
//
// `manage_payroll` implies `view_payroll`: paying someone you cannot see what
// they are owed would be absurd, and requiring both boxes to be ticked would be
// a trap. So the WRITE permission grants the READ.

export const PAYROLL_ACCESS = {
  /** Sees salaries, payroll status and payment history. */
  canViewPayroll: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_PAYROLL, P_.MANAGE_PAYROLL]),
  /** Sets salaries, records payments and advances. */
  canManagePayroll: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.MANAGE_PAYROLL),
};

// ─── Staff Presets ────────────────────────────────────────────────────────────
// Job-type templates that pre-fill the permission checkboxes with a sensible
// set for common restaurant/hotel roles. Presets are a convenience only —
// after applying one, the admin can still tick/untick any individual
// permission. The chosen preset is NOT stored; only the resulting permission
// list is persisted on the staff record.

export type StaffPresetDef = {
  key: string;
  label: string;
  description: string;
  permissions: Permission[];
};

const P = PERMISSIONS;

export const STAFF_PRESETS: StaffPresetDef[] = [
  {
    key: "waiter",
    label: "Waiter",
    description: "Takes and serves orders. View-only on menu, tables and rooms.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_ORDERS,
      P.MANAGE_ORDERS,
      P.CREATE_ORDERS,
      P.EDIT_ORDERS,
      P.VIEW_MENU,
      P.VIEW_TABLES,
      P.VIEW_ROOMS,
    ],
  },
  {
    key: "cashier",
    label: "Cashier",
    description: "Handles billing and payments. Can create orders and close bills.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_ORDERS,
      P.CREATE_ORDERS,
      P.VIEW_MENU,
      P.VIEW_TABLES,
      P.MANAGE_WALKINS,
      P.CLOSE_BILLS,
      P.PROCESS_PAYMENTS,
      P.APPLY_DISCOUNTS,
      P.MANAGE_CUSTOM_ITEMS,
    ],
  },
  {
    key: "receptionist",
    label: "Receptionist",
    description: "Front desk: checks guests in, runs room sessions and takes payment. No room configuration.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_ORDERS,
      P.CREATE_ORDERS,
      P.VIEW_MENU,
      P.VIEW_TABLES,
      P.MANAGE_WALKINS,
      P.VIEW_ROOMS,
      P.CHECK_IN,
      P.CLOSE_BILLS,
      P.PROCESS_PAYMENTS,
      P.APPLY_DISCOUNTS,
    ],
  },
  {
    key: "chef",
    label: "Chef / Kitchen",
    description: "Works the kitchen queue. Sees orders and toggles menu availability.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_ORDERS,
      P.MANAGE_ORDERS,
      P.VIEW_MENU,
      P.MANAGE_MENU,
    ],
  },
  {
    key: "manager",
    label: "Manager",
    description: "Broad operational access across orders, billing, menu, tables and reports.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_ORDERS,
      P.MANAGE_ORDERS,
      P.CREATE_ORDERS,
      P.EDIT_ORDERS,
      P.CANCEL_ORDERS,
      P.CLOSE_BILLS,
      P.MANAGE_CUSTOM_ITEMS,
      P.VIEW_MENU,
      P.MANAGE_MENU,
      P.VIEW_TABLES,
      P.MANAGE_TABLES,
      P.MANAGE_WALKINS,
      P.VIEW_ROOMS,
      // Explicit for clarity; MANAGE_ROOMS already implies it via ROOM_ACCESS.canCheckIn.
      P.CHECK_IN,
      P.MANAGE_ROOMS,
      P.PROCESS_PAYMENTS,
      P.APPLY_DISCOUNTS,
      P.REFUND_BILLS,
      P.VIEW_REPORTS,
      P.VIEW_STAFF,
    ],
  },
  {
    key: "host",
    label: "Host / Guest",
    description: "View-only access to the dashboard, tables and menu.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_TABLES,
      P.VIEW_MENU,
    ],
  },
];

// Returns the preset key whose permission set exactly matches the given
// selection, or null when the selection doesn't match any preset (i.e. the
// admin has customised it manually).
export function matchPreset(permissions: string[]): string | null {
  const selected = new Set(permissions);
  for (const preset of STAFF_PRESETS) {
    if (
      preset.permissions.length === selected.size &&
      preset.permissions.every((p) => selected.has(p))
    ) {
      return preset.key;
    }
  }
  return null;
}
