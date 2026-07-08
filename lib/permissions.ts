export const PERMISSIONS = {
  // Dashboard
  VIEW_DASHBOARD:   "view_dashboard",
  // Orders
  CREATE_ORDERS:    "create_orders",
  EDIT_ORDERS:      "edit_orders",
  CANCEL_ORDERS:    "cancel_orders",
  CLOSE_BILLS:      "close_bills",
  // Menu
  VIEW_MENU:        "view_menu",
  MANAGE_MENU:      "manage_menu",
  // Tables
  VIEW_TABLES:      "view_tables",
  MANAGE_TABLES:    "manage_tables",
  // Rooms
  VIEW_ROOMS:       "view_rooms",
  MANAGE_ROOMS:     "manage_rooms",
  // Billing
  PROCESS_PAYMENTS: "process_payments",
  APPLY_DISCOUNTS:  "apply_discounts",
  REFUND_BILLS:     "refund_bills",
  // Customers
  VIEW_CUSTOMERS:   "view_customers",
  MANAGE_CUSTOMERS: "manage_customers",
  // Reports
  VIEW_REPORTS:     "view_reports",
  // Staff
  VIEW_STAFF:       "view_staff",
  CREATE_STAFF:     "create_staff",
  EDIT_STAFF:       "edit_staff",
  DELETE_STAFF:     "delete_staff",
  // Settings
  VIEW_SETTINGS:    "view_settings",
  MANAGE_SETTINGS:  "manage_settings",
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
      { key: "create_orders",  label: "Create Orders" },
      { key: "edit_orders",    label: "Edit Orders" },
      { key: "cancel_orders",  label: "Cancel Orders" },
      { key: "close_bills",    label: "Close Bills" },
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
    label: "Rooms",
    items: [
      { key: "view_rooms",   label: "View Rooms" },
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
    label: "Customers",
    items: [
      { key: "view_customers",   label: "View Customers" },
      { key: "manage_customers", label: "Manage Customers" },
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
    label: "Settings",
    items: [
      { key: "view_settings",   label: "View Settings" },
      { key: "manage_settings", label: "Manage Restaurant Settings" },
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
      P.CREATE_ORDERS,
      P.VIEW_MENU,
      P.VIEW_TABLES,
      P.CLOSE_BILLS,
      P.PROCESS_PAYMENTS,
      P.APPLY_DISCOUNTS,
    ],
  },
  {
    key: "chef",
    label: "Chef / Kitchen",
    description: "Works the kitchen queue. Views the dashboard and menu.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_MENU,
    ],
  },
  {
    key: "manager",
    label: "Manager",
    description: "Broad operational access across orders, billing, menu, tables and reports.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.CREATE_ORDERS,
      P.EDIT_ORDERS,
      P.CANCEL_ORDERS,
      P.CLOSE_BILLS,
      P.VIEW_MENU,
      P.MANAGE_MENU,
      P.VIEW_TABLES,
      P.MANAGE_TABLES,
      P.VIEW_ROOMS,
      P.MANAGE_ROOMS,
      P.PROCESS_PAYMENTS,
      P.APPLY_DISCOUNTS,
      P.REFUND_BILLS,
      P.VIEW_CUSTOMERS,
      P.MANAGE_CUSTOMERS,
      P.VIEW_REPORTS,
      P.VIEW_STAFF,
      P.VIEW_SETTINGS,
      P.MANAGE_SETTINGS,
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
