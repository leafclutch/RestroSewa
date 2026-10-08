export type DiscountMode = "amount" | "percent";

/**
 * The rupee discount a typed value means, clamped to [0, base]. In percent mode the value
 * is a % of `base` (the order total / folio subtotal). Shared by the checkout forms and
 * the unpaid-bill previews, so the bill the customer is handed shows exactly what will be
 * knocked off at payment.
 */
export function resolveDiscount(input: string, mode: DiscountMode, base: number): number {
  const v = Math.max(parseFloat(input) || 0, 0);
  const amt = mode === "percent" ? (base * Math.min(v, 100)) / 100 : v;
  return Math.round(Math.min(amt, base) * 100) / 100;
}

/** `part` as a percentage of `whole`, to at most 2 decimals with trailing zeros dropped
 *  ("10%", "12.5%", "3.33%"). */
export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Number(((part / whole) * 100).toFixed(2))}%`;
}
