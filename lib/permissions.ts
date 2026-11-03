export const PERMISSIONS = {
  // Orders
  VIEW_ORDERS:      "view_orders",
  MANAGE_ORDERS:    "manage_orders",
  CREATE_ORDERS:    "create_orders",
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
  CANCEL_ROOM_STAY: "cancel_room_stay",
  // Billing
  PROCESS_PAYMENTS: "process_payments",
  APPLY_DISCOUNTS:  "apply_discounts",
  // Sales and Credits each have their OWN permission. They used to ride on billing
  // (Sales on any of process_payments/close_bills/view_reports, Credits on both of the
  // first two), which meant neither could be granted or withheld on its own.
  // Backfilled from the old rule by 20261103100000_simplify_staff_permissions.sql.
  VIEW_SALES:       "view_sales",
  // The narrow Sales level: today's takings and bills only, never another day. The
  // server forces the period (see NAV_ACCESS.salesTodayOnly), so the restriction holds
  // whatever the client asks for. view_sales, when also held, lifts it.
  VIEW_SALES_TODAY: "view_sales_today",
  MANAGE_CREDITS:   "manage_credits",
  // Stock & Finance
  VIEW_STOCK:       "view_stock",
  MANAGE_STOCK:     "manage_stock",
  // Purchasing is split OUT of manage_stock, and split again into two: recording
  // supplier bills (manage_purchases) vs managing + paying the vendor accounts
  // (manage_vendors). Both spend the restaurant's money and are a different trust
  // level from counting stock. See STOCK_ACCESS.canManagePurchases / canManageVendors.
  MANAGE_PURCHASES: "manage_purchases",
  MANAGE_VENDORS:   "manage_vendors",
  // Item Sales — how many of each menu item sold. A report on its own lane: it
  // shows what the kitchen sells, not takings or debt, so it is granted apart
  // from Sales/Finance. See ITEM_SALES_ACCESS.
  VIEW_ITEM_SALES:  "view_item_sales",
  // Overheads — rent, electricity, water. Its own lane rather than a rider on
  // manage_purchases: recording a supplier bill and paying the landlord are
  // different trust levels, and an owner must be able to hand a manager the
  // second without the first. See STOCK_ACCESS.canManageExpenses.
  MANAGE_EXPENSES:  "manage_expenses",
  ADD_EXPENSES:     "add_expenses",
  VIEW_FINANCE:     "view_finance",
  // Staff
  VIEW_STAFF:       "view_staff",
  // Payroll — deliberately separate from view_staff. Seeing the team is not the
  // same as seeing what everyone earns.
  VIEW_PAYROLL:     "view_payroll",
  MANAGE_PAYROLL:   "manage_payroll",
  // REMOVED 2026-11-03 (20261103100000_simplify_staff_permissions.sql), because they
  // gated nothing or duplicated another key:
  //   view_menu, refund_bills, create_staff, edit_staff, delete_staff — checked nowhere
  //   view_dashboard → view_tables, edit_orders → manage_orders (identical effect)
  //   view_reports → view_sales (it only ever opened Sales)
  // And earlier (2026-07-23): view/manage_customers, view/manage_settings.
  // Do not reintroduce a key without wiring it to something.
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ─── Access sections: what the staff editor shows ─────────────────────────────
// The editor is ONE control per section of the app, not a wall of checkboxes. Each
// section has LEVELS (pick exactly one) and optional EXTRAS (independent switches that
// only make sense once the section is on). A level is just a named set of permission
// keys, so enforcement everywhere else keeps checking the same keys it always did.
//
// Levels are CUMULATIVE sets — "Full" lists the view key too — so a stored list maps back
// to exactly one level. A stored list that matches no level (hand-edited, or from before
// this model) is shown as "Custom" and left untouched until someone picks a level.

export type AccessLevel = {
  key: string;
  label: string;
  /** One line: what this level lets the person do. */
  hint: string;
  permissions: Permission[];
};

export type AccessExtra = { key: Permission; label: string; hint: string };

export type AccessSection = {
  key: string;
  label: string;
  area: "front" | "back";
  /** First level is always "None" (no permissions). */
  levels: AccessLevel[];
  extras?: AccessExtra[];
  /** Hidden when the business has no hotel side. */
  roomsOnly?: boolean;
};

const P = PERMISSIONS;
const NONE: AccessLevel = { key: "none", label: "None", hint: "No access.", permissions: [] };

export const ACCESS_SECTIONS: AccessSection[] = [
  // ── Front of house ──
  {
    key: "tables",
    label: "Tables",
    area: "front",
    levels: [
      NONE,
      { key: "view", label: "View", hint: "See the floor plan and table bills.", permissions: [P.VIEW_TABLES] },
      {
        key: "full",
        label: "Full",
        hint: "Also shift tables, close a table with orders, and edit tables.",
        permissions: [P.VIEW_TABLES, P.MANAGE_TABLES],
      },
    ],
  },
  {
    key: "orders",
    label: "Orders",
    area: "front",
    levels: [
      NONE,
      { key: "view", label: "View", hint: "See the order queue only.", permissions: [P.VIEW_ORDERS] },
      {
        key: "take",
        label: "Take orders",
        // Walk-ins also need Walk-ins: Full — submitOrder refuses a walk-in session
        // without manage_walkins (walkInWriteBlocked), whatever the Orders level.
        hint: "Add items to tables and rooms (walk-ins also need Walk-ins: Full).",
        permissions: [P.VIEW_ORDERS, P.CREATE_ORDERS],
      },
      {
        key: "kitchen",
        label: "Kitchen",
        hint: "Update item status (preparing, ready, served). Can't add items.",
        permissions: [P.VIEW_ORDERS, P.MANAGE_ORDERS],
      },
      {
        key: "full",
        label: "Full",
        hint: "Take orders and update their status.",
        permissions: [P.VIEW_ORDERS, P.CREATE_ORDERS, P.MANAGE_ORDERS],
      },
    ],
    extras: [
      { key: P.CANCEL_ORDERS, label: "Cancel orders", hint: "Remove unserved items from a bill." },
      { key: P.MANAGE_CUSTOM_ITEMS, label: "Add custom items", hint: "Off-menu lines with a typed price." },
    ],
  },
  {
    key: "walkins",
    label: "Walk-ins",
    area: "front",
    levels: [
      NONE,
      { key: "view", label: "View", hint: "See takeaway / phone / delivery orders.", permissions: [P.VIEW_WALKINS] },
      {
        key: "full",
        label: "Full",
        // Closing a walk-in's bill is still gated on Billing (closeSessionWithPayment
        // checks close_bills on its own), so a waiter can hold this safely.
        hint: "Open walk-ins and add items. Taking payment needs Billing.",
        permissions: [P.VIEW_WALKINS, P.MANAGE_WALKINS],
      },
    ],
  },
  {
    key: "rooms",
    label: "Rooms",
    area: "front",
    roomsOnly: true,
    levels: [
      NONE,
      { key: "view", label: "View", hint: "See rooms and guest folios.", permissions: [P.VIEW_ROOMS] },
      {
        key: "checkin",
        label: "Front desk",
        hint: "Check guests in, run stays, mark rooms clean.",
        permissions: [P.VIEW_ROOMS, P.CHECK_IN],
      },
      {
        key: "full",
        label: "Full",
        hint: "Also create and edit rooms and room types.",
        permissions: [P.VIEW_ROOMS, P.CHECK_IN, P.MANAGE_ROOMS],
      },
    ],
    extras: [
      // Ending a stay WITHOUT billing it, and deciding how much of the deposit the hotel
      // keeps. Not implied by Full: configuring rooms and writing off a guest's bill are
      // different acts. Always ALSO gated on the Security PIN — see lib/security/authorize.ts.
      { key: P.CANCEL_ROOM_STAY, label: "Cancel a checked-in stay", hint: "Needs the Security PIN too." },
    ],
  },
  {
    key: "billing",
    label: "Billing",
    area: "front",
    levels: [
      NONE,
      {
        key: "full",
        label: "Take payments",
        hint: "Take payment, close bills, check guests out.",
        permissions: [P.CLOSE_BILLS, P.PROCESS_PAYMENTS],
      },
    ],
    extras: [
      { key: P.APPLY_DISCOUNTS, label: "Apply discounts", hint: "Reduce a bill at payment." },
      // Off every preset on purpose — a mock bill prints indistinguishably from a real one,
      // so nobody should acquire it by inheriting a job template.
      { key: P.PRINT_MOCK_BILLS, label: "Print mock bills", hint: "Demo bills. Needs the Security PIN too." },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    area: "front",
    levels: [
      NONE,
      // Not cumulative, unlike most sections: the two are alternatives, and holding
      // view_sales_today alongside view_sales would grant nothing extra.
      {
        key: "today",
        label: "Today only",
        hint: "Today's takings and bills only — no other days.",
        permissions: [P.VIEW_SALES_TODAY],
      },
      { key: "view", label: "All days", hint: "Takings and paid bills for any period.", permissions: [P.VIEW_SALES] },
    ],
  },
  {
    key: "credits",
    label: "Credits",
    area: "front",
    levels: [
      NONE,
      {
        key: "full",
        label: "Full",
        hint: "Bill to customer accounts and take repayments.",
        permissions: [P.MANAGE_CREDITS],
      },
    ],
  },
  {
    key: "menu",
    label: "Menu",
    area: "front",
    levels: [
      NONE,
      {
        key: "full",
        label: "Full",
        hint: "Edit items, prices and availability.",
        permissions: [P.MANAGE_MENU],
      },
    ],
  },
  // ── Back office ──
  {
    key: "stock",
    label: "Stock",
    area: "back",
    levels: [
      NONE,
      // View Stock also opens the Purchases and Vendors LISTS (read-only) — a storekeeper
      // checks what arrived. See STOCK_ACCESS.canViewPurchases / canViewVendors.
      { key: "view", label: "View", hint: "See stock, plus the purchases and vendors lists.", permissions: [P.VIEW_STOCK] },
      {
        key: "full",
        label: "Full",
        hint: "Add products, adjust stock, link recipes.",
        permissions: [P.VIEW_STOCK, P.MANAGE_STOCK],
      },
    ],
  },
  {
    key: "purchases",
    label: "Purchases",
    area: "back",
    levels: [
      NONE,
      { key: "full", label: "Full", hint: "Record supplier bills.", permissions: [P.MANAGE_PURCHASES] },
    ],
  },
  {
    key: "vendors",
    label: "Vendors",
    area: "back",
    levels: [
      NONE,
      { key: "full", label: "Full", hint: "Add, edit and pay vendors.", permissions: [P.MANAGE_VENDORS] },
    ],
  },
  {
    key: "expenses",
    label: "Extra expenses",
    area: "back",
    levels: [
      NONE,
      // The narrow one: file an expense or a saving and see TODAY's entries only — never a
      // running total or a saving pot's balance. See STOCK_ACCESS.expensesTodayOnly.
      {
        key: "add",
        label: "Add only",
        hint: "File expenses and savings; sees only today's entries.",
        permissions: [P.ADD_EXPENSES],
      },
      {
        key: "full",
        label: "Full",
        hint: "See, correct and delete all expenses.",
        permissions: [P.ADD_EXPENSES, P.MANAGE_EXPENSES],
      },
    ],
  },
  {
    key: "finance",
    label: "Finance report",
    area: "back",
    levels: [
      NONE,
      // Kept apart from Stock: the daily report exposes takings, margins and every
      // outstanding debt, which a storekeeper has no business seeing.
      { key: "view", label: "View", hint: "Daily takings, margins and debts.", permissions: [P.VIEW_FINANCE] },
    ],
  },
  {
    key: "itemSales",
    label: "Item sales",
    area: "back",
    levels: [
      NONE,
      { key: "view", label: "View", hint: "Units sold per menu item.", permissions: [P.VIEW_ITEM_SALES] },
    ],
  },
  {
    key: "staff",
    label: "Staff",
    area: "back",
    levels: [
      NONE,
      { key: "view", label: "View", hint: "See the team and assign workstations.", permissions: [P.VIEW_STAFF] },
    ],
  },
  {
    key: "payroll",
    label: "Payroll",
    area: "back",
    levels: [
      NONE,
      // Salaries are the most sensitive thing on the staff record — held apart from Staff,
      // and off every preset, so payroll is only ever granted on purpose.
      { key: "view", label: "View", hint: "See salaries and payment history.", permissions: [P.VIEW_PAYROLL] },
      {
        key: "full",
        label: "Full",
        hint: "Set salaries, record payments and advances.",
        permissions: [P.VIEW_PAYROLL, P.MANAGE_PAYROLL],
      },
    ],
  },
];

/** Every permission a section's levels can grant (extras excluded). */
export function sectionLevelKeys(section: AccessSection): Permission[] {
  return [...new Set(section.levels.flatMap((l) => l.permissions))];
}

/**
 * Which level a stored permission list is at for this section — or "custom" when the
 * section's keys match no level exactly. Extras are ignored here.
 */
export function detectLevel(section: AccessSection, selected: readonly string[]): string {
  const keys = sectionLevelKeys(section);
  const mine = keys.filter((k) => selected.includes(k)).sort().join(",");
  const hit = section.levels.find((l) => [...l.permissions].sort().join(",") === mine);
  return hit ? hit.key : "custom";
}

/**
 * Set one section to a level, leaving every other section alone. Choosing None also
 * clears that section's extras — an extra without its section is a dead switch.
 */
export function applyLevel(
  selected: readonly string[],
  section: AccessSection,
  levelKey: string
): string[] {
  const level = section.levels.find((l) => l.key === levelKey);
  if (!level) return [...selected];
  const drop = new Set<string>(sectionLevelKeys(section));
  if (level.permissions.length === 0) for (const e of section.extras ?? []) drop.add(e.key);
  return [...selected.filter((p) => !drop.has(p)), ...level.permissions];
}

/**
 * How many sections this list grants any access to — the editor's summary count.
 * `includeRooms: false` for a business with no hotel side, where the editor hides the
 * Rooms row: presets still carry view_rooms, and counting a row nobody can see reads
 * as one section too many.
 */
export function countSectionsWithAccess(selected: readonly string[], includeRooms = true): number {
  return ACCESS_SECTIONS.filter(
    (s) => (includeRooms || !s.roomsOnly) && detectLevel(s, selected) !== "none"
  ).length;
}

// Every grantable key with its label, one group per section. Derived from
// ACCESS_SECTIONS so the two cannot drift; kept because tests and the save-side
// whitelist reason about "what can be granted" as a flat list.
export type PermissionGroupDef = {
  label: string;
  items: { key: Permission; label: string }[];
};

export const PERMISSION_GROUPS: PermissionGroupDef[] = ACCESS_SECTIONS.map((s) => {
  const items: { key: Permission; label: string }[] = [];
  const seen = new Set<string>();
  for (const level of s.levels) {
    for (const key of level.permissions) {
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ key, label: `${s.label}: ${level.label}` });
    }
  }
  for (const e of s.extras ?? []) {
    if (!seen.has(e.key)) items.push({ key: e.key, label: e.label });
  }
  return { label: s.label, items };
});

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
    // The dashboard HOME. The Tables section on it is gated separately
    // (NAV_ACCESS.canSeeTables), so rooms or walk-in staff don't get the floor plan.
    anyOf: [P_.VIEW_TABLES, P_.MANAGE_TABLES, P_.VIEW_ROOMS, P_.CHECK_IN, P_.MANAGE_ROOMS, P_.VIEW_WALKINS, P_.MANAGE_WALKINS],
  },
  {
    key: "orders",
    label: "Orders",
    href: "/employee/queue",
    exact: false,
    anyOf: [P_.VIEW_ORDERS, P_.MANAGE_ORDERS, P_.CREATE_ORDERS],
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
    anyOf: [P_.VIEW_SALES, P_.VIEW_SALES_TODAY],
  },
  {
    key: "credits",
    label: "Credits",
    href: "/employee/credits",
    exact: false,
    anyOf: [P_.MANAGE_CREDITS],
  },
  {
    key: "notifications",
    label: "Notifications",
    href: "/employee/notifications",
    exact: false,
    // Anyone working the floor: guest calls come from tables, rooms and walk-ins.
    anyOf: [P_.VIEW_TABLES, P_.VIEW_ORDERS, P_.MANAGE_ORDERS, P_.CREATE_ORDERS, P_.VIEW_ROOMS, P_.VIEW_WALKINS],
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
    hasAnyPermission(u, [P_.VIEW_ORDERS, P_.MANAGE_ORDERS, P_.CREATE_ORDERS]),
  canManageOrders: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.MANAGE_ORDERS),
  /** The Tables section of the dashboard (the floor plan). */
  canSeeTables: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_TABLES, P_.MANAGE_TABLES]),
  /** Opens the Sales section at all — either level. */
  canSeeSales: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_SALES, P_.VIEW_SALES_TODAY]),
  /**
   * True for the TODAY-ONLY holder: every sales read is forced to today's business day
   * and no wider total (week/month/year/all) is returned. One predicate, used by the
   * report, the CSV export and the single-bill view, so none of them can forget it.
   * `restaurant_admin` never lands here: hasPermission(VIEW_SALES) is true for owners.
   */
  salesTodayOnly: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.VIEW_SALES_TODAY) && !hasPermission(u, P_.VIEW_SALES),
  // Customer credits — create, view, take repayments, settle. Its own permission:
  // seeing Sales must NOT by itself reach customer debt.
  canManageCredits: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.MANAGE_CREDITS),
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
  /**
   * Ends a stay WITHOUT billing it, deciding how much of the deposit is kept.
   *
   * Deliberately NOT part of the view/check_in/manage ladder: writing off a
   * guest's bill is not a bigger version of configuring rooms, and a front-desk
   * receptionist who checks guests in all day should not acquire it by default.
   * The owner passes because `hasPermission` is true for `restaurant_admin`.
   *
   * The permission decides who may TRY. The Security PIN — checked separately in
   * `cancelRoomStay`, for everyone including the owner — decides whether it goes
   * through, and records both outcomes.
   */
  canCancelStay: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.CANCEL_ROOM_STAY),
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

// ─── Item Sales ───────────────────────────────────────────────────────────────
// Units sold per menu item. Read-only, one permission; `restaurant_admin` passes.
export const ITEM_SALES_ACCESS = {
  canView: (u: { role: string; permissions: string[] }) =>
    hasPermission(u, P_.VIEW_ITEM_SALES),
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
// Job-type templates that set every section in one click. Written as SECTION LEVELS
// (not raw keys) so a preset is always something the editor can show exactly — and
// matchPreset can recognise it again. Presets are a convenience only: the admin can
// still change any section afterwards. The chosen preset is NOT stored; only the
// resulting permission list is persisted on the staff record.

export type StaffPresetDef = {
  key: string;
  label: string;
  description: string;
  permissions: Permission[];
};

function preset(
  key: string,
  label: string,
  description: string,
  levels: Record<string, string>,
  extras: Permission[] = []
): StaffPresetDef {
  const permissions = new Set<Permission>(extras);
  for (const [sectionKey, levelKey] of Object.entries(levels)) {
    const level = ACCESS_SECTIONS.find((s) => s.key === sectionKey)?.levels.find((l) => l.key === levelKey);
    if (!level) throw new Error(`preset ${key}: unknown level ${sectionKey}.${levelKey}`);
    for (const p of level.permissions) permissions.add(p);
  }
  return { key, label, description, permissions: [...permissions] };
}

// Presets are a LADDER: each front-of-house role is the one below it plus what the job
// adds, so a cashier can always do anything a waiter can.
//   Waiter       — sees tables, walk-ins and rooms, adds items, marks them served.
//                  Cannot take payment or close a bill (that is the Billing section).
//   Cashier      — Waiter + take payment / close bills, Sales, Credits, discounts.
//   Receptionist — Cashier + the rooms front desk (check guests in and out).
//   Manager      — Receptionist + full tables/rooms/menu, cancel orders, staff list.
const WAITER_LEVELS = { tables: "view", orders: "full", walkins: "full", rooms: "view" };
const CASHIER_LEVELS = { ...WAITER_LEVELS, billing: "full", sales: "view", credits: "full" };
const CASHIER_EXTRAS: Permission[] = [P.APPLY_DISCOUNTS, P.MANAGE_CUSTOM_ITEMS];
const RECEPTIONIST_LEVELS = { ...CASHIER_LEVELS, rooms: "checkin" };

export const STAFF_PRESETS: StaffPresetDef[] = [
  preset(
    "waiter",
    "Waiter",
    "Sees tables, walk-ins and rooms and adds items to them. Can't take payment or close a bill.",
    WAITER_LEVELS
  ),
  preset(
    "cashier",
    "Cashier",
    "Everything a waiter can, plus taking payment, closing bills, Sales and Credits.",
    CASHIER_LEVELS,
    CASHIER_EXTRAS
  ),
  preset(
    "receptionist",
    "Receptionist",
    "Everything a cashier can, plus checking guests in and out. No room configuration.",
    RECEPTIONIST_LEVELS,
    CASHIER_EXTRAS
  ),
  preset(
    "chef",
    "Chef / Kitchen",
    "Works the kitchen queue and toggles menu availability.",
    { tables: "view", orders: "kitchen", menu: "full" }
  ),
  preset(
    "manager",
    "Manager",
    "Everything a receptionist can, plus full tables, rooms and menu, cancelling orders and the staff list.",
    { ...RECEPTIONIST_LEVELS, tables: "full", rooms: "full", menu: "full", staff: "view" },
    [...CASHIER_EXTRAS, P.CANCEL_ORDERS]
  ),
  preset(
    "host",
    "Host / Guest",
    "View-only access to the tables.",
    { tables: "view" }
  ),
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
