"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_CURRENCY, currencyFormatter, type CurrencyFormatter } from "@/lib/currency";

const CurrencyContext = createContext<string>(DEFAULT_CURRENCY);

/**
 * Makes the restaurant's currency available to every client component below it.
 * Mounted by the admin, staff and customer layouts with the code read fresh on each
 * request, so changing it in Settings shows up on the very next navigation.
 */
export function CurrencyProvider({ code, children }: { code: string; children: React.ReactNode }) {
  return <CurrencyContext.Provider value={code}>{children}</CurrencyContext.Provider>;
}

/** The restaurant's currency and its formatters (`money`, `money2`, `symbol`, …). */
export function useCurrency(): CurrencyFormatter {
  const code = useContext(CurrencyContext);
  return useMemo(() => currencyFormatter(code), [code]);
}
