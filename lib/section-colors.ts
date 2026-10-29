/**
 * Each dashboard section's accent, so staff recognise a section by colour before they read
 * its title. One accent per section, used for its icon, title, header rule and count badge.
 *
 * The values are `var()` references, not hex, so a section keeps its identity in dark mode
 * without every call site knowing the theme. The tokens live in `app/globals.css` under
 * `:root` / `.dark` — deliberately outside `@theme`, because a section's colour is *data*
 * (it arrives as a key at render time) and Tailwind v4 can neither generate `bg-${key}` nor
 * see a var() inside a style object, so a theme token would be pruned.
 *
 * Status colour is a separate axis and deliberately NOT re-themed per section — see
 * lib/status-colors.ts. A section says *where you are*; a status says *what's happening*.
 */
export type SectionAccentKey =
  | "orders"
  | "tables"
  | "walkins"
  | "rooms"
  | "sales"
  | "credits"
  | "menu"
  | "notifications"
  | "stock"
  | "purchases"
  | "vendors"
  | "itemSales"
  | "expenses"
  | "payroll";

export type SectionAccent = {
  /** Title, icon, badge text, header rule. Clears 4.5:1 on the page canvas in both themes. */
  color: string;
  /** The tint behind an icon tile or badge. */
  soft: string;
  /**
   * A SOLID background white text can sit on, in both themes — a constant `--fill-*`,
   * because `color` flips to a light 400-tier in dark and white on it is unreadable.
   */
  fill: string;
};

export const SECTION_ACCENT: Record<SectionAccentKey, SectionAccent> = {
  orders:        { color: "var(--sec-orders)",        soft: "var(--sec-orders-soft)",        fill: "var(--fill-amber)" },
  tables:        { color: "var(--sec-tables)",        soft: "var(--sec-tables-soft)",        fill: "var(--fill-blue)" },
  walkins:       { color: "var(--sec-walkins)",       soft: "var(--sec-walkins-soft)",       fill: "var(--fill-purple)" },
  rooms:         { color: "var(--sec-rooms)",         soft: "var(--sec-rooms-soft)",         fill: "var(--fill-teal)" },
  sales:         { color: "var(--sec-sales)",         soft: "var(--sec-sales-soft)",         fill: "var(--fill-sales)" },
  credits:       { color: "var(--sec-credits)",       soft: "var(--sec-credits-soft)",       fill: "var(--fill-indigo)" },
  menu:          { color: "var(--sec-menu)",          soft: "var(--sec-menu-soft)",          fill: "var(--fill-green)" },
  notifications: { color: "var(--sec-notifications)", soft: "var(--sec-notifications-soft)", fill: "var(--fill-red)" },
  // Back-office sections — each on a hue none of the above uses.
  stock:         { color: "var(--sec-stock)",         soft: "var(--sec-stock-soft)",         fill: "var(--fill-sky)" },
  purchases:     { color: "var(--sec-purchases)",     soft: "var(--sec-purchases-soft)",     fill: "var(--fill-pink)" },
  vendors:       { color: "var(--sec-vendors)",       soft: "var(--sec-vendors-soft)",       fill: "var(--fill-lime)" },
  itemSales:     { color: "var(--sec-itemsales)",     soft: "var(--sec-itemsales-soft)",     fill: "var(--fill-fuchsia)" },
  expenses:      { color: "var(--sec-expenses)",      soft: "var(--sec-expenses-soft)",      fill: "var(--fill-orange)" },
  payroll:       { color: "var(--sec-payroll)",       soft: "var(--sec-payroll-soft)",       fill: "var(--fill-slate)" },
};

/** Falls back to the neutral ink colour for any key without an accent. */
export function accentOf(key: string): SectionAccent {
  return (
    SECTION_ACCENT[key as SectionAccentKey] ?? {
      color: "var(--color-ink)",
      soft: "var(--color-canvas-soft)",
      fill: "var(--color-brand-dark)",
    }
  );
}
