// Staff payout mode → which payroll a restaurant runs.
//
// Stored in `restaurants.settings` (JSON), set by the Super Admin when the client is
// created or edited:
//   payout_mode       "standard" (monthly salary / cycles — the default) | "advanced" (rota, hourly)
//   rota_pay_period   "weekly" | "fortnightly" | "monthly"   (advanced only)
//
// Everything that branches on the mode reads THESE helpers — never the raw JSON — so a
// restaurant with no setting at all (every client before this existed) is "standard".

export type PayoutMode = "standard" | "advanced";
export type RotaPayPeriod = "weekly" | "fortnightly" | "monthly";

export const PAYOUT_MODE_LABEL: Record<PayoutMode, string> = {
  standard: "Default staff payout",
  advanced: "Advanced payout",
};

export const ROTA_PAY_PERIOD_LABEL: Record<RotaPayPeriod, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
};

/**
 * Weekly and fortnightly periods are aligned on this Monday. Fixed rather than
 * per-restaurant so fortnights never shift when the mode is toggled.
 */
export const ROTA_PERIOD_ANCHOR = "2026-01-05";

type SettingsLike = Record<string, unknown> | null | undefined;

export function normalizePayoutMode(settings: SettingsLike): PayoutMode {
  return settings?.payout_mode === "advanced" ? "advanced" : "standard";
}

export function normalizeRotaPayPeriod(settings: SettingsLike): RotaPayPeriod {
  const v = settings?.rota_pay_period;
  return v === "fortnightly" || v === "monthly" ? v : "weekly";
}

export function isAdvancedPayout(settings: SettingsLike): boolean {
  return normalizePayoutMode(settings) === "advanced";
}

/** Read the two fields off a submitted form; null when they are invalid. */
export function parsePayoutForm(
  formData: FormData
): { payout_mode: PayoutMode; rota_pay_period: RotaPayPeriod } | null {
  const mode = (formData.get("payout_mode") as string) || "standard";
  const period = (formData.get("rota_pay_period") as string) || "weekly";
  if (mode !== "standard" && mode !== "advanced") return null;
  if (period !== "weekly" && period !== "fortnightly" && period !== "monthly") return null;
  return { payout_mode: mode, rota_pay_period: period };
}
