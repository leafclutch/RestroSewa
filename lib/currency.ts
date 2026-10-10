// The restaurant's display currency.
//
// Stored as an ISO 4217 code under `restaurants.settings.currency`, chosen by the owner
// in Settings. It changes how money is DISPLAYED, never what is stored: every amount in
// the database is a plain number, so switching currency relabels figures without
// converting them.
//
// Isomorphic on purpose (no "server-only"): server actions, printed reports and the
// client `useCurrency()` hook all format through `currencyFormatter`, so a bill, a
// dashboard and an error message can never disagree about how ₹1,500 is written.

export type CurrencyInfo = {
  /** ISO 4217 code — the value stored in settings. */
  code: string;
  /** Name shown in the Settings dropdown. */
  name: string;
  /** Short symbol used in labels and input adornments ("Amount (₹)"). */
  symbol: string;
  /** Locale for digit grouping: en-IN gives 1,00,000; en-US gives 100,000. */
  locale: string;
};

// NPR is the default: every restaurant on the platform trades in Nepal, so one that has
// never opened Settings (or was just created) shows Nepali Rupees without any setup.
export const DEFAULT_CURRENCY = "NPR";

export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: "NPR", name: "Nepali Rupee", symbol: "Rs.", locale: "en-IN" },
  { code: "INR", name: "Indian Rupee", symbol: "₹", locale: "en-IN" },
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US" },
  { code: "EUR", name: "Euro", symbol: "€", locale: "en-IE" },
  { code: "GBP", name: "British Pound", symbol: "£", locale: "en-GB" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", locale: "en-AU" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", locale: "en-CA" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", locale: "en-SG" },
  { code: "AED", name: "UAE Dirham", symbol: "AED", locale: "en-AE" },
  { code: "SAR", name: "Saudi Riyal", symbol: "SAR", locale: "en-US" },
  { code: "QAR", name: "Qatari Riyal", symbol: "QAR", locale: "en-US" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", locale: "ja-JP" },
  { code: "CNY", name: "Chinese Yuan", symbol: "CN¥", locale: "zh-CN" },
  { code: "KRW", name: "South Korean Won", symbol: "₩", locale: "ko-KR" },
  { code: "THB", name: "Thai Baht", symbol: "฿", locale: "th-TH" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", locale: "en-MY" },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", locale: "en-IN" },
  { code: "PKR", name: "Pakistani Rupee", symbol: "Rs", locale: "en-PK" },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "Rs", locale: "en-LK" },
  { code: "BTN", name: "Bhutanese Ngultrum", symbol: "Nu.", locale: "en-IN" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", locale: "de-CH" },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** Any stored value → a supported code. Unknown or missing falls back to the default. */
export function normalizeCurrency(raw: unknown): string {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return BY_CODE.has(code) ? code : DEFAULT_CURRENCY;
}

export function currencyInfo(code: unknown): CurrencyInfo {
  return BY_CODE.get(normalizeCurrency(code))!;
}

/**
 * "INR 1,500.00" — the ISO code rather than the symbol, for emailed and PDF reports.
 * The PDF's standard fonts can't draw ₹, रु or ৳, and a code is unambiguous in an inbox.
 */
export function reportMoney(code: unknown): (n: number) => string {
  const info = currencyInfo(code);
  return (n) =>
    `${info.code} ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(info.locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
}

export type CurrencyFormatter = CurrencyInfo & {
  /** What goes in front of a number: "₹", "$", or "Rs. " — letter symbols get a space. */
  prefix: string;
  /** Whole units, grouped: "₹1,500". */
  money: (n: number) => string;
  /** Two decimals, grouped: "₹1,500.00". */
  money2: (n: number) => string;
  /** Up to two decimals, grouped, trailing zeros dropped: "₹1,500" / "₹1,500.5". */
  moneyUpTo2: (n: number) => string;
  /** Like `money2`, with a real minus sign in front of the symbol: "−₹1,500.00". */
  signed2: (n: number) => string;
  /** Left padding for an input with the symbol drawn inside it — wide enough for "AED". */
  inputPad: string;
};

export function currencyFormatter(code: unknown): CurrencyFormatter {
  const info = currencyInfo(code);
  // "₹1,500" reads fine; "Rs.1,500" or "AED1,500" does not.
  const prefix = /[A-Za-z.]$/.test(info.symbol) ? `${info.symbol} ` : info.symbol;
  const group = (n: number, min: number, max: number) =>
    Number(n || 0).toLocaleString(info.locale, {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });

  return {
    ...info,
    prefix,
    money: (n) => prefix + group(Math.round(Number(n) || 0), 0, 0),
    money2: (n) => prefix + group(n, 2, 2),
    moneyUpTo2: (n) => prefix + group(n, 0, 2),
    signed2: (n) => `${n < 0 ? "−" : ""}${prefix}${group(Math.abs(n), 2, 2)}`,
    inputPad: `max(1.75rem, calc(1rem + ${info.symbol.length}ch))`,
  };
}
