"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import {
  addRoomAdvance,
  addRoomCharge,
  checkOutRoom,
  removeRoomCharge,
  setRoomPriceShift,
} from "@/app/actions/rooms";
import type { RoomFolioView, RoomAdvance } from "@/app/actions/rooms";
import { removeRoomAdvance, updateRoomAdvance } from "@/app/actions/security";
import { AdvanceFields } from "@/app/(employee)/employee/_components/advance-fields";
import type { AdvanceMethod } from "@/app/(employee)/employee/_components/advance-fields";
import { SecurityPinDialog } from "@/components/security-pin-dialog";
import { PaymentMethodPicker, splitIsValid } from "@/components/ui/payment-method-picker";
import { Input } from "@/components/ui/input";
import { searchCreditCustomers } from "@/app/actions/credits";
import type { CreditCustomer } from "@/app/actions/credits";
import type { SessionDetail } from "@/app/actions/pos";
import { CHARGE_TYPES } from "@/lib/room-billing";
import { useRouter } from "next/navigation";
import { Modal } from "@/app/(admin)/admin/_components/modal";
import { CancelStayForm } from "@/app/(admin)/admin/rooms/_components/cancel-stay-form";
import { formatDateTime } from "@/lib/format-time";
import { Button } from "@/components/ui/button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { OrderItem } from "@/app/(employee)/employee/_components/order-item";
import { SessionPrintButtons } from "@/app/(employee)/employee/session/(split)/[id]/_components/print-tickets";
import type { RestaurantInfo, PrintStation } from "@/app/(employee)/employee/session/(split)/[id]/_components/print-tickets";
import { PrintModal, BillTicket, ticketNumber } from "@/app/(employee)/employee/_components/bill-ticket";
import { folioToBill } from "@/lib/billing/room-bill";
import { formatPercent, resolveDiscount, type DiscountMode } from "@/lib/billing/discount";
import { DiscountUnitToggle } from "@/app/(employee)/employee/_components/discount-unit-toggle";
import { formatBillNumber, billNumberLabel } from "@/lib/billing/bill-number";
import { billMethodLabel } from "@/lib/billing/payment-method";
import {
  ArrowRight, Banknote, BedDouble, CalendarDays, ChevronLeft, Clock, CreditCard, HandCoins, Lock,
  MonitorSmartphone, Moon, Pencil, Plus, Printer, Receipt, Sparkles, Trash2, User, UtensilsCrossed, Wallet, X, XCircle,
} from "lucide-react";
import { useCurrency } from "@/components/currency-provider";
import { MenuBrowser } from "@/app/(employee)/employee/session/(plain)/[id]/add/_components/menu-browser";
import type { AddItemsMenuData } from "@/lib/menu-browser-data";
import { NAV_HEIGHT } from "@/app/(employee)/employee/session/_components/layout-metrics";
import { PaymentPopup } from "@/app/(employee)/employee/session/(split)/[id]/_components/session-client";

// Pinned to the restaurant's zone — a check-in stamp on a bill has to say the
// wall-clock time at the hotel, not the time in whatever region the server is in.
const when = (iso: string) => formatDateTime(iso);

// ─── One line of the bill ────────────────────────────────────────────────────

function Line({
  label, detail, amount, onRemove, muted,
}: {
  label: string;
  detail?: string;
  amount: number;
  onRemove?: () => void;
  muted?: boolean;
}) {
  const cur = useCurrency();
  return (
    <div className="flex items-baseline gap-3 px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: muted ? "var(--color-ink-mute)" : "var(--color-ink)" }}>
          {label}
        </p>
        {detail && (
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{detail}</p>
        )}
      </div>
      <span className="text-sm tabular shrink-0" style={{ color: "var(--color-ink)" }}>
        {cur.money2(amount)}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="p-1 rounded shrink-0"
          style={{ color: "var(--color-ink-mute)" }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * The room screen's colour system: ONE accent — the rooms teal (`.room-surface` in
 * globals.css) — on neutral cards. `INK` is the teal used for text, icons and borders;
 * `FILL` is the solid that white text sits on. Red is kept only for cancelling a stay
 * and orange only for credit; nothing else on this screen is coloured.
 */
const INK = "var(--room-ink)";
const FILL = "var(--room-fill)";

/** A soft wash of a colour, readable in both themes. */
const wash = (tone: string, pct = 10) => `color-mix(in srgb, ${tone} ${pct}%, var(--color-canvas))`;

/**
 * One section of the room screen. Every section is its own card — white, bordered,
 * shadowed — with the same header (green icon chip · title · figure on the right), so the
 * screen reads as a stack of separate, labelled blocks.
 */
function Card({
  id, icon, title, right, children, className = "",
}: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`rounded-2xl border overflow-hidden scroll-mt-4 ${className}`}
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: "var(--color-hairline)" }}>
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: wash(INK, 14), color: INK }}
        >
          {icon}
        </span>
        <p className="text-base font-semibold flex-1 min-w-0 truncate" style={{ color: "var(--color-ink)" }}>{title}</p>
        {right != null && (
          <span className="text-base font-semibold tabular" style={{ color: "var(--color-ink)" }}>{right}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** One tile of the quick-action bar: a green icon over a short label, on a white tile. */
function QuickAction({
  icon, label, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 sm:px-2 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold text-center leading-tight transition-all active:scale-[0.98]"
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
        color: "var(--color-ink)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: FILL, color: "#fff" }}>
        {icon}
      </span>
      {label}
    </button>
  );
}

/** A label · amount line of the Bill card; `strong` for the subtotal and what is left. */
function BillRow({
  label, detail, amount, strong,
}: {
  label: string;
  detail?: string;
  amount: number;
  strong?: boolean;
}) {
  const cur = useCurrency();
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <p className={`text-sm ${strong ? "font-semibold" : ""}`} style={{ color: strong ? "var(--color-ink)" : "var(--color-ink-mute)" }}>
          {label}
        </p>
        {detail && <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{detail}</p>}
      </div>
      <span className={`text-sm tabular shrink-0 ${strong ? "font-semibold" : ""}`} style={{ color: "var(--color-ink)" }}>
        {cur.money2(amount)}
      </span>
    </div>
  );
}

/** The room screen's solid teal action button. */
function ActionButton({
  icon, children, onClick, disabled, full, className = "",
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  full?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${full ? "w-full" : ""} ${className} inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg text-sm font-semibold transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50`}
      style={{ background: FILL, color: "#fff" }}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Add an extra (§5 — the future-ready charge types, usable today) ──────────

function AddChargeForm({ stayId, onDone }: { stayId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(addRoomCharge, null);
  const [type, setType] = useState("laundry");

  useEffect(() => {
    if (state === null && !pending) return;
  }, [state, pending]);

  return (
    <form
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="px-4 py-3.5 border-t flex flex-col gap-3"
      style={{ borderColor: "var(--color-hairline)" }}
    >
      <input type="hidden" name="stay_id" value={stayId} />
      {/* Laid out for the card's width, not the screen's: this form sits in a ~460px
          column beside the menu on a desktop, where a one-row layout keyed to `sm:`
          squeezed the note field to nothing. Type + amount share a row; the note gets
          its own; the buttons sit under them. `min-w-0` lets each field shrink cleanly. */}
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium" style={{ color: "var(--color-ink-mute)" }}>Charge type</span>
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-10 w-full min-w-0 rounded-lg border px-2 text-sm"
            style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
          >
            {CHARGE_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium" style={{ color: "var(--color-ink-mute)" }}>Amount</span>
          <input
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            required
            className="h-10 w-full min-w-0 rounded-lg border px-3 text-sm tabular"
            style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium" style={{ color: "var(--color-ink-mute)" }}>Note (optional)</span>
          <input
            name="description"
            placeholder="e.g. 2 shirts, mini bar soda"
            className="h-10 w-full min-w-0 rounded-lg border px-3 text-sm"
            style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onDone}
          className="h-10 rounded-lg border text-sm font-medium"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: FILL, color: "#fff" }}
        >
          <Plus size={15} /> {pending ? "Adding…" : "Add charge"}
        </button>
      </div>
      {state && "error" in state && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}
    </form>
  );
}

// ─── Advance payments ────────────────────────────────────────────────────────

function AddAdvanceForm({ stayId, onDone }: { stayId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(addRoomAdvance, null);
  const [valid, setValid] = useState(false);

  return (
    <form
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="px-4 py-3 border-t flex flex-col gap-2.5"
      style={{ borderColor: "var(--color-hairline)" }}
    >
      <input type="hidden" name="stay_id" value={stayId} />
      {/* The SAME fields the check-in modal uses, so a deposit taken at the desk and one
          taken three days later cannot validate differently. */}
      <AdvanceFields mode="required" onValidChange={setValid} />
      {/* Same footer as the extra-charge form: Cancel · the green action, half each. */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onDone}
          className="h-10 rounded-lg border text-sm font-medium"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !valid}
          className="h-10 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: FILL, color: "#fff" }}
        >
          <Plus size={15} /> {pending ? "Recording…" : "Record advance"}
        </button>
      </div>
      {state && "error" in state && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}
    </form>
  );
}

/**
 * When this bill next grows a night — and the desk's power to push that later.
 *
 * The single question a receptionist is asked at checkout ("until when can I
 * stay?"), answered by the SAME calculator that charges it. `nextBoundary` comes
 * off the folio, so this can never drift from the amount on the bill; computing
 * it here from the check-in time would be a second implementation of the rule.
 *
 * The shift applies to the whole stay, not just today, which is why the label
 * says "checkout time" rather than "tonight".
 */
function NightBoundary({
  stayId,
  at,
  shiftHours,
  shiftBy,
  canShift,
  editing,
  setEditing,
}: {
  stayId: string;
  at: string;
  shiftHours: number;
  shiftBy: string | null;
  canShift: boolean;
  /** Held by the screen, so the quick-action bar at the top can open it too. */
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const when = new Date(at).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  function save(hours: number) {
    start(async () => {
      const res = await setRoomPriceShift(stayId, hours);
      if (res && "error" in res) setError(res.error);
      else {
        setError(null);
        setEditing(false);
      }
    });
  }

  // Highlighted: an amber panel, because "until when can I stay?" is the question the
  // desk is asked most, and pushing it later is a routine courtesy that must be findable.
  return (
    <div
      id="room-extra-time"
      className="mx-3 my-3 rounded-xl border px-3.5 py-3 scroll-mt-4"
      style={{ background: wash(INK, 8), borderColor: `color-mix(in srgb, ${INK} 30%, transparent)` }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: FILL, color: "#fff" }}
        >
          <Clock size={17} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Next night starts</p>
          <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
            {when}
            {shiftHours > 0 && (
              <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-md" style={{ background: FILL, color: "#fff" }}>
                +{shiftHours}h
              </span>
            )}
          </p>
          {shiftHours > 0 && shiftBy && (
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Extra time given by {shiftBy}</p>
          )}
        </div>
        {canShift && !editing && (
          <ActionButton icon={<Clock size={15} />} onClick={() => setEditing(true)} className="w-full sm:w-auto">
            {shiftHours > 0 ? "Change time" : "Give more time"}
          </ActionButton>
        )}
      </div>

      {editing && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <select
            defaultValue={String(shiftHours)}
            onChange={(e) => save(Number(e.target.value))}
            disabled={pending}
            aria-label="Extra time"
            className="h-9 flex-1 sm:flex-none min-w-[150px] rounded-lg border px-2 text-sm"
            style={{
              borderColor: INK,
              color: "var(--color-ink)",
              background: "var(--color-canvas)",
            }}
          >
            <option value="0">No extra time</option>
            {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((h) => (
              <option key={h} value={h}>
                +{h} hour{h > 1 ? "s" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="h-9 px-3 rounded-lg border text-sm font-medium"
            style={{ borderColor: "var(--color-hairline-input)", color: "var(--color-ink)", background: "var(--color-canvas)" }}
          >
            Cancel
          </button>
          {pending && (
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Saving…
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs mt-1.5" style={{ color: "var(--color-ruby)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Removing an advance entered in error.
 *
 * Owner-only AND behind the Security PIN, because this rewrites money that has already
 * been counted into a day's cash-in-hand — unlike a tender edit, there is no bill to
 * reconcile the correction against. Every attempt, including a wrong PIN, is logged.
 */
function RemoveAdvanceButton({ advanceId }: { advanceId: string }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startRemove] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Remove this advance"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <X size={13} />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder="PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className="h-8 w-16 rounded-sm border px-2 text-xs text-right tracking-[0.3em]"
        style={{
          borderColor: "var(--color-hairline-input)",
          background: "var(--color-canvas)",
          color: "var(--color-ink)",
        }}
      />
      <button
        type="button"
        disabled={busy || pin.length !== 4}
        onClick={() =>
          startRemove(async () => {
            const res = await removeRoomAdvance(pin, advanceId);
            if (res && "error" in res) {
              setError(res.error);
              setPin("");
            } else {
              setOpen(false);
              setPin("");
              setError(null);
            }
          })
        }
        className="text-xs px-2 py-1 rounded-pill border"
        style={{ borderColor: "var(--color-ruby)", color: "var(--color-ruby)" }}
      >
        {busy ? "…" : "Remove"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setPin("");
          setError(null);
        }}
        style={{ color: "var(--color-ink-mute)" }}
      >
        <X size={13} />
      </button>
      {error && (
        <span className="text-xs" style={{ color: "var(--color-ruby)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Correcting an advance already on file — most often the payment method typed
 * wrong at the desk (a deposit that actually arrived online, recorded as cash).
 * Owner-only AND the Security PIN, same lane as removing one: this rewrites
 * money already counted into a day's cash-in-hand, with no bill to reconcile
 * the correction against.
 *
 * A refund row (`amount < 0`) is edited in the same positive numbers a deposit
 * is — the sign is reapplied from the row itself on submit, exactly as
 * `updateExtraExpense` does for a saving withdrawal, so retyping the amount can
 * never flip a deposit into a refund or back by accident.
 */
function EditAdvanceButton({ advance }: { advance: RoomAdvance }) {
  const [open, setOpen] = useState(false);
  const isRefund = advance.amount < 0;
  const magnitude = Math.abs(advance.amount);

  const [amount, setAmount] = useState(String(magnitude));
  const [method, setMethod] = useState<AdvanceMethod>((advance.method as AdvanceMethod) || "cash");
  const [cash, setCash] = useState(advance.method === "mixed" ? String(Math.abs(advance.cash)) : "");
  const [online, setOnline] = useState(advance.method === "mixed" ? String(Math.abs(advance.online)) : "");

  const amountNum = parseFloat(amount) || 0;
  const valid = amountNum > 0 && (method !== "mixed" || splitIsValid("mixed", amountNum, cash, online));

  const openDialog = () => {
    setAmount(String(magnitude));
    setMethod((advance.method as AdvanceMethod) || "cash");
    setCash(advance.method === "mixed" ? String(Math.abs(advance.cash)) : "");
    setOnline(advance.method === "mixed" ? String(Math.abs(advance.online)) : "");
    setOpen(true);
  };

  // Cash / Online / Card for a single method; the two-way split for Mixed.
  const resolvedSplit = () => {
    if (method === "cash") return { cash: amountNum, online: 0, card: 0 };
    if (method === "online") return { cash: 0, online: amountNum, card: 0 };
    if (method === "card") return { cash: 0, online: 0, card: amountNum };
    return { cash: parseFloat(cash) || 0, online: parseFloat(online) || 0, card: 0 };
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label="Edit this advance"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <Pencil size={13} />
      </button>

      <SecurityPinDialog
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => setOpen(false)}
        title={isRefund ? "Edit refund" : "Edit advance"}
        description="Correct the amount or how it was paid — most often the payment method."
        confirmLabel="Save"
        extraValid={valid}
        onConfirm={(pin) => {
          const s = resolvedSplit();
          const sign = isRefund ? -1 : 1;
          return updateRoomAdvance(pin, advance.id, {
            amount: amountNum * sign,
            cash: s.cash * sign,
            online: s.online * sign,
            card: s.card * sign,
            method,
          });
        }}
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Amount
            </span>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setCash("");
                setOnline("");
              }}
            />
          </label>

          <PaymentMethodPicker
            methods={["cash", "online", "card", "mixed"]}
            value={method}
            onChange={(m) => {
              setMethod(m as AdvanceMethod);
              setCash("");
              setOnline("");
            }}
            total={amountNum}
            cash={cash}
            online={online}
            onSplitChange={(s) => {
              setCash(s.cash);
              setOnline(s.online);
            }}
            mixedLabel="Cash + Online"
          />
        </div>
      </SecurityPinDialog>
    </>
  );
}

// ─── Check out ───────────────────────────────────────────────────────────────

function CheckOutForm({
  view, canDiscount, canUseCredit, discountEnabled,
  discount, setDiscount, discountMode, setDiscountMode,
}: {
  view: RoomFolioView;
  canDiscount: boolean;
  canUseCredit: boolean;
  /** Whether the restaurant has a discount PIN configured. No PIN = no discounts at all,
   *  so the field isn't shown. The PIN is still verified server-side at checkout. */
  discountEnabled: boolean;
  /** The typed discount (₹ or %) — lifted to FolioClient so the unpaid bill prints it. */
  discount: string;
  setDiscount: (v: string) => void;
  discountMode: DiscountMode;
  setDiscountMode: (m: DiscountMode) => void;
}) {
  const cur = useCurrency();
  const [state, action, pending] = useActionState(checkOutRoom, null);
  const [method, setMethod] = useState<"cash" | "online" | "card" | "mixed" | "credit">("cash");
  // The admin's discount PIN authorizing that reduction. Held only long enough to submit.
  const [discountPin, setDiscountPin] = useState("");
  const [cash, setCash] = useState("");
  const [online, setOnline] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [downTender, setDownTender] = useState<"cash" | "online" | "card" | "mixed">("cash");
  const [downCash, setDownCash] = useState("");
  const [downOnline, setDownOnline] = useState("");
  // Where an unused deposit goes back. Card is deliberately absent: a swipe cannot be
  // reversed at the desk, so an over-deposit returns as cash, a transfer, or both.
  const [refundTender, setRefundTender] = useState<"cash" | "online" | "mixed">("cash");
  const [refundCash, setRefundCash] = useState("");
  const [refundOnline, setRefundOnline] = useState("");

  // Credit account picker — the same live search the table bill uses, so a
  // returning guest never collects a second credit id.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreditCustomer[]>([]);
  const [picked, setPicked] = useState<CreditCustomer | null>(null);
  const [, startSearch] = useTransition();

  useEffect(() => {
    if (method !== "credit" || picked || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      startSearch(async () => setResults(await searchCreditCustomers(query)));
    }, 200);
    return () => clearTimeout(t);
  }, [query, method, picked]);

  const f = view.folio;

  // The subtotal is fixed; the discount is the only thing the cashier moves, so
  // the payable total is recomputed live from it. The SERVER rebuilds this from
  // the database regardless — this is only so the number under the cursor is right.
  // With no PIN configured there is no discount to speak of, so it's pinned to 0.
  const disc = discountEnabled ? resolveDiscount(discount, discountMode, f.subtotal) : 0;
  const taxable = f.subtotal - disc;
  const total =
    Math.round((taxable * (1 + f.taxPercent / 100 + f.servicePercent / 100)) * 100) / 100;

  // The deposit already held. `total` remains the SALE — it is what gets recorded and what
  // the discount is measured against — while `balance` is the only figure the cashier
  // collects today. The server re-derives all of this from the database.
  const held = view.advances.reduce((s, a) => s + a.amount, 0);
  const applied = Math.min(Math.max(held, 0), total);
  const balance = Math.round(Math.max(0, total - applied) * 100) / 100;
  const refundDue = Math.round(Math.max(0, held - total) * 100) / 100;

  // How the deposit itself arrived, so the receptionist can see what is actually
  // available to hand back before choosing how to return it.
  const heldCash = view.advances.reduce((s, a) => s + a.cash, 0);
  const heldOnline = view.advances.reduce((s, a) => s + a.online + a.card, 0);

  // Typing one side of a split refund fills the other, exactly as the payment split and
  // the advance fields do. One behaviour, three places — never a third implementation.
  function handleRefundCash(v: string) {
    setRefundCash(v);
    const n = parseFloat(v);
    setRefundOnline(
      !isNaN(n) && n >= 0 ? Math.max(0, Math.round((refundDue - n) * 100) / 100).toFixed(2) : ""
    );
  }
  function handleRefundOnline(v: string) {
    setRefundOnline(v);
    const n = parseFloat(v);
    setRefundCash(
      !isNaN(n) && n >= 0 ? Math.max(0, Math.round((refundDue - n) * 100) / 100).toFixed(2) : ""
    );
  }

  const refundCashNum = parseFloat(refundCash) || 0;
  const refundOnlineNum = parseFloat(refundOnline) || 0;
  const refundSplitOk =
    refundDue === 0 ||
    refundTender !== "mixed" ||
    (refundCash !== "" &&
      refundOnline !== "" &&
      Math.abs(refundCashNum + refundOnlineNum - refundDue) < 0.01);

  // What actually goes to the server. The action re-validates this against the refund it
  // derives from the database, so this only decides WHERE the money goes, never how much.
  const refundSplit =
    refundDue === 0
      ? { cash: 0, online: 0 }
      : refundTender === "cash"
      ? { cash: refundDue, online: 0 }
      : refundTender === "online"
      ? { cash: 0, online: refundDue }
      : { cash: refundCashNum, online: refundOnlineNum };

  // The server is the real gate; this just stops an obviously-incomplete submit.
  const discountPinValid = disc === 0 || /^\d{4}$/.test(discountPin);

  // Typing one half of a Cash + Online split fills the other, so the two always add up to
  // the payable — the same behaviour as the table bill, and as this form's own credit
  // down-payment split. It used to demand both numbers by hand.
  function handleCashChange(val: string) {
    setCash(val);
    const n = parseFloat(val);
    setOnline(!isNaN(n) && n >= 0 ? Math.max(0, Math.round((balance - n) * 100) / 100).toFixed(2) : "");
  }

  function handleOnlineChange(val: string) {
    setOnline(val);
    const n = parseFloat(val);
    setCash(!isNaN(n) && n >= 0 ? Math.max(0, Math.round((balance - n) * 100) / 100).toFixed(2) : "");
  }

  // A new discount moves the payable, which strands any split already typed against the
  // old one — clear it rather than submit a split that no longer adds up.
  function handleDiscountChange(val: string) {
    setDiscount(val);
    setCash("");
    setOnline("");
  }

  // Switching ₹ ↔ % reinterprets the typed number, so start the field over.
  function handleDiscountModeChange(mode: DiscountMode) {
    if (mode === discountMode) return;
    setDiscountMode(mode);
    handleDiscountChange("");
  }

  const cashNum = parseFloat(cash) || 0;
  const onlineNum = parseFloat(online) || 0;
  const paidNum = parseFloat(paidNow) || 0;
  const downCashNum = parseFloat(downCash) || 0;
  const downOnlineNum = parseFloat(downOnline) || 0;

  // A mixed down payment splits the "paid now" amount across cash and online; the
  // two must add up to it. Mirrors the table checkout's credit flow exactly, and
  // the check_out_room RPC already accepts p_cash/p_online/p_card separately, so no
  // backend change is needed — a mixed down payment just sends both cash and online.
  const downSplitValid =
    downTender !== "mixed" ||
    paidNum === 0 ||
    (downCash !== "" && downOnline !== "" && Math.abs(downCashNum + downOnlineNum - paidNum) < 0.01);

  // Every tender figure below is measured against the BALANCE, not the total: the part of
  // the bill a deposit already covers must not be collected a second time.
  const mixedOk = method !== "mixed" || Math.abs(cashNum + onlineNum - balance) < 0.01;
  const creditOk =
    method !== "credit" ||
    (paidNum >= 0 && paidNum < balance && (!!picked || query.trim().length > 0) && downSplitValid);
  const owed = Math.max(0, balance - paidNum);

  const amounts = {
    cash:
      method === "cash" ? balance
      : method === "mixed" ? cashNum
      : method === "credit" && downTender === "cash" ? paidNum
      : method === "credit" && downTender === "mixed" ? downCashNum
      : 0,
    online:
      method === "online" ? balance
      : method === "mixed" ? onlineNum
      : method === "credit" && downTender === "online" ? paidNum
      : method === "credit" && downTender === "mixed" ? downOnlineNum
      : 0,
    card: method === "card" ? balance : method === "credit" && downTender === "card" ? paidNum : 0,
  };

  type Method = "cash" | "online" | "card" | "mixed" | "credit";
  // Same Quick Payment set, order and icons as a table's payment popup.
  const METHODS: { key: Method; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { key: "cash", label: "Cash", Icon: Banknote },
    { key: "online", label: "Online", Icon: MonitorSmartphone },
    { key: "mixed", label: "Cash + Online", Icon: Wallet },
    ...(canUseCredit ? [{ key: "credit" as const, label: "Credit", Icon: HandCoins }] : []),
    { key: "card", label: "Card", Icon: CreditCard },
  ];

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="stay_id" value={view.stay_id} />
      <input type="hidden" name="payment_method" value={method} />
      <input type="hidden" name="discount" value={disc.toFixed(2)} />
      <input type="hidden" name="cash_amount" value={amounts.cash.toFixed(2)} />
      <input type="hidden" name="online_amount" value={amounts.online.toFixed(2)} />
      <input type="hidden" name="card_amount" value={amounts.card.toFixed(2)} />
      {method === "credit" && (
        <>
          <input type="hidden" name="credit_customer_id" value={picked?.id ?? ""} />
          <input type="hidden" name="credit_customer_name" value={picked ? picked.name : query || view.guest_name} />
          <input type="hidden" name="credit_customer_phone" value={picked?.phone ?? view.guest_phone ?? ""} />
        </>
      )}

      {canDiscount && (
        discountEnabled ? (
          <>
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                Discount
              </label>
              <div className="flex items-center gap-2">
                <DiscountUnitToggle mode={discountMode} onChange={handleDiscountModeChange} />
                <input
                  type="number"
                  min="0"
                  max={discountMode === "percent" ? 100 : f.subtotal}
                  step="0.01"
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => handleDiscountChange(e.target.value)}
                  placeholder={discountMode === "percent" ? "0" : "0.00"}
                  className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                  style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
                />
              </div>
              {/* The other unit, so the receptionist sees both ₹ and % whichever they typed. */}
              {disc > 0 && (
                <p className="text-xs mt-1.5 text-right tabular" style={{ color: "var(--color-ink-mute)" }}>
                  {discountMode === "percent" ? `= ${cur.prefix}${disc.toFixed(2)}` : `= ${formatPercent(disc, f.subtotal)}`}
                </p>
              )}
            </div>

            {/* Only asked for once there's actually something to authorize. */}
            {disc > 0 && (
              <div>
                <label htmlFor="room_discount_pin" className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                  Discount PIN
                </label>
                <input
                  id="room_discount_pin"
                  name="discount_pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="••••"
                  value={discountPin}
                  onChange={(e) => setDiscountPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="w-full h-10 rounded-sm border px-3 text-sm text-right tracking-[0.4em]"
                  style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
                />
                {!discountPinValid && (
                  <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-mute)" }}>
                    Enter the 4-digit discount PIN to authorize this reduction.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-start gap-2">
            <Lock size={13} className="mt-0.5 shrink-0" style={{ color: "var(--color-ink-mute)" }} />
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Discounts are turned off. Ask your admin to set a discount PIN in Settings.
            </p>
          </div>
        )
      )}

      {/* Always submitted, so the action reads a number in both branches. */}
      <input type="hidden" name="refund_cash" value={refundSplit.cash.toFixed(2)} />
      <input type="hidden" name="refund_online" value={refundSplit.online.toFixed(2)} />

      {/* What the deposit already covers. Shown only when there is one, so a stay without
          a deposit looks exactly as it did. */}
      {applied > 0 && (
        <div
          className="flex flex-col gap-1 rounded-lg border px-4 py-3"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Bill total</span>
            <span className="text-sm tabular" style={{ color: "var(--color-ink)" }}>{cur.money2(total)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Advance received</span>
            <span className="text-sm tabular" style={{ color: "var(--color-ink)" }}>
              - {cur.money2(applied)}
            </span>
          </div>
        </div>
      )}

      {refundDue > 0 ? (
        // The deposit overshot the bill. There is nothing to collect — the money goes back.
        <>
          <div
            className="flex items-baseline justify-between rounded-lg border px-4 py-3"
            style={{ borderColor: "var(--color-amber)", background: "rgba(245,158,11,0.06)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Refund due</span>
            <span className="text-xl tabular" style={{ color: "var(--color-ink)", fontWeight: 300 }}>
              {cur.money2(refundDue)}
            </span>
          </div>
          {/* How the deposit actually arrived. A receptionist about to hand ₹1,500 back
              needs to know only ₹1,000 of it ever came in as cash. */}
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Held as {cur.money2(heldCash)} cash
            {heldOnline > 0 ? ` + ${cur.money2(heldOnline)} online` : ""}
          </p>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["cash", "Refund Cash"],
                ["online", "Refund Online"],
                ["mixed", "Cash + Online"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setRefundTender(key);
                  setRefundCash("");
                  setRefundOnline("");
                }}
                className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                style={{
                  borderColor: refundTender === key ? "var(--color-primary)" : "var(--color-hairline)",
                  background: refundTender === key ? "var(--color-primary)" : "var(--color-canvas)",
                  color: refundTender === key ? "#fff" : "var(--color-ink)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {refundTender === "mixed" && (
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Cash", refundCash, handleRefundCash],
                  ["Online", refundOnline, handleRefundOnline],
                ] as const
              ).map(([label, val, set]) => (
                <div key={label}>
                  <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                    {label}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={refundDue}
                    step="0.01"
                    inputMode="decimal"
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                    style={{
                      borderColor: "var(--color-hairline-input)",
                      background: "var(--color-canvas)",
                      color: "var(--color-ink)",
                    }}
                  />
                </div>
              ))}
              {!refundSplitOk && (
                <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
                  Cash and Online must add up to {cur.money2(refundDue)}.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <>
      {/* Payable — the table popup's "Final payable" line. */}
      <div
        className="flex items-center justify-between rounded-xl px-4 py-3"
        style={{ background: "var(--color-canvas-soft)", border: "1px solid var(--color-hairline)" }}
      >
        <span className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>
          {applied > 0 ? "Balance payable" : "Final payable"}
        </span>
        <span className="text-2xl font-semibold tabular" style={{ color: "var(--room-ink)" }}>
          {cur.money2(balance)}
        </span>
      </div>

      {/* Method selector — "Quick Payment" buttons; the chosen one fills solid. */}
      <div className="flex flex-col gap-2.5">
        <p className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>Quick Payment</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {METHODS.map((m) => {
            const active = method === m.key;
            // Credit keeps its own orange: the one choice that leaves money owed.
            const on = m.key === "credit" ? "#ea580c" : "var(--room-fill)";
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethod(m.key)}
                className="flex items-center justify-center gap-2 px-2 py-2.5 rounded-xl border text-sm font-medium leading-tight text-center transition-colors"
                style={{
                  borderColor: active ? on : "var(--color-hairline-input)",
                  background: active ? on : "var(--color-canvas)",
                  color: active ? "#fff" : "var(--color-ink)",
                  boxShadow: active ? "none" : "0 1px 2px rgba(15,23,42,0.05)",
                }}
              >
                <m.Icon size={16} />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {method === "mixed" && (
        <div className="grid grid-cols-2 gap-3">
          {/* Type either side; the other fills itself so the two always total the payable. */}
          {([["Cash", cash, handleCashChange], ["Online", online, handleOnlineChange]] as const).map(([label, val, set]) => (
            <div key={label}>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>{label}</label>
              <input
                type="number" min="0" max={balance} step="0.01" inputMode="decimal"
                value={val}
                onChange={(e) => set(e.target.value)}
                className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
            </div>
          ))}
          {!mixedOk && (
            <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
              Cash and Online must add up to {cur.money2(balance)}.
            </p>
          )}
        </div>
      )}

      {method === "credit" && (
        <div className="flex flex-col gap-3">
          {picked ? (
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>
                  {picked.name} · {picked.customer_code}
                </p>
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  Already owes {cur.money2(picked.balance)}
                </p>
              </div>
              <button type="button" onClick={() => { setPicked(null); setQuery(""); }} style={{ color: "var(--color-ink-mute)" }}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                Credit account — search an existing customer, or type a name to open a new one
              </label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={view.guest_name}
                className="w-full h-10 rounded-sm border px-3 text-sm"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
              {results.length > 0 && (
                <div className="mt-1 rounded-lg border divide-y" style={{ borderColor: "var(--color-hairline)" }}>
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setPicked(r)}
                      className="w-full text-left px-3 py-2"
                      style={{ borderColor: "var(--color-hairline)" }}
                    >
                      <span className="text-sm block" style={{ color: "var(--color-ink)" }}>{r.name}</span>
                      <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                        {r.customer_code} · owes {cur.money2(r.balance)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>Paid now</label>
              <input
                type="number" min="0" max={balance} step="0.01" inputMode="decimal"
                value={paidNow}
                onChange={(e) => setPaidNow(e.target.value)}
                placeholder="0.00"
                className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
            </div>

            {paidNum > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs block" style={{ color: "var(--color-ink-mute)" }}>Tendered as</label>
                <div className="grid grid-cols-2 gap-1">
                  {([
                    ["cash", "Cash"],
                    ["online", "Online"],
                    ["card", "Card"],
                    ["mixed", "Cash + Online"],
                  ] as const).map(([key, label]) => {
                    const active = downTender === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { setDownTender(key); setDownCash(""); setDownOnline(""); }}
                        className="py-1.5 rounded-lg border text-sm transition-colors"
                        style={{
                          borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                          background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
                          color: "var(--color-ink)",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Split the "paid now" amount across cash and online; typing one
                    fills the other so the two always add up to what's being paid. */}
                {downTender === "mixed" && (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {(["cash", "online"] as const).map((side) => {
                      const val = side === "cash" ? downCash : downOnline;
                      const setThis = side === "cash" ? setDownCash : setDownOnline;
                      const setOther = side === "cash" ? setDownOnline : setDownCash;
                      return (
                        <div key={side}>
                          <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                            {side === "cash" ? "Cash" : "Online"}
                          </label>
                          <input
                            type="number" min="0" max={paidNum} step="0.01" inputMode="decimal"
                            value={val}
                            onChange={(e) => {
                              const v = e.target.value;
                              setThis(v);
                              const n = parseFloat(v);
                              setOther(v === "" || isNaN(n) ? "" : String(Math.round((paidNum - n) * 100) / 100 || 0));
                            }}
                            className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                            style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
                          />
                        </div>
                      );
                    })}
                    {!downSplitValid && (
                      <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
                        Cash and Online together must equal {cur.money2(paidNum)}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            className="flex items-baseline justify-between rounded-lg border px-3 py-2"
            style={{ borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)", background: "var(--color-warning-bg)" }}
          >
            <span className="text-sm" style={{ color: "var(--color-warning)" }}>Left on credit</span>
            <span className="text-sm tabular font-medium" style={{ color: "var(--color-warning)" }}>{cur.money2(owed)}</span>
          </div>
        </div>
      )}
        </>
      )}

      {state && "error" in state && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending || !mixedOk || !creditOk || !discountPinValid || !refundSplitOk}
        className="w-full h-12 rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: method === "credit" && refundDue <= 0 ? "#ea580c" : "var(--room-fill)", color: "#fff" }}
      >
        {pending
          ? "Checking out…"
          : refundDue > 0
          ? `Check out · refund ${cur.money2(refundDue)}`
          : `Check out · ${cur.money2(balance)}`}
        {!pending && <ArrowRight size={18} />}
      </button>
    </form>
  );
}

// ─── The folio ───────────────────────────────────────────────────────────────

export function FolioClient({
  view, session, restaurant, staffName, workstations = [],
  canAddCharges, canCreateOrders, canManageOrders, canCancelOrders,
  canCheckOut, canDiscount, canUseCredit, discountEnabled = false,
  canPrintTickets = false, canPrintBill = false,
  canTakeAdvance = false, canEditAdvance = false, canCheckIn = false, canCancelStay = false,
  menuData = null, transferHistory = null,
}: {
  /** The add-items menu for the right-hand column; null = no menu (no permission). */
  menuData?: AddItemsMenuData | null;
  /** Where the guest has been moved from, if anywhere — shown above the room card. */
  transferHistory?: React.ReactNode;
  view: RoomFolioView;
  /** The stay's session, in the same shape a table's screen uses. */
  session: SessionDetail | null;
  restaurant: RestaurantInfo;
  staffName: string;
  workstations?: PrintStation[];
  canAddCharges: boolean;
  canCreateOrders: boolean;
  canManageOrders: boolean;
  canCancelOrders: boolean;
  canCheckOut: boolean;
  canDiscount: boolean;
  canUseCredit: boolean;
  /** The restaurant has a discount PIN set. No PIN = no discounts, same as a table bill. */
  discountEnabled?: boolean;
  /** KOT/BOT printing — billing/order-management staff only (not waiters). */
  canPrintTickets?: boolean;
  /** Room folio bill printing — billing staff only. */
  canPrintBill?: boolean;
  /** Taking a deposit rides on `check_in`, not a permission of its own. */
  canTakeAdvance?: boolean;
  /** Correcting one is owner-only, and the server also demands the Security PIN. */
  canEditAdvance?: boolean;
  /**
   * Pushing the night boundary later rides on `check_in` — the same right that
   * takes a deposit. It is a routine desk courtesy, and gating it behind a PIN
   * would mean it simply stopped being recorded.
   */
  canCheckIn?: boolean;
  /**
   * Ending the stay WITHOUT billing it. Its own permission — never implied by
   * check-in or checkout, because writing off a guest's bill is a different act
   * from settling one — and the server demands the Security PIN on top.
   */
  canCancelStay?: boolean;
}) {
  const cur = useCurrency();
  const [adding, setAdding] = useState(false);
  const [addingAdvance, setAddingAdvance] = useState(false);
  // The extra-time picker's open state, held here so the quick-action bar can open it.
  const [timeEditing, setTimeEditing] = useState(false);
  // The checkout card is a popup, opened from Pay Now — same as a table's bill.
  const [paying, setPaying] = useState(false);
  // Phone: the menu as a full-screen panel over the room (desktop has it as a column).
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const router = useRouter();
  const [removing, startRemove] = useTransition();
  // Stamped once per mount, exactly like the table bill: a Date rebuilt on every render
  // would make the printed time jump while the preview is open.
  const [printedAt] = useState<Date>(() => new Date());
  const f = view.folio;
  const open = view.status === "active";

  // How the deposit itself was tendered — net of any refund, same reduce the
  // checkout form's own refund panel uses for `heldCash`/`heldOnline`. Without
  // this the bill's "Advance received" line names an amount but not a method, so
  // a mis-tendered deposit (cash typed for an online transfer) reads identically
  // to a correct one until someone opens the advance list itself.
  const advanceCash = view.advances.reduce((s, a) => s + a.cash, 0);
  const advanceOnline = view.advances.reduce((s, a) => s + a.online + a.card, 0);

  // The bill, arranged for the SHARED renderer. Same mapper the paid bill in Sales uses,
  // so the document a guest is shown before paying and the one filed after are one thing.
  const bill = folioToBill({ folio: f, roomType: view.type_name, advanceCash, advanceOnline });

  // The checkout form's discount, held here so the unpaid bill preview prints what the
  // receptionist has typed so far — the guest sees the reduction before paying.
  const [discountAmt, setDiscountAmt] = useState("");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("amount");
  const liveDiscount =
    discountEnabled && canDiscount ? resolveDiscount(discountAmt, discountMode, f.subtotal) : 0;

  // The Bill card can take the discount too, without opening Pay Now — it is the SAME
  // state the payment popup reads, so whatever is typed here is already filled in there
  // (the PIN that authorizes it is still asked for at checkout). While one is typed, the
  // card's figures are re-worked with it, the same sum the checkout form does; the server
  // rebuilds all of it from the database at checkout regardless.
  const canEditDiscount = open && canCheckOut && canDiscount && discountEnabled;
  const live = open && liveDiscount > 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const billTaxable = f.subtotal - (live ? liveDiscount : f.discount);
  const billTax = live ? r2((billTaxable * f.taxPercent) / 100) : f.tax;
  const billService = live ? r2((billTaxable * f.servicePercent) / 100) : f.service;
  const billTotal = live
    ? r2(billTaxable * (1 + f.taxPercent / 100 + f.servicePercent / 100))
    : f.grandTotal;
  const billBalance = live ? r2(Math.max(0, billTotal - f.advancePaid)) : f.balanceDue;
  const billRefund = live ? r2(Math.max(0, f.advancePaid - billTotal)) : f.refundDue;
  const billOwed = billRefund > 0 ? billRefund : f.advancePaid > 0 ? billBalance : billTotal;

  // Once the guest has checked out the SAME document is a receipt, not a bill: it has to
  // say PAID (or what is still owed), how it was tendered and who took the money. It used
  // to keep printing "Status: UNPAID" for a settled stay, because the folio screen had no
  // payment to look at.
  const paid = view.payment;

  // The bill number, resolved exactly as a TABLE bill resolves it: the restaurant's own
  // sequential number (claimed by the session, or stamped on the payment under the older
  // payment-time model), otherwise a derived reference. No room-only numbering scheme —
  // matching the table workflow is the point of this work.
  const seq = session?.bill_number ?? paid?.bill_number ?? null;
  const billRef =
    seq != null
      ? {
          label: billNumberLabel(restaurant.bill_number_label),
          value: formatBillNumber(seq, restaurant.bill_number_pad ?? 0),
        }
      : {
          label: undefined,
          value: paid
            ? `BILL-${paid.payment_id.slice(0, 8).toUpperCase()}`
            : ticketNumber("BILL", view.stay_id, printedAt),
        };

  // The food ordered against this stay — from the room QR, or added by hand. It
  // is ONE list either way; the two were never separate pipelines, they just had
  // separate screens.
  const items = session?.items ?? [];
  const pendingItems = items.filter((i) => i.item_status !== "served");
  const servedItems = items.filter((i) => i.item_status === "served");

  // The menu column: tablet/desktop, an open stay, and staff who can order.
  const showMenu = open && canCreateOrders && !!session && !!menuData;

  // Extra time exists only while there is a next night to push.
  const canShiftTime = canCheckIn && !!f.nextBoundary;
  // A quick action opens its form, then brings it into view once it has rendered.
  const jumpTo = (id: string) =>
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
    );

  return (
    // With a menu: two fixed columns under the top bar — the room on the left, the menu
    // on the right. `top/left/right/bottom` only apply once `lg:fixed` positions the box;
    // below lg it is static and the room is one centred column, as before.
    <div
      className={showMenu ? "room-surface lg:fixed lg:flex lg:gap-3 lg:p-3 z-10" : "room-surface"}
      style={showMenu ? { top: NAV_HEIGHT, left: 0, right: 0, bottom: 0 } : undefined}
    >
    {/* Desktop: the room column is a Back bar on top and the scrolling details under it,
        so Back stays put while the column scrolls. Below lg this wrapper is a plain box
        and Back sits in the page as before. */}
    <div className={showMenu ? "lg:w-[460px] xl:w-[500px] lg:shrink-0 lg:flex lg:flex-col lg:min-h-0" : ""}>
    {showMenu && (
      <div className="hidden lg:block shrink-0 px-1 pb-3">
        <Link
        href="/employee/dashboard"
        className="inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors hover:brightness-110 active:brightness-95"
        style={{ color: "#fff", background: "var(--color-primary)" }}
      >
        <ChevronLeft size={15} />
        Back
      </Link>
      </div>
    )}
    <div
      // `[&>*]:shrink-0`: in this height-capped scrolling column, flex would otherwise SHRINK
      // the cards to fit — and a card with `overflow-hidden` shrinks to nothing, hiding the
      // bill, extra time, extras and advances. Each card keeps its full height and the
      // column scrolls instead.
      className={
        showMenu
          ? "max-w-2xl mx-auto px-3 sm:px-5 py-4 pb-16 flex flex-col gap-4 lg:mx-0 lg:max-w-none lg:flex-1 lg:min-h-0 lg:overflow-y-auto thin-scrollbar lg:px-1 lg:py-0 lg:pb-6 lg:[&>*]:shrink-0"
          : "max-w-2xl mx-auto px-3 sm:px-5 py-4 pb-16 flex flex-col gap-4"
      }
    >
      {/* A room-service order placed from the guest's phone changes this bill, so
          the folio re-reads itself when orders move — no refresh, no stale total. */}
      <RealtimeRefresh topics={["orders", "tables"]} />

      {transferHistory}

      {/* Same solid brand-primary "Back" button as the table session screen — a
          button tapped constantly on a busy floor has to read as one at a glance.
          `self-start` so the flex column doesn't stretch it full width. */}
      <Link
        href="/employee/dashboard"
        className={`self-start inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 -ml-1 rounded-lg transition-colors hover:brightness-110 active:brightness-95 ${showMenu ? "lg:hidden" : ""}`}
        style={{ color: "#fff", background: "var(--color-primary)" }}
      >
        <ChevronLeft size={15} />
        Back
      </Link>

      {/* ─── 1. The stay ───────────────────────────────────────────────────────
          A green band naming the room, then who is staying and the stay in four plain
          tiles. The only solid colour on the screen besides the action buttons. */}
      <section
        className="rounded-2xl border overflow-hidden"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", boxShadow: "var(--shadow-card)" }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ background: FILL, color: "#fff" }}>
          <span
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(255,255,255,0.18)" }}
          >
            <BedDouble size={22} strokeWidth={1.8} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xl font-bold leading-tight">Room {view.room_number}</p>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.85)" }}>{view.type_name}</p>
          </div>
          <span
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0"
            style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}
          >
            <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: open ? "#86efac" : "#cbd5e1" }} />
            {open ? "Occupied" : "Checked out"}
          </span>
        </div>

        <div className="px-4 pt-3.5 pb-4 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: wash(INK, 14), color: INK }}
            >
              <User size={15} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink)" }}>{view.guest_name}</p>
              <p className="text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
                {view.guest_count} {view.guest_count === 1 ? "guest" : "guests"}
                {view.guest_phone ? ` · ${view.guest_phone}` : ""}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                [CalendarDays, "Check-in", when(f.checkIn)],
                [Clock, open ? "Now" : "Check-out", when(f.checkOut)],
                [Moon, "Stay", f.duration],
                [BedDouble, "Nights charged", String(f.nights)],
              ] as const
            ).map(([Icon, label, value]) => (
              <div
                key={label}
                className="rounded-xl px-3 py-2"
                style={{ background: "var(--color-canvas-soft)" }}
              >
                <p className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  <Icon size={13} style={{ color: INK }} />
                  {label}
                </p>
                <p className="text-[13px] sm:text-sm font-semibold tabular mt-0.5 leading-snug break-words" style={{ color: "var(--color-ink)" }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Quick actions ────────────────────────────────────────────────────
          The desk's everyday jobs on a stay. A tap opens that form in its card below
          and scrolls to it. */}
      {open && (canShiftTime || canAddCharges || canTakeAdvance) && (
        <div className="grid grid-cols-3 gap-2">
          {canShiftTime && (
            <QuickAction
              icon={<Clock size={18} />}
              label="Give more time"
              onClick={() => { setTimeEditing(true); jumpTo("room-charges"); }}
            />
          )}
          {canAddCharges && (
            <QuickAction
              icon={<Sparkles size={18} />}
              label="Extra charge"
              onClick={() => { setAdding(true); jumpTo("room-extras"); }}
            />
          )}
          {canTakeAdvance && (
            <QuickAction
              icon={<Wallet size={18} />}
              label="Take advance"
              onClick={() => { setAddingAdvance(true); jumpTo("room-advances"); }}
            />
          )}
        </div>
      )}

      {/* ─── 2. Orders ─────────────────────────────────────────────────────────
          THE fix. A QR order from the room lands here the moment it is placed,
          and the KOT prints from right here — the same OrderItem rows and the
          same SessionPrintButtons a table uses. Staff no longer go through "Add a
          room-service order" to reach a ticket for food the guest already ordered.
          That page is now only what its name says: for orders taken by phone or
          in person. */}
      {session && (
        <Card
          icon={<UtensilsCrossed size={16} />}
          title={pendingItems.length > 0 ? `Orders · ${pendingItems.length} pending` : "Orders"}
          right={cur.money2(f.foodTotal)}
        >
          {items.length === 0 ? (
            <p className="px-4 py-4 text-sm" style={{ color: "var(--color-ink-mute)" }}>
              No food ordered yet. The guest can order from the room QR, or you can add one.
            </p>
          ) : (
            <>
              {pendingItems.map((i) => (
                <OrderItem key={i.id} item={i} canCancel={canCancelOrders && open} />
              ))}
              {servedItems.length > 0 && pendingItems.length > 0 && (
                <div
                  className="px-4 py-1.5 border-t"
                  style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
                >
                  <p className="text-xs font-medium" style={{ color: "var(--color-ink-mute)" }}>Served</p>
                </div>
              )}
              {servedItems.map((i) => (
                <OrderItem key={i.id} item={i} />
              ))}
            </>
          )}

          {open && (items.length > 0 || canCreateOrders) && (
            <div
              className={`flex flex-col sm:flex-row gap-2 px-4 py-3 border-t ${items.length === 0 && showMenu ? "lg:hidden" : ""}`}
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
            >
              {items.length > 0 && (
                <div className="flex-1">
                  <SessionPrintButtons
                    session={session}
                    restaurant={restaurant}
                    staffName={staffName}
                    workstations={workstations}
                    // KOT/BOT is billing/order-management only now — a waiter (who has
                    // create/manage orders) must NOT be able to print kitchen tickets.
                    canPrintTickets={canPrintTickets}
                    // The bill for a room is the FOLIO — room nights, extras and
                    // food together — not the session's food-only total. It prints
                    // from the folio below, so the session's bill ticket is off.
                    canPrintBill={false}
                  />
                </div>
              )}
              {canCreateOrders && (
                showMenu ? (
                  // Phone: open the menu IN this screen (see the phone menu panel below),
                  // not on a separate page — so widening the window just swaps to the
                  // desktop layout, with no navigation and no loading screen between.
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPhoneMenuOpen(true)}
                    className="shrink-0 lg:hidden w-full sm:w-auto flex items-center justify-center gap-1.5"
                  >
                    <Plus size={13} /> Add order
                  </Button>
                ) : (
                  <Link href={`/employee/session/${session.id}/add`} className="shrink-0">
                    <Button variant="secondary" className="w-full flex items-center justify-center gap-1.5">
                      <Plus size={13} /> Add order
                    </Button>
                  </Link>
                )
              )}
            </div>
          )}
        </Card>
      )}

      {/* ─── 3. Room charges ───────────────────────────────────────────────────
          The nights, and directly under them when the next night starts and the
          courtesy that pushes it later — that is the number it explains. */}
      <Card id="room-charges" icon={<BedDouble size={16} />} title="Room charges" right={cur.money2(f.roomTotal)}>
        <Line label={f.room.label} detail={f.room.detail} amount={f.room.amount} />
        {open && f.nextBoundary && (
          <NightBoundary
            stayId={view.stay_id}
            at={f.nextBoundary}
            shiftHours={view.priceShiftHours}
            shiftBy={view.priceShiftBy}
            canShift={canCheckIn}
            editing={timeEditing}
            setEditing={setTimeEditing}
          />
        )}
      </Card>

      {/* ─── 4. Extras & services ──────────────────────────────────────────── */}
      {(f.extras.length > 0 || (canAddCharges && open)) && (
        <Card id="room-extras" icon={<Sparkles size={16} />} title="Extras & services" right={cur.money2(f.extrasTotal)}>
          {f.extras.length === 0 ? (
            <p className="px-4 py-3 text-sm" style={{ color: "var(--color-ink-mute)" }}>
              Nothing added yet — laundry, mini bar, an extra bed and so on go here.
            </p>
          ) : (
            f.extras.map((l) => (
              <Line
                key={l.key}
                label={l.label}
                detail={l.detail}
                amount={l.amount}
                onRemove={
                  canAddCharges && open
                    ? () => startRemove(async () => { await removeRoomCharge(l.key); })
                    : undefined
                }
              />
            ))
          )}
          {canAddCharges && open && (
            adding ? (
              <div style={{ background: "var(--color-canvas-soft)" }}>
                <AddChargeForm stayId={view.stay_id} onDone={() => setAdding(false)} />
              </div>
            ) : (
              <div className="px-4 py-3 border-t" style={{ borderColor: "var(--color-hairline)" }}>
                <ActionButton icon={<Plus size={15} />} onClick={() => setAdding(true)} disabled={removing} full>
                  Add extra charge
                </ActionButton>
              </div>
            )
          )}
        </Card>
      )}

      {/* ─── 5. Advance payments ───────────────────────────────────────────────
          The deposits taken against this stay. Money in, before there is a sale, so
          it is its own card rather than a line inside the bill. */}
      {(view.advances.length > 0 || (open && canTakeAdvance)) && (
        <Card id="room-advances" icon={<Wallet size={16} />} title="Advance payments" right={cur.money2(f.advancePaid)}>
          {view.advances.length === 0 ? (
            <p className="px-4 py-3 text-sm" style={{ color: "var(--color-ink-mute)" }}>
              No advance taken for this stay.
            </p>
          ) : (
            view.advances.map((a, idx) => (
              <div
                key={a.id}
                className={`flex flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-2.5 ${idx > 0 ? "border-t" : ""}`}
                style={{ borderColor: "var(--color-hairline)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    {/* A negative row is a refund handed back, not a deposit taken. */}
                    {a.amount < 0 ? "Refund returned" : "Advance"}
                    <span
                      className="text-xs font-medium ml-1.5 px-1.5 py-0.5 rounded-md"
                      style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
                    >
                      {billMethodLabel(a.method)}
                    </span>
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                    {when(a.created_at)}
                    {a.note ? ` · ${a.note}` : ""}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular" style={{ color: "var(--color-ink)" }}>
                  {cur.money2(a.amount)}
                </span>
                {open && canEditAdvance && (
                  <div className="flex items-center gap-2 ml-auto">
                    <EditAdvanceButton advance={a} />
                    <RemoveAdvanceButton advanceId={a.id} />
                  </div>
                )}
              </div>
            ))
          )}

          {open && canTakeAdvance && (
            addingAdvance ? (
              <div style={{ background: "var(--color-canvas-soft)" }}>
                <AddAdvanceForm stayId={view.stay_id} onDone={() => setAddingAdvance(false)} />
              </div>
            ) : (
              <div className="px-4 py-3 border-t" style={{ borderColor: "var(--color-hairline)" }}>
                <ActionButton icon={<Plus size={15} />} onClick={() => setAddingAdvance(true)} full>
                  Take an advance
                </ActionButton>
              </div>
            )
          )}
        </Card>
      )}

      {/* ─── 6. Bill ───────────────────────────────────────────────────────────
          Each part's total, then the grand total, any deposit against it, and what is
          left — ending in Pay Now, which opens the payment popup like a table's bill. */}
      <Card icon={<Receipt size={16} />} title="Bill">
        <div className="flex flex-col gap-2 px-4 py-3">
          <BillRow label="Room charges" amount={f.roomTotal} />
          {f.extrasTotal > 0 && <BillRow label="Extras & services" amount={f.extrasTotal} />}
          <BillRow label="Food & beverage" amount={f.foodTotal} />
        </div>
        <div className="flex flex-col gap-2 px-4 py-3 border-t" style={{ borderColor: "var(--color-hairline)" }}>
          <BillRow label="Subtotal" amount={f.subtotal} strong />
          {canEditDiscount ? (
            // Discount, right on the bill: ₹ / % toggle and the figure. The popup's own
            // discount field shows the same value.
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="bill_discount" className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
                  Discount
                </label>
                <div className="flex items-center gap-2">
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
                    max={discountMode === "percent" ? 100 : f.subtotal}
                    step="0.01"
                    inputMode="decimal"
                    value={discountAmt}
                    onChange={(e) => setDiscountAmt(e.target.value)}
                    placeholder={discountMode === "percent" ? "0" : "0.00"}
                    className="h-9 w-[110px] rounded-lg border px-2.5 text-sm text-right tabular"
                    style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
                  />
                </div>
              </div>
              {liveDiscount > 0 && (
                <p className="text-xs text-right tabular" style={{ color: "var(--color-ink-mute)" }}>
                  − {cur.money2(liveDiscount)}
                  {discountMode === "amount" ? ` (${formatPercent(liveDiscount, f.subtotal)})` : ""}
                  {" · "}PIN asked at Pay Now
                </p>
              )}
            </div>
          ) : (
            f.discount > 0 && <BillRow label="Discount" amount={-f.discount} />
          )}
          {billTax > 0 && <BillRow label={`Tax (${f.taxPercent}%)`} amount={billTax} />}
          {billService > 0 && <BillRow label={`Service charge (${f.servicePercent}%)`} amount={billService} />}
        </div>
        <div
          className="flex items-baseline justify-between px-4 py-3 border-t"
          style={{ borderColor: "var(--color-hairline)", background: wash(INK, 8) }}
        >
          <span className="text-base font-bold" style={{ color: "var(--color-ink)" }}>Grand total</span>
          <span className="text-2xl font-bold tabular" style={{ color: INK }}>{cur.money2(billTotal)}</span>
        </div>

        {/* A deposit is a PAYMENT against the bill, so it sits below the grand total
            rather than reducing it — the sale recorded at checkout is the whole stay. */}
        {f.advancePaid > 0 && (
          <div className="flex flex-col gap-2 px-4 py-3 border-t" style={{ borderColor: "var(--color-hairline)" }}>
            <BillRow
              label="Advance received"
              detail={[
                advanceCash > 0 ? `Cash ${cur.money2(advanceCash)}` : null,
                advanceOnline > 0 ? `Online ${cur.money2(advanceOnline)}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined}
              amount={-f.advancePaid}
            />
            <BillRow
              label={billRefund > 0 ? "Refund due" : "Balance payable"}
              amount={billRefund > 0 ? billRefund : billBalance}
              strong
            />
          </div>
        )}

        {open && (
          <div className="px-4 py-3 border-t flex flex-col gap-2" style={{ borderColor: "var(--color-hairline)" }}>
            {canCheckOut && (
              <button
                type="button"
                onClick={() => setPaying(true)}
                className="w-full h-12 rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.99]"
                style={{ background: FILL, color: "#fff" }}
              >
                <Wallet size={18} /> Pay Now · {cur.money2(billOwed)}
              </button>
            )}
            {f.open && (
              <p className="text-xs text-center" style={{ color: "var(--color-ink-mute)" }}>
                The room charge is billed to right now, and grows by one night every 24 hours.
              </p>
            )}
          </div>
        )}
      </Card>

      {open && canCheckOut && paying && (
        <PaymentPopup onClose={() => setPaying(false)}>
          <div className="flex items-center gap-3 mb-4">
            <span
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: FILL, color: "#fff" }}
            >
              <Wallet size={21} strokeWidth={1.9} />
            </span>
            <p className="text-lg font-semibold flex-1" style={{ color: "var(--color-ink)" }}>
              Check out &amp; collect payment
            </p>
            <button
              type="button"
              onClick={() => setPaying(false)}
              aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-canvas-soft"
              style={{ color: "var(--color-ink-mute)" }}
            >
              <X size={18} />
            </button>
          </div>
          <CheckOutForm
            view={view}
            canDiscount={canDiscount}
            canUseCredit={canUseCredit}
            discountEnabled={discountEnabled}
            discount={discountAmt}
            setDiscount={setDiscountAmt}
            discountMode={discountMode}
            setDiscountMode={setDiscountMode}
          />
        </PaymentPopup>
      )}

      {/* ─── 7. Cancel the stay ────────────────────────────────────────────────
          Ends it WITHOUT billing it and settles the deposit. Its own permission,
          never implied by check-in or checkout, and the server demands the Security
          PIN on top. Last and quiet: cancelling is the exception, and it should not sit
          where a receptionist's hand goes for the everyday action. */}
      {open && canCancelStay && (
        <section
          className="rounded-2xl border px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>Cancel this stay</p>
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Guest not staying — writes off the bill and refunds the deposit, or keeps part as a charge.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCancelling(true)}
            className="shrink-0 w-full sm:w-auto inline-flex items-center justify-center gap-1.5 h-10 sm:h-9 px-3.5 rounded-lg border text-sm font-semibold"
            style={{ borderColor: "var(--color-ruby)", color: "var(--color-ruby)", background: "var(--color-canvas)" }}
          >
            <XCircle size={14} /> Cancel stay
          </button>
        </section>
      )}

      <Modal
        open={cancelling}
        title="Cancel this stay"
        subtitle="Ends the stay without billing it, and settles the deposit"
        onClose={() => setCancelling(false)}
      >
        <CancelStayForm
          target={{
            stayId: view.stay_id,
            roomNumber: view.room_number,
            guestName: view.guest_name,
            runningTotal: f.grandTotal,
            nights: f.nights,
            // The stay's SIGNED advance rows, netted — a refund is negative, so
            // this is what is actually still held, not what was ever taken.
            advanceHeld: view.advances.reduce((s, a) => s + a.amount, 0),
            advanceCash: view.advances.reduce((s, a) => s + a.cash, 0),
            advanceOnline: view.advances.reduce((s, a) => s + a.online + a.card, 0),
          }}
          onDone={() => {
            setCancelling(false);
            router.refresh();
          }}
        />
      </Modal>

      {/* Room folio bill — billing staff only, and printed through the SAME shared
          PrintModal as every other ticket. It used to be a raw window.print() over a
          `hidden print:block` block with no chrome-hiding, so it printed the whole
          screen; and its button was ungated, so anyone could print it. Now it previews
          then prints only the bill. */}
      {canPrintBill && (
        <button
          type="button"
          onClick={() => setBillOpen(true)}
          className="w-full inline-flex items-center justify-center gap-2 h-11 text-sm font-semibold px-4 rounded-xl border-[1.5px] transition-colors"
          style={{ borderColor: INK, color: INK, background: "var(--color-canvas)", boxShadow: "var(--shadow-card)" }}
        >
          <Printer size={14} /> {paid ? "Print receipt" : "Print bill"}
        </button>
      )}

      {/* THE SAME COMPONENT A TABLE BILL PRINTS. It used to be a hand-built stack of
          TicketLines here, which is how the room bill and the table bill drifted apart —
          different headings, different column layout, no Item/Qty/Rate/Amount grid, and a
          paid room bill in Sales that listed only the food. One renderer, one mapper
          (folioToBill), so the two can no longer disagree. */}
      <PrintModal
        open={billOpen}
        onClose={() => setBillOpen(false)}
        title={paid ? "Room receipt — preview" : "Room bill — preview"}
        paperWidthMm={restaurant.paper_width_mm ?? 80}
      >
        <BillTicket
          restaurant={restaurant}
          billNo={billRef.value}
          billLabel={billRef.label}
          location={`Room ${view.room_number}`}
          // A receipt is stamped when the money moved, not when someone reprinted it.
          at={paid ? new Date(paid.paid_at) : printedAt}
          items={[]}
          sections={bill.sections}
          stay={bill.stay}
          // Unpaid with a discount typed at checkout: print that one. The folio's own
          // balanceDue was worked out without it, so leave it undefined and let BillTicket
          // derive grandTotal − advance from the discounted total instead.
          discount={!paid && liveDiscount > 0 ? liveDiscount : bill.discount}
          // Undefined-equivalent (0) for every stay with no deposit, so those bills print
          // exactly as they did before — and a table bill never passes these at all.
          advancePaid={bill.advancePaid}
          balanceDue={!paid && liveDiscount > 0 ? undefined : bill.balanceDue}
          advanceCash={bill.advanceCash}
          advanceOnline={bill.advanceOnline}
          payment={
            paid
              ? {
                  method: billMethodLabel(paid.method),
                  cashier: paid.cashier_name,
                  cash: paid.cash,
                  online: paid.online,
                  card: paid.card,
                }
              : undefined
          }
          // Closed with money still owed: the receipt must say so and say how much, or it
          // reads as fully paid. `balance` is the debt NOW, after any later repayments.
          credit={
            paid?.credit
              ? {
                  credit_number: paid.credit.credit_number,
                  customer_name: paid.credit.customer_name,
                  customer_phone: paid.credit.customer_phone,
                  tendered: paid.cash + paid.online + paid.card,
                  balance: paid.credit.balance,
                }
              : null
          }
          customer={{
            name: view.guest_name,
            phone: view.guest_phone,
            address: view.guest_address,
            idType: view.guest_id_type,
            idNumber: view.guest_id_number,
          }}
        />
      </PrintModal>
    </div>

    </div>

    {/* The menu, right of the room — tablet/desktop only (phones use "Add order"). */}
    {showMenu && (
      <div
        className="hidden lg:flex flex-1 min-w-0 flex-col rounded-xl border overflow-hidden"
        style={{
          borderColor: "var(--color-hairline-input)",
          background: "var(--color-canvas)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <MenuBrowser
          sessionId={session!.id}
          categories={menuData!.categories}
          items={menuData!.items}
          variants={menuData!.variants}
          canAddCustom={menuData!.canAddCustom}
          workstations={menuData!.workstations}
          // The room's column refreshes to pull in what was just ordered.
          onOrderPlaced={() => router.refresh()}
        />
      </div>
    )}

    {/* The menu on a PHONE: a full-screen panel over the room, opened by "Add order".
        It is part of this page — not the separate add-items route it used to link to —
        so there is nothing to load when it opens, and widening the window simply hides
        it (`lg:hidden`) in favour of the desktop menu column: no navigation, no loader. */}
    {showMenu && phoneMenuOpen && (
      <div
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 flex flex-col"
        style={{ top: NAV_HEIGHT, background: "var(--color-canvas)" }}
        role="dialog"
        aria-modal="true"
        aria-label={`Add items to Room ${view.room_number}`}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 border-b shrink-0"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <button
            type="button"
            onClick={() => setPhoneMenuOpen(false)}
            className="inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 -ml-1 rounded-lg transition-colors hover:brightness-110 active:brightness-95"
            style={{ color: "#fff", background: "var(--color-primary)" }}
          >
            <ChevronLeft size={15} />
            Back
          </button>
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            Add items · Room {view.room_number}
          </span>
        </div>
        <MenuBrowser
          sessionId={session!.id}
          categories={menuData!.categories}
          items={menuData!.items}
          variants={menuData!.variants}
          canAddCustom={menuData!.canAddCustom}
          workstations={menuData!.workstations}
          // Back to the room, which refreshes to show what was just ordered.
          onOrderPlaced={() => {
            setPhoneMenuOpen(false);
            router.refresh();
          }}
        />
      </div>
    )}
    </div>
  );
}
