"use client";

import { useActionState, useEffect, useRef, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closeSessionWithPayment,
  updateOrderItemStatus,
  forceCloseSession,
  cancelOrderItem,
  updateWalkInCustomer,
  updateTableCustomerName,
} from "@/app/actions/pos";
import type { ActionResult, OrderItemRow, SessionDetail } from "@/app/actions/pos";
import { searchCreditCustomers } from "@/app/actions/credits";
import type { CreditCustomer } from "@/app/actions/credits";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronRight, Plus, Receipt, User, X, Pencil, Lock, Wallet, Banknote, MonitorSmartphone, CreditCard, HandCoins, ArrowRight, ConciergeBell } from "lucide-react";
import { SECTION_ACCENT } from "@/lib/section-colors";
import { OrderItem } from "@/app/(employee)/employee/_components/order-item";
import { SessionPrintButtons } from "./print-tickets";
import type { RestaurantInfo, PrintStation } from "./print-tickets";
import { DiscountUnitToggle } from "@/app/(employee)/employee/_components/discount-unit-toggle";
import { formatPercent, resolveDiscount, type DiscountMode } from "@/lib/billing/discount";
import { useCurrency } from "@/components/currency-provider";


type PaymentMethod = "cash" | "online" | "card" | "mixed" | "credit";
// A credit down payment can itself be split — a customer often hands over some
// cash AND pays some online before the rest goes on their account.
type DownTender = "cash" | "online" | "card" | "mixed";

const PAYMENT_METHODS: { value: PaymentMethod; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { value: "cash",   label: "Cash",          Icon: Banknote },
  { value: "online", label: "Online",        Icon: MonitorSmartphone },
  { value: "mixed",  label: "Cash + Online", Icon: Wallet },
  { value: "credit", label: "Credit",        Icon: HandCoins },
  { value: "card",   label: "Card",          Icon: CreditCard },
];

/** The bill screen's colour: Tables blue, Walk-ins purple. `fill` is the constant solid
 *  (white text sits on it in both themes); `color`/`soft` are the theme-flipping accent. */
export type BillAccent = { color: string; soft: string; fill: string };
export function billAccentFor(type: SessionDetail["type"]): BillAccent {
  return type === "walk_in"
    ? { ...SECTION_ACCENT.walkins, fill: "var(--fill-purple)" }
    : { ...SECTION_ACCENT.tables, fill: "var(--fill-blue)" };
}

const DOWN_TENDERS: { value: DownTender; label: string }[] = [
  { value: "cash",   label: "Cash"   },
  { value: "online", label: "Online" },
  { value: "card",   label: "Card"   },
  { value: "mixed",  label: "Cash + Online" },
];

function PaymentForm({
  session,
  canUseCredit,
  discountEnabled,
  discountAmt,
  setDiscountAmt,
  discountMode,
  setDiscountMode,
  accent,
  onClose,
}: {
  session: SessionDetail;
  canUseCredit: boolean;
  accent: BillAccent;
  /** Shown as the card's ✕ when it's open as a popup. */
  onClose?: () => void;
  /** Whether the restaurant has a discount PIN configured. No PIN = no discounts at all,
   *  so the field isn't shown. The PIN is still verified server-side at payment. */
  discountEnabled: boolean;
  /** Lifted to SessionClient so the unpaid-bill preview prints the same discount. */
  discountAmt: string;
  setDiscountAmt: (v: string) => void;
  discountMode: DiscountMode;
  setDiscountMode: (m: DiscountMode) => void;
}) {
  const cur = useCurrency();
  // A directly-controlled submit rather than `useActionState` + native `<form
  // action>` — that combination relies on `pending` reliably flipping
  // true→false in the same render cycle a `wasPending` ref effect can catch,
  // and in testing the post-close redirect this drove sometimes just never
  // fired. This version awaits the action itself and reacts to its result in
  // the SAME function call — no separate effect, no transition-timing to get
  // right — mirroring the already-reliable `run()` in `tables-grid.tsx`.
  const [state, setState] = useState<ActionResult>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      // The CREDIT branch of `closeSessionWithPayment` still redirects itself
      // (to the dashboard's credit view — a different, deliberate
      // destination) by throwing — NOT caught here, so it propagates and
      // Next performs that navigation on its own; this code simply never
      // reaches the lines below for that branch.
      const res = await closeSessionWithPayment(null, formData);
      if (res?.error) {
        setState(res);
        return;
      }
      setState(null);
      // Destination: Sales, not the previous table or the dashboard — a
      // normal paid-in-full close is the one flow that ends with printing
      // the bill. `?session=` (not just `?focus=sales`) is what lets Sales
      // scroll straight to and ring THIS bill specifically, rather than
      // leaving the cashier to find it in today's list themselves — see
      // `sales-view.tsx`'s `highlightSessionId`.
      router.push(`/employee/dashboard?focus=sales&session=${session.id}`);
    });
  }
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashAmt, setCashAmt]     = useState("");
  const [onlineAmt, setOnlineAmt] = useState("");
  // Knocked off at payment ("Rs 1020 → just give me 1000"). Everything below tenders,
  // validates and submits against the PAYABLE, never the raw order total. The typed value
  // (₹ or %) is held by SessionClient — see the props.
  // The admin's discount PIN authorizing that reduction. Held only long enough to submit.
  const [discountPin, setDiscountPin] = useState("");

  // Credit — WHICH customer's account, and what (if anything) they're paying now.
  const [custQuery, setCustQuery]     = useState("");
  const [matches, setMatches]         = useState<CreditCustomer[]>([]);
  const [searching, setSearching]     = useState(false);
  const [picked, setPicked]           = useState<CreditCustomer | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [custName, setCustName]       = useState("");
  const [custPhone, setCustPhone]     = useState("");
  const [paidNow, setPaidNow]         = useState("");
  const [downTender, setDownTender]   = useState<DownTender>("cash");
  // The cash/online halves when the down payment is itself split.
  const [downCash, setDownCash]       = useState("");
  const [downOnline, setDownOnline]   = useState("");
  const [creditNotes, setCreditNotes] = useState("");

  // Debounced lookup of existing accounts. This is what stops a returning
  // customer being handed a second Credit ID: the cashier picks the account
  // instead of retyping the name.
  useEffect(() => {
    if (method !== "credit" || picked || creatingNew) {
      setMatches([]);
      return;
    }
    const q = custQuery.trim();
    if (q.length < 2) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const found = await searchCreditCustomers(q);
        if (alive) setMatches(found);
      } catch {
        if (alive) setMatches([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [custQuery, method, picked, creatingNew]);

  const orderTotal = session.total;
  // Capped at the order total so the payable can never go negative — the server
  // refuses that anyway, but the cashier should see it clamp as they type. With no PIN
  // configured there is no discount to speak of, so it's pinned to 0.
  const discount = discountEnabled ? resolveDiscount(discountAmt, discountMode, orderTotal) : 0;
  const payable = Math.max(0, orderTotal - discount);
  // The server is the real gate; this just stops an obviously-incomplete submit.
  const discountPinValid = discount === 0 || /^\d{4}$/.test(discountPin);

  const methods = canUseCredit
    ? PAYMENT_METHODS
    : PAYMENT_METHODS.filter((m) => m.value !== "credit");

  function handleCashChange(val: string) {
    setCashAmt(val);
    const cash = parseFloat(val);
    setOnlineAmt(!isNaN(cash) && cash >= 0 ? Math.max(0, payable - cash).toFixed(2) : "");
  }

  function handleOnlineChange(val: string) {
    setOnlineAmt(val);
    const online = parseFloat(val);
    setCashAmt(!isNaN(online) && online >= 0 ? Math.max(0, payable - online).toFixed(2) : "");
  }

  // A new discount moves the payable, which strands any split already typed against
  // the old one — clear it rather than submit a split that no longer adds up.
  function handleDiscountChange(val: string) {
    setDiscountAmt(val);
    setCashAmt("");
    setOnlineAmt("");
  }

  // Switching ₹ ↔ % reinterprets the typed number, so start the field over.
  function handleDiscountModeChange(mode: DiscountMode) {
    if (mode === discountMode) return;
    setDiscountMode(mode);
    handleDiscountChange("");
  }

  const bothFilled = cashAmt !== "" && onlineAmt !== "";
  const mixedSum   = (parseFloat(cashAmt) || 0) + (parseFloat(onlineAmt) || 0);
  const mixedValid = method !== "mixed" || (bothFilled && Math.abs(mixedSum - payable) < 0.01);

  // Credit: blank "paid now" means the whole bill goes on credit.
  const paidNowNum   = parseFloat(paidNow) || 0;
  const creditAmount = Math.max(0, payable - paidNowNum);
  const paidNowValid = paidNowNum >= 0 && paidNowNum < payable;
  // A split down payment: its two halves must add up to what's being paid now.
  const downSplit = (parseFloat(downCash) || 0) + (parseFloat(downOnline) || 0);
  const downSplitValid =
    downTender !== "mixed" ||
    paidNowNum === 0 ||
    (downCash !== "" && downOnline !== "" && Math.abs(downSplit - paidNowNum) < 0.01);
  // Either an existing account is selected, or a new one is being named.
  const customerChosen = !!picked || (creatingNew && custName.trim().length > 0);
  const creditValid = method !== "credit" || (customerChosen && paidNowValid && downSplitValid);

  const canSubmit =
    !pending &&
    mixedValid &&
    creditValid &&
    discountPinValid &&
    (method !== "mixed" || bothFilled);

  const errorMsg = state?.error;

  // What the server records as tendered. On a credit bill this is the down
  // payment only — the rest is the credit. A mixed down payment splits `paidNow`
  // across cash and online; the DB already stores these as separate columns, so
  // finance buckets each half correctly.
  const tender = {
    cash:
      method === "cash" ? payable
      : method === "credit" && downTender === "cash"  ? paidNowNum
      : method === "credit" && downTender === "mixed" ? (parseFloat(downCash) || 0)
      : 0,
    online:
      method === "online" ? payable
      : method === "credit" && downTender === "online" ? paidNowNum
      : method === "credit" && downTender === "mixed"  ? (parseFloat(downOnline) || 0)
      : 0,
    card:   method === "card"  ? payable : method === "credit" && downTender === "card"   ? paidNowNum : 0,
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="session_id"   value={session.id} />
      {/* `total_amount` is the NET sale — the payable, not the order total. That's the
          figure Sales, Finance and the reports all sum. */}
      <input type="hidden" name="total_amount"    value={payable.toFixed(2)} />
      <input type="hidden" name="discount_amount" value={discount.toFixed(2)} />

      {/* Tender split. Mixed drives cash/online from its own inputs, so it opts
          out of these pre-computed values. */}
      {method !== "mixed" && (
        <>
          <input type="hidden" name="cash_amount"   value={tender.cash.toFixed(2)} />
          <input type="hidden" name="online_amount" value={tender.online.toFixed(2)} />
          <input type="hidden" name="card_amount"   value={tender.card.toFixed(2)} />
        </>
      )}

      {/* The chosen account wins; the name/phone are only used when opening a new
          one. Sending the id is what guarantees a returning customer keeps their
          single Credit ID. */}
      {method === "credit" && (
        <>
          <input type="hidden" name="credit_customer_id"    value={picked?.id ?? ""} />
          <input type="hidden" name="credit_customer_name"  value={picked ? "" : custName} />
          <input type="hidden" name="credit_customer_phone" value={picked ? "" : custPhone} />
        </>
      )}

      <div className="flex items-center gap-3">
        <span
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: accent.fill, color: "#fff" }}
        >
          <Wallet size={21} strokeWidth={1.9} />
        </span>
        <p className="text-lg font-semibold flex-1" style={{ color: "var(--color-ink)" }}>
          Close &amp; collect payment
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-canvas-soft"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Order Total → Discount → Final Payable. Everything below collects against the
          payable, so the cashier sees what they're about to take before choosing how. */}
      <div
        className="rounded-xl px-4 py-3 flex flex-col gap-2.5"
        style={{ background: "var(--color-canvas-soft)", border: "1px solid var(--color-hairline)" }}
      >
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: "var(--color-ink-mute)" }}>Order total</span>
          <span className="tabular" style={{ color: "var(--color-ink)" }}>{cur.prefix}{orderTotal.toFixed(2)}</span>
        </div>

        {discountEnabled ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="discount_input" className="text-sm shrink-0" style={{ color: "var(--color-ink-mute)" }}>
                Discount
              </label>
              <div className="flex items-center gap-2">
                <DiscountUnitToggle mode={discountMode} onChange={handleDiscountModeChange} />
                <Input
                  id="discount_input"
                  type="number"
                  min="0"
                  max={discountMode === "percent" ? 100 : orderTotal}
                  step="0.01"
                  placeholder={discountMode === "percent" ? "0" : "0.00"}
                  value={discountAmt}
                  onChange={(e) => handleDiscountChange(e.target.value)}
                  className="max-w-[120px] text-right"
                />
              </div>
            </div>

            {/* The other unit, so the cashier sees both ₹ and % whichever they typed. */}
            {discount > 0 && (
              <p className="text-xs text-right tabular" style={{ color: "var(--color-ink-mute)" }}>
                {discountMode === "percent"
                  ? `= ${cur.prefix}${discount.toFixed(2)}`
                  : `= ${formatPercent(discount, orderTotal)}`}
              </p>
            )}

            {/* Only asked for once there's actually something to authorize. */}
            {discount > 0 && (
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="discount_pin" className="text-sm shrink-0" style={{ color: "var(--color-ink-mute)" }}>
                  Discount PIN
                </label>
                <Input
                  id="discount_pin"
                  name="discount_pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="••••"
                  value={discountPin}
                  onChange={(e) => setDiscountPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="max-w-[140px] text-right tracking-[0.4em]"
                />
              </div>
            )}
            {discount > 0 && !discountPinValid && (
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                Enter the 4-digit discount PIN to authorize this reduction.
              </p>
            )}
          </>
        ) : (
          <div className="flex items-start gap-2">
            <Lock size={13} className="mt-0.5 shrink-0" style={{ color: "var(--color-ink-mute)" }} />
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Discounts are turned off. Ask your admin to set a discount PIN in Settings.
            </p>
          </div>
        )}

        <div
          className="flex items-center justify-between pt-2 border-t"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <span className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>Final payable</span>
          <span className="text-2xl font-semibold tabular" style={{ color: accent.color }}>
            {cur.prefix}{payable.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Method selector — "Quick Payment" buttons; the chosen one fills solid. */}
      <div className="flex flex-col gap-2.5">
        <p className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>
          Quick Payment
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {methods.map((m) => {
            const active = method === m.value;
            const isCredit = m.value === "credit";
            // Credit keeps its own orange: it's the one choice that leaves money owed.
            const on = isCredit ? "#ea580c" : accent.fill;
            return (
              <label
                key={m.value}
                className="flex items-center gap-2 cursor-pointer justify-center px-2 py-2.5 rounded-xl border text-sm font-medium transition-colors leading-tight text-center"
                style={{
                  borderColor: active ? on : "var(--color-hairline-input)",
                  background: active ? on : "var(--color-canvas)",
                  color: active ? "#fff" : "var(--color-ink)",
                  boxShadow: active ? "none" : "0 1px 2px rgba(15,23,42,0.05)",
                }}
              >
                <m.Icon size={16} />
                <input
                  type="radio"
                  name="payment_method"
                  value={m.value}
                  checked={active}
                  onChange={() => { setMethod(m.value); setCashAmt(""); setOnlineAmt(""); }}
                  className="sr-only"
                />
                {m.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Cash / online / card collect the payable in full — the Final payable line above
          already states it, so there's nothing more to show or ask for. */}

      {/* Mixed: two inputs with auto-calculation */}
      {method === "mixed" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cash_amount"
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Cash amount ({cur.symbol})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "var(--color-ink-mute)" }}>{cur.symbol}</span>
              <Input style={{ paddingLeft: cur.inputPad }}
                id="cash_amount"
                name="cash_amount"
                type="number"
                min="0"
                max={payable}
                step="0.01"
                placeholder="0.00"
                value={cashAmt}
                onChange={(e) => handleCashChange(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="online_amount"
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Online amount ({cur.symbol})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "var(--color-ink-mute)" }}>{cur.symbol}</span>
              <Input style={{ paddingLeft: cur.inputPad }}
                id="online_amount"
                name="online_amount"
                type="number"
                min="0"
                max={payable}
                step="0.01"
                placeholder="0.00"
                value={onlineAmt}
                onChange={(e) => handleOnlineChange(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>

          {bothFilled && !mixedValid && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
              The combined Cash and Online amounts must equal the total payable amount ({cur.money(payable)}).
            </p>
          )}
          {bothFilled && mixedValid && (
            <p className="text-xs" style={{ color: "var(--color-success)" }}>
              ✓ Amounts match
            </p>
          )}
        </div>
      )}

      {/* Credit: close the bill with all or part of it still owed. */}
      {method === "credit" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            The bill is closed in full, and the unpaid balance is added to the customer&apos;s
            credit account so it can be collected later.
          </p>

          {/* An account is CHOSEN, not re-created. A returning customer keeps their
              one Credit ID and their balance simply grows. */}
          {picked ? (
            <div
              className="rounded-lg border px-4 py-3 flex items-start gap-3"
              style={{ background: "var(--color-success-bg)", borderColor: "color-mix(in srgb, var(--color-success) 27%, transparent)" }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                  {picked.name}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
                  {picked.customer_code}
                  {picked.phone ? ` · ${picked.phone}` : ""}
                </p>
                {picked.balance > 0 && (
                  <p className="text-xs mt-1" style={{ color: "var(--color-warning)" }}>
                    Already owes {cur.prefix}{picked.balance.toFixed(2)} — this bill will be added to it.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setPicked(null); setCustQuery(""); }}
                className="text-xs px-2 py-1 rounded-md border shrink-0"
                style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="credit_search"
                  className="text-xs uppercase tracking-wide"
                  style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                >
                  Find the customer
                </label>
                <Input
                  id="credit_search"
                  type="search"
                  autoComplete="off"
                  placeholder="Search by phone number or name…"
                  value={custQuery}
                  onChange={(e) => setCustQuery(e.target.value)}
                />
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  Phone is the surest way to find a returning customer.
                </p>
              </div>

              {/* Matching accounts — tap one to reuse it. */}
              {searching && (
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Searching…</p>
              )}

              {matches.length > 0 && (
                <div
                  className="rounded-lg border overflow-hidden"
                  style={{ borderColor: "var(--color-hairline)" }}
                >
                  {matches.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPicked(m)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                      style={{
                        borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)",
                        background: "var(--color-canvas)",
                      }}
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate" style={{ color: "var(--color-ink)" }}>
                          {m.name}
                        </span>
                        <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
                          {m.customer_code}{m.phone ? ` · ${m.phone}` : ""}
                        </span>
                      </span>
                      <span
                        className="text-sm tabular-nums shrink-0"
                        style={{ color: m.balance > 0 ? "var(--color-danger)" : "var(--color-ink-mute)" }}
                      >
                        {m.balance > 0 ? `${cur.money(m.balance)}` : "settled"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Nothing matched — open a new account without leaving the screen. */}
              {custQuery.trim().length >= 2 && !searching && matches.length === 0 && !creatingNew && (
                <button
                  type="button"
                  onClick={() => {
                    setCreatingNew(true);
                    // Prefill whichever field they typed: digits look like a phone.
                    const q = custQuery.trim();
                    if (/^[\d+\-\s]+$/.test(q)) setCustPhone(q);
                    else setCustName(q);
                  }}
                  className="w-full text-sm py-2 rounded-lg border"
                  style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
                >
                  + Create new credit account
                </button>
              )}

              {creatingNew && (
                <div
                  className="rounded-lg border px-3 py-3 flex flex-col gap-3"
                  style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
                >
                  <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
                    New credit account
                  </p>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="credit_customer_name"
                      className="text-xs uppercase tracking-wide"
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      Customer name <span style={{ color: "var(--color-ruby)" }}>*</span>
                    </label>
                    <Input
                      id="credit_customer_name"
                      type="text"
                      autoComplete="off"
                      placeholder="Who owes this?"
                      value={custName}
                      onChange={(e) => setCustName(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="credit_customer_phone"
                      className="text-xs uppercase tracking-wide"
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      Phone number
                    </label>
                    <Input
                      id="credit_customer_phone"
                      type="tel"
                      autoComplete="off"
                      placeholder="Recommended — how you'll find them next time"
                      value={custPhone}
                      onChange={(e) => setCustPhone(e.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => { setCreatingNew(false); setCustName(""); setCustPhone(""); }}
                    className="self-start text-xs underline"
                    style={{ color: "var(--color-ink-mute)" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="paid_now"
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Paying now ({cur.symbol}) — leave blank for full credit
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "var(--color-ink-mute)" }}>{cur.symbol}</span>
              <Input style={{ paddingLeft: cur.inputPad }}
                id="paid_now"
                type="number"
                min="0"
                max={payable}
                step="0.01"
                placeholder="0.00"
                value={paidNow}
                onChange={(e) => setPaidNow(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>

          {/* Which tender the down payment came in as — only matters if they paid. */}
          {paidNowNum > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
                Paid by
              </p>
              <div className="grid grid-cols-2 gap-1">
                {DOWN_TENDERS.map((t) => {
                  const active = downTender === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => { setDownTender(t.value); setDownCash(""); setDownOnline(""); }}
                      className="py-1.5 rounded-lg border text-sm transition-colors"
                      style={{
                        borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                        background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
                        color: "var(--color-ink)",
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {/* Split the "paying now" amount across cash and online. Typing one
                  fills the other, so the two always add up to what's being paid. */}
              {downTender === "mixed" && (
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(["cash", "online"] as const).map((side) => {
                    const val = side === "cash" ? downCash : downOnline;
                    const setThis = side === "cash" ? setDownCash : setDownOnline;
                    const setOther = side === "cash" ? setDownOnline : setDownCash;
                    return (
                      <div key={side} className="flex flex-col gap-1">
                        <label className="text-[12px] uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
                          {side === "cash" ? `Cash (${cur.symbol})` : `Online (${cur.symbol})`}
                        </label>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "var(--color-ink-mute)" }}>{cur.symbol}</span>
                          <Input style={{ paddingLeft: cur.inputPad }}
                            type="number"
                            min="0"
                            max={paidNowNum}
                            step="0.01"
                            placeholder="0.00"
                            value={val}
                            onChange={(e) => {
                              const v = e.target.value;
                              setThis(v);
                              const n = parseFloat(v);
                              setOther(v === "" || isNaN(n) ? "" : String(Math.round((paidNowNum - n) * 100) / 100 || 0));
                            }}
                            className="pl-6"
                          />
                        </div>
                      </div>
                    );
                  })}
                  {!downSplitValid && (
                    <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
                      Cash and online together must equal {cur.prefix}{paidNowNum.toFixed(2)}.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="credit_notes"
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Note
            </label>
            <Input
              id="credit_notes"
              name="credit_notes"
              type="text"
              autoComplete="off"
              placeholder="Optional — e.g. regular guest, will settle Friday"
              value={creditNotes}
              onChange={(e) => setCreditNotes(e.target.value)}
            />
          </div>

          {/* The maths, spelled out, so the cashier can check it against the cash
              in their hand before committing. */}
          <div
            className="rounded-lg border px-4 py-3 flex flex-col gap-1.5"
            style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
          >
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: "var(--color-warning)" }}>Payable</span>
              <span className="tabular" style={{ color: "var(--color-warning)" }}>{cur.prefix}{payable.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: "var(--color-warning)" }}>Paying now</span>
              <span className="tabular" style={{ color: "var(--color-warning)" }}>− {cur.prefix}{paidNowNum.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t" style={{ borderColor: "color-mix(in srgb, var(--color-warning) 20%, transparent)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--color-warning)" }}>Goes on credit</span>
              <span className="text-lg font-medium tabular" style={{ color: "var(--color-warning)" }}>
                {cur.prefix}{creditAmount.toFixed(2)}
              </span>
            </div>
          </div>

          {paidNow !== "" && !paidNowValid && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
              {paidNowNum >= payable
                ? `That settles the whole bill — use Cash, Online or Card instead.`
                : `Enter an amount between ${cur.prefix}0 and ${cur.prefix}${payable.toFixed(2)}.`}
            </p>
          )}
        </div>
      )}

      {errorMsg && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
          {errorMsg}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full h-12 rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: method === "credit" ? "#ea580c" : accent.fill, color: "#fff" }}
      >
        {pending
          ? "Closing…"
          : method === "credit"
          ? `Close & record ${cur.money(creditAmount)} credit`
          : `Check out · ${cur.prefix}${payable.toFixed(2)}`}
        {!pending && <ArrowRight size={18} />}
      </button>
    </form>
  );
}

/**
 * The "Close & collect payment" card as a popup: centred on a tablet/desktop, a bottom
 * sheet on a phone. Escape or a tap outside closes it — nothing is submitted until
 * Check out is pressed, and the discount typed so far is kept (it lives in SessionClient).
 */
export function PaymentPopup({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto thin-scrollbar rounded-t-2xl sm:rounded-2xl border shadow-xl px-5 py-5"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        {children}
      </div>
    </div>
  );
}

// Optional customer details for a walk-in (takeaway / phone / online delivery). Collapsed
// to a summary once filled; editable any time before the bill is closed.
function WalkInCustomerPanel({
  session,
  canEdit,
}: {
  session: SessionDetail;
  canEdit: boolean;
}) {
  const saved = {
    name: session.customer_name ?? "",
    phone: session.customer_phone ?? "",
    address: session.customer_address ?? "",
  };
  const has = !!(saved.name || saved.phone || saved.address);
  const [editing, setEditing] = useState(!has);
  const [fields, setFields] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [pending, startSave] = useTransition();
  // The last values the server accepted, so an unchanged blur doesn't re-save.
  const lastSaved = useRef(saved);

  const dirty =
    fields.name.trim() !== lastSaved.current.name.trim() ||
    fields.phone.trim() !== lastSaved.current.phone.trim() ||
    fields.address.trim() !== lastSaved.current.address.trim();

  // Saves straight away when staff leave a field — the details used to sit unsaved in
  // the form until "Save" was pressed, so typing a name and phone and going on to pay
  // printed a bill with NO customer on it. The success is read from the action's own
  // return, not inferred from a pending→idle transition (which silently misfires).
  // Server actions run in order, so a save fired by tapping Pay lands before the payment.
  function save(closeAfter: boolean) {
    if (!dirty) {
      if (closeAfter && (fields.name || fields.phone || fields.address)) setEditing(false);
      return;
    }
    const fd = new FormData();
    fd.set("session_id", session.id);
    fd.set("customer_name", fields.name);
    fd.set("customer_phone", fields.phone);
    fd.set("customer_address", fields.address);
    const snapshot = { ...fields };
    startSave(async () => {
      const res = await updateWalkInCustomer(null, fd);
      if (res?.error) { setError(res.error); return; }
      setError(null);
      lastSaved.current = snapshot;
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      if (closeAfter) setEditing(false);
    });
  }

  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: "var(--color-canvas-soft)" }}>
        <User size={14} style={{ color: "var(--color-ink-mute)" }} />
        <span className="text-xs font-medium flex-1" style={{ color: "var(--color-ink)" }}>
          Customer details <span style={{ color: "var(--color-ink-mute)" }}>· optional</span>
        </span>
        {pending && <span className="text-[12px]" style={{ color: "var(--color-ink-mute)" }}>Saving…</span>}
        {!pending && savedFlash && <span className="text-[12px]" style={{ color: "var(--color-success)" }}>Saved</span>}
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs inline-flex items-center gap-1"
            style={{ color: "var(--color-primary)" }}
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>

      {editing && canEdit ? (
        <form
          onSubmit={(e) => { e.preventDefault(); save(true); }}
          className="px-4 py-3 flex flex-col gap-2"
        >
          <Input value={fields.name} onChange={set("name")} onBlur={() => save(false)} placeholder="Customer name" />
          <Input value={fields.phone} onChange={set("phone")} onBlur={() => save(false)} placeholder="Phone number" inputMode="tel" />
          <Input value={fields.address} onChange={set("address")} onBlur={() => save(false)} placeholder="Delivery address" />
          <div className="flex items-center gap-2 mt-1">
            <Button type="submit" variant="primary" disabled={pending} className="text-xs px-3 h-9">
              {pending ? "Saving…" : "Save"}
            </Button>
            {has && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setFields(lastSaved.current); setEditing(false); }}
                className="text-xs px-3 h-9"
              >
                Cancel
              </Button>
            )}
            {error && <span className="text-xs" style={{ color: "var(--color-ruby)" }}>{error}</span>}
          </div>
        </form>
      ) : (
        <div className="px-4 py-3 text-sm" style={{ color: "var(--color-ink)" }}>
          {lastSaved.current.name || lastSaved.current.phone || lastSaved.current.address ? (
            <div className="flex flex-col gap-0.5">
              {lastSaved.current.name && <span>{lastSaved.current.name}</span>}
              {lastSaved.current.phone && <span style={{ color: "var(--color-ink-mute)" }}>{lastSaved.current.phone}</span>}
              {lastSaved.current.address && <span style={{ color: "var(--color-ink-mute)" }}>{lastSaved.current.address}</span>}
            </div>
          ) : (
            <span style={{ color: "var(--color-ink-mute)" }}>No customer details.</span>
          )}
        </div>
      )}
    </div>
  );
}

// Optional customer name on a normal table bill — deliberately the thinnest
// version of WalkInCustomerPanel above: one field, no phone, no address. A
// table bill's customer is a courtesy label ("whose bill is this"), not a
// takeaway contact, so the extra fields that panel needs would just be noise
// here. Same edit-until-closed rule, same server action shape, different
// permission (create_orders, not manage_walkins) enforced server-side.
function TableCustomerNamePanel({
  session,
  canEdit,
}: {
  session: SessionDetail;
  canEdit: boolean;
}) {
  const has = !!session.customer_name;
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateTableCustomerName, null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => { if (pending) setSubmitted(true); }, [pending]);
  useEffect(() => {
    if (submitted && !pending && state === null) { setSubmitted(false); setEditing(false); }
  }, [submitted, pending, state]);

  if (!canEdit && !has) return null; // nothing to show, nothing the viewer could add

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: "var(--color-canvas-soft)" }}>
        <User size={14} style={{ color: "var(--color-ink-mute)" }} />
        <span className="text-xs font-medium flex-1" style={{ color: "var(--color-ink)" }}>
          Customer name <span style={{ color: "var(--color-ink-mute)" }}>· optional</span>
        </span>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs inline-flex items-center gap-1"
            style={{ color: "var(--color-primary)" }}
          >
            <Pencil size={12} /> {has ? "Edit" : "Add"}
          </button>
        )}
      </div>

      {editing && canEdit ? (
        <form action={action} className="px-4 py-3 flex flex-col gap-2">
          <input type="hidden" name="session_id" value={session.id} />
          <Input name="customer_name" defaultValue={session.customer_name ?? ""} placeholder="e.g. Ram Sharma" autoFocus />
          <div className="flex items-center gap-2 mt-1">
            <Button type="submit" variant="primary" disabled={pending} className="text-xs px-3 h-9">
              {pending ? "Saving…" : "Save"}
            </Button>
            {has && (
              <Button type="button" variant="secondary" onClick={() => setEditing(false)} className="text-xs px-3 h-9">
                Cancel
              </Button>
            )}
            {state?.error && <span className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</span>}
          </div>
        </form>
      ) : has ? (
        <div className="px-4 py-3 text-sm" style={{ color: "var(--color-ink)" }}>
          {session.customer_name}
        </div>
      ) : null}
    </div>
  );
}

export function SessionClient({
  session,
  restaurant,
  staffName = "",
  workstations = [],
  canCreateOrders = false,
  canCloseBills = false,
  canPrintTickets = false,
  canForceClose = false,
  canSeePIN = true,
  canUseCredit = false,
  discountEnabled = false,
  canCancelOrders = false,
}: {
  session: SessionDetail;
  restaurant: RestaurantInfo;
  staffName?: string;
  workstations?: PrintStation[];
  canCreateOrders?: boolean;
  canCloseBills?: boolean;
  /** KOT/BOT printing — a billing/order-management action, not any waiter's. */
  canPrintTickets?: boolean;
  canForceClose?: boolean;
  canSeePIN?: boolean;
  canUseCredit?: boolean;
  discountEnabled?: boolean;
  canCancelOrders?: boolean;
}) {
  const cur = useCurrency();
  const router = useRouter();
  const [forceClosing, startForceClose] = useTransition();
  const [forceError, setForceError] = useState<string | null>(null);
  // The payment form's discount, held here so the unpaid-bill preview prints it too.
  const [discountAmt, setDiscountAmt] = useState("");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("amount");
  const discount = discountEnabled ? resolveDiscount(discountAmt, discountMode, session.total) : 0;
  const hasOrders = session.items.length > 0;
  const accent = billAccentFor(session.type);
  // The payment card is a popup now, opened from Pay Now.
  const [paying, setPaying] = useState(false);
  const pendingItems = session.items.filter((i) => i.item_status !== "served");
  const servedItems  = session.items.filter((i) => i.item_status === "served");
  const isClosed     = session.status === "closed";
  const locationLabel = session.table_number
    ? `Table ${session.table_number}`
    : session.room_number
    ? `Room ${session.room_number}`
    : session.type === "walk_in"
    ? "Walk-in"
    : null;

  return (
    // `pb-32` on a phone: room for the bottom action bar, so it never covers the last card.
    <div className={`flex flex-col gap-5 max-w-lg ${!isClosed && (canCreateOrders || (hasOrders && canCloseBills)) ? "pb-32 lg:pb-0" : ""}`}>
      {/* Location label */}
      {locationLabel && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-lg font-semibold" style={{ color: "var(--color-ink)" }}>{locationLabel}</p>
          <span
            className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full border"
            style={
              isClosed
                ? { background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)", borderColor: "var(--color-hairline-input)" }
                : { background: accent.soft, color: accent.color, borderColor: accent.color }
            }
          >
            <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: isClosed ? "var(--color-ink-mute)" : accent.color }} />
            {isClosed ? "Closed" : "Active"}
          </span>
        </div>
      )}

      {/* Customer ordering PIN */}
      {!isClosed && canSeePIN && session.customer_pin && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl border"
          style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
        >
          <div className="flex-1">
            <p className="text-xs font-medium" style={{ color: "var(--color-warning)" }}>
              Customer ordering PIN — share with seated customer
            </p>
          </div>
          <div className="flex items-center gap-1">
            {session.customer_pin.split("").map((d, i) => (
              <div
                key={i}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold"
                style={{ background: "var(--color-warning-bg)", color: "var(--color-warning)", border: "1px solid color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
              >
                {d}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Walk-in customer details — takeaway / phone / delivery. Optional, editable
          until the bill is closed. */}
      {session.type === "walk_in" && (
        <WalkInCustomerPanel session={session} canEdit={canCreateOrders && !isClosed} />
      )}

      {/* Table bill's own optional customer name — same edit-until-closed rule,
          just one field instead of the walk-in desk's three. */}
      {session.type === "table" && (
        <TableCustomerNamePanel session={session} canEdit={canCreateOrders && !isClosed} />
      )}

      {/* Items */}
      {session.items.length === 0 ? (
        <div
          className="rounded-xl border-2 px-6 py-12 text-center flex flex-col items-center gap-2"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline-input)", background: "var(--color-canvas-soft)" }}
        >
          <ConciergeBell size={26} strokeWidth={1.6} style={{ color: "var(--color-ink-mute)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            No items yet.
          </p>
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Select items from the menu to add to this order.
          </p>
        </div>
      ) : (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          {pendingItems.map((i) => (
            <OrderItem
              key={i.id}
              item={i}
              canCancel={canCancelOrders && !isClosed}
            />
          ))}
          {servedItems.length > 0 && pendingItems.length > 0 && (
            <div className="px-4 py-1.5 border-t" style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}>
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Served</p>
            </div>
          )}
          {servedItems.map((i) => <OrderItem key={i.id} item={i} />)}
        </div>
      )}

      {/* Subtotal / Total / Pay Now — the bill at a glance. Pay Now opens the payment
          card as a popup instead of the whole form sitting in this column. */}
      {hasOrders && (
        <div
          className="rounded-2xl border px-4 sm:px-5 py-4 flex flex-col gap-2.5"
          style={{
            background: "var(--color-canvas)",
            borderColor: "var(--color-hairline)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-base font-medium" style={{ color: "var(--color-ink)" }}>Subtotal</span>
            <span className="text-sm tabular" style={{ color: "var(--color-ink)" }}>{cur.money2(session.total)}</span>
          </div>
          {!isClosed && canCloseBills && discountEnabled ? (
            // Discount, right on the bill — without opening Pay Now. The SAME state the
            // payment popup reads, so whatever is typed here is already filled in there;
            // the PIN that authorizes it is still asked for at Pay Now.
            <div className="flex flex-col gap-1">
              {/* Wraps on a narrow phone: the ₹/% switch and the field drop under the label,
                  right-aligned, rather than pushing past the card's edge. */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <label htmlFor="bill_discount" className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
                  Discount
                </label>
                <div className="flex items-center gap-2 ml-auto">
                  <DiscountUnitToggle
                    mode={discountMode}
                    onChange={(m) => {
                      if (m === discountMode) return;
                      setDiscountMode(m);
                      setDiscountAmt("");
                    }}
                  />
                  <input
                    id="bill_discount"
                    type="number"
                    min="0"
                    max={discountMode === "percent" ? 100 : session.total}
                    step="0.01"
                    inputMode="decimal"
                    value={discountAmt}
                    onChange={(e) => setDiscountAmt(e.target.value)}
                    placeholder={discountMode === "percent" ? "0" : "0.00"}
                    className="h-9 w-[96px] sm:w-[110px] rounded-lg border px-2.5 text-sm text-right tabular"
                    style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
                  />
                </div>
              </div>
              {discount > 0 && (
                <p className="text-xs text-right tabular" style={{ color: "var(--color-ink-mute)" }}>
                  − {cur.money2(discount)}
                  {discountMode === "amount" ? ` (${formatPercent(discount, session.total)})` : ""}
                  {" · "}PIN asked at Pay Now
                </p>
              )}
            </div>
          ) : (
            discount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>Discount</span>
                <span className="text-sm tabular" style={{ color: "var(--color-ink-mute)" }}>− {cur.money2(discount)}</span>
              </div>
            )
          )}
          <div className="flex items-center justify-between pt-2.5 border-t" style={{ borderColor: "var(--color-hairline)" }}>
            <span className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>Total</span>
            <span className="text-xl font-semibold tabular" style={{ color: accent.color }}>
              {cur.money2(Math.max(0, session.total - discount))}
            </span>
          </div>
          {!isClosed && canCloseBills && (
            <button
              type="button"
              onClick={() => setPaying(true)}
              // Desktop only: on a phone Pay Now lives in the bottom action bar instead.
              className="mt-1 w-full h-12 rounded-xl text-base font-semibold hidden lg:inline-flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.99]"
              style={{ background: accent.fill, color: "#fff" }}
            >
              <Wallet size={18} /> Pay Now
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      {!isClosed && (
        <>
          {/* Desktop/tablet reaches the same menu through the split-view's own
              "Menu" tab (see session-split-view.tsx) instead of navigating to
              a separate page, so this button — and the navigation it does —
              is mobile-only. */}

          {/* KOT / BOT / Bill printing — a billing/order-management action (Cashier /
              Receptionist), NOT any waiter, once the table has at least one order.
              KOT lists kitchen-station items, BOT lists bar-station items. */}
          {hasOrders && (
            <SessionPrintButtons
              session={session}
              restaurant={restaurant}
              staffName={staffName}
              workstations={workstations}
              canPrintTickets={canPrintTickets}
              canPrintBill={canCloseBills}
              discount={discount}
            />
          )}

          {/* This screen is for TABLES and walk-ins only now. A room stay is
              redirected to its own screen before it ever gets here, so there is no
              room branch to handle: the room's orders, KOT and folio all live in
              one place. `closeSessionWithPayment` still refuses a room stay
              server-side, in case anyone posts to it directly. */}
          {canCloseBills && paying && (
            <PaymentPopup onClose={() => setPaying(false)}>
              <PaymentForm
                session={session}
                canUseCredit={canUseCredit}
                discountEnabled={discountEnabled}
                discountAmt={discountAmt}
                setDiscountAmt={setDiscountAmt}
                discountMode={discountMode}
                setDiscountMode={setDiscountMode}
                accent={accent}
                onClose={() => setPaying(false)}
              />
            </PaymentPopup>
          )}

          {!canCreateOrders && !canCloseBills && (
            <p className="text-sm text-center py-2" style={{ color: "var(--color-ink-mute)" }}>
              You don't have permission to add items or close this bill.
            </p>
          )}

          {/* Force close / deactivate.
              · Cashier/manager (canForceClose): may close any session.
              · Any assigned staff: may deactivate an EMPTY table (opened by
                mistake). A table with orders is blocked with a clear message. */}
          {hasOrders && !canForceClose ? (
            <div
              className="rounded-xl border px-4 py-3 text-sm"
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
            >
              This table contains active orders and can only be closed by the Cashier.
            </div>
          ) : (canForceClose || !hasOrders) ? (
            <>
              <button
                type="button"
                disabled={forceClosing}
                className="w-full rounded-xl border py-3 text-sm font-medium transition-colors disabled:opacity-60"
                style={{ borderColor: "color-mix(in srgb, var(--color-danger) 27%, transparent)", color: "var(--color-danger)", background: "var(--color-danger-bg)" }}
                onClick={() => {
                  const msg = !hasOrders
                    ? "Deactivate this table? It has no orders and will return to Available immediately."
                    : "Force close this session? Pending notifications will be cleared and the table/room will become available immediately.";
                  if (confirm(msg)) {
                    setForceError(null);
                    startForceClose(async () => {
                      const res = await forceCloseSession(session.id);
                      if (res?.error) {
                        setForceError(res.error);
                      } else if (session.type === "walk_in") {
                        // A closed walk-in is a dead end, and its number goes straight
                        // back into use: staying here left a closed "W4" on screen while
                        // the next walk-in added became a NEW W4 — two W4s, one closed,
                        // which read like the app bouncing around the same walk-in.
                        router.push("/employee/dashboard");
                      } else if (window.matchMedia("(min-width: 1024px)").matches) {
                        // Desktop/tablet: don't navigate anywhere — stay on this exact
                        // page. `isClosed` (below) already swaps the whole Actions block
                        // for the "Session closed" banner once `session.status` flips, so
                        // a refresh is all that's needed to show the table as closed in
                        // place, with the persistent rail right where it was.
                        router.refresh();
                      } else {
                        // Mobile has no rail to stay near, so this goes home instead —
                        // same as it always has.
                        router.push("/employee/dashboard");
                      }
                    });
                  }
                }}
              >
                {forceClosing ? "Closing…" : !hasOrders ? "Deactivate table" : "Force close session"}
              </button>
              {forceError && (
                <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
                  {forceError}
                </p>
              )}
            </>
          ) : null}
        </>
      )}

      {/* Phone: the two things a waiter reaches for — Add items and Pay Now, with the
          total — pinned to the bottom of the screen, always under the thumb however long
          the order is. Desktop has the menu beside the order and Pay Now in the bill card. */}
      {!isClosed && (canCreateOrders || (hasOrders && canCloseBills)) && (
        <div
          className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t px-3 sm:px-4 pt-3 flex items-center gap-2 sm:gap-2.5"
          style={{
            background: "var(--color-canvas)",
            borderColor: "var(--color-hairline)",
            boxShadow: "0 -4px 16px rgba(15,23,42,0.08)",
            // Same allowance as the menu's cart bar: the home indicator, and the fixed
            // subscription watermark that sits `bottom-2` centred on a phone.
            paddingBottom: "calc(2.25rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {hasOrders && (
            <div className="min-w-0 mr-auto">
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Total</p>
              <p className="text-[15px] sm:text-lg font-bold tabular leading-tight truncate" style={{ color: accent.color }}>
                {cur.money2(Math.max(0, session.total - discount))}
              </p>
            </div>
          )}
          {canCreateOrders && (
            <Link
              href={`/employee/session/${session.id}/add`}
              className={`h-11 px-3 sm:px-4 rounded-xl border-[1.5px] text-sm sm:text-[15px] font-semibold inline-flex items-center justify-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap ${hasOrders ? "" : "flex-1"}`}
              style={{ borderColor: accent.fill, color: accent.color, background: "var(--color-canvas)" }}
            >
              <Plus size={16} strokeWidth={2.4} /> Add items
            </Link>
          )}
          {hasOrders && canCloseBills && (
            <button
              type="button"
              onClick={() => setPaying(true)}
              className="h-11 px-3.5 sm:px-5 rounded-xl text-sm sm:text-[15px] font-semibold inline-flex items-center justify-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap transition-all active:scale-[0.98]"
              style={{ background: accent.fill, color: "#fff" }}
            >
              <Wallet size={16} /> Pay Now
            </button>
          )}
        </div>
      )}

      {isClosed && (
        <div
          className="rounded-xl border px-4 py-3 text-center text-sm"
          style={{ borderColor: "color-mix(in srgb, var(--color-success) 27%, transparent)", background: "var(--color-success-bg)", color: "var(--color-success)" }}
        >
          {session.type === "walk_in" ? (
            // Reached from an old tab or link. The walk-in's number may already belong to
            // a NEW walk-in, so say so instead of leaving a closed "W4" looking current.
            <>
              <p>This walk-in is finished.</p>
              <p className="text-xs mt-1" style={{ color: "var(--color-ink-mute)" }}>
                Its number may now be used by a new walk-in — open it from the dashboard.
              </p>
              <Link
                href="/employee/dashboard"
                className="inline-block mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ color: "#fff", background: "var(--color-primary)" }}
              >
                Go to dashboard
              </Link>
            </>
          ) : (
            "Session closed"
          )}
        </div>
      )}
    </div>
  );
}
