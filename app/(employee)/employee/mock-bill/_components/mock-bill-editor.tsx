"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  Store,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PrintModal, BillTicket } from "@/app/(employee)/employee/_components/bill-ticket";
import type { RestaurantInfo } from "@/app/(employee)/employee/_components/bill-ticket";
import { billNumberLabel } from "@/lib/billing/bill-number";
import { billMethodLabel } from "@/lib/billing/payment-method";
import {
  deriveTotals,
  emptyDraft,
  markBillNumber,
  moveLine,
  newLine,
  parseLocalInputValue,
  toBillItems,
  toCredit,
  toTender,
} from "@/lib/mock-bill/draft";
import type {
  MockBillDraft,
  MockBillSeed,
  MockDownTender,
  MockPaymentMethod,
} from "@/lib/mock-bill/draft";

/**
 * ── THE MOCK BILLING WORKSPACE ────────────────────────────────────────────────
 *
 * Everything on this screen is client state. There is no server action here, no fetch, no
 * form POST — pressing Print opens the browser's print dialog and that is the end of it.
 * The feature's only server call already happened: the PIN that unlocked this component.
 *
 * The printed output comes from the SHARED `BillTicket`, the same component the session
 * screen and the Sales reprint use. That is what makes the paper identical rather than
 * merely similar: there is one renderer, one set of thermal geometry constants, one footer.
 * This file's job is to produce that component's props and nothing else — if you ever find
 * yourself re-implementing a line of the ticket here, the feature has gone wrong.
 *
 * The one mark that distinguishes a mock bill is applied to the bill NUMBER as a plain
 * string (`markBillNumber` → "1024 · M"), so `BillTicket` stays entirely unaware that mock
 * bills exist.
 */

const rupee = (n: number) => `₹${n.toFixed(2)}`;

const CARD_STYLE = { background: "var(--color-canvas)", borderColor: "var(--color-hairline)" };
const HAIRLINE = { borderColor: "var(--color-hairline)" };

// ── small presentational helpers ──────────────────────────────────────────────

function Card({
  title,
  subtitle,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const body = <div className="px-3 sm:px-4 py-3.5 flex flex-col gap-3">{children}</div>;

  return (
    <section className="rounded-2xl border overflow-hidden" style={CARD_STYLE}>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full flex items-center gap-2 px-3 sm:px-4 py-3 text-left"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium" style={{ color: "var(--color-ink)" }}>{title}</span>
            {subtitle && (
              <span className="block text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>{subtitle}</span>
            )}
          </span>
          <ChevronDown
            size={18}
            className="shrink-0 transition-transform duration-200"
            style={{ color: "var(--color-ink-mute)", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          />
        </button>
      ) : (
        <div className="px-3 sm:px-4 py-3 border-b" style={HAIRLINE}>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{title}</p>
          {subtitle && <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{subtitle}</p>}
        </div>
      )}
      {(!collapsible || open) && body}
    </section>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 min-w-0 ${className ?? ""}`}>
      <span
        className="text-xs uppercase"
        style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * A number field that keeps its own TEXT while being typed.
 *
 * Storing the number straight back into state would fight the person using it: clearing
 * the box would snap it to "0", and a half-typed "12." would be rewritten to "12" under
 * the cursor. So the text is local and only the parsed value travels up. The editor's
 * Reset remounts the whole form (see `resetKey`), which is what re-seeds these.
 */
function NumberInput({
  value,
  onValue,
  className,
  placeholder,
  id,
}: {
  value: number;
  onValue: (n: number) => void;
  className?: string;
  placeholder?: string;
  id?: string;
}) {
  const [text, setText] = useState(value === 0 ? "" : String(value));
  return (
    <Input
      id={id}
      inputMode="decimal"
      placeholder={placeholder ?? "0"}
      value={text}
      className={className}
      onChange={(e) => {
        const t = e.target.value;
        // Digits and at most one decimal point. Nothing here is ever negative.
        if (!/^\d*\.?\d*$/.test(t)) return;
        setText(t);
        onValue(t === "" || t === "." ? 0 : parseFloat(t));
      }}
    />
  );
}

// The last two are not tenders — they are different documents. "Unpaid" is the bill printed
// BEFORE anything is taken; "Credit" is the bill CLOSED with money still owed, which is what
// this app calls an unpaid bill (see Credits / customer accounts).
const METHODS: { key: MockPaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "online", label: "Online" },
  { key: "card", label: "Card" },
  { key: "mixed", label: "Cash + Online" },
  { key: "credit", label: "Credit" },
  { key: "unpaid", label: "Unpaid" },
];

const DOWN_TENDERS: { key: MockDownTender; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "online", label: "Online" },
  { key: "mixed", label: "Cash + Online" },
];

/** A small pill row. Used for the payment method and the credit down-payment tender. */
function ChipRow<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            className="px-3 py-1.5 rounded-full border text-sm transition-colors"
            style={{
              borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
              background: active ? "var(--color-primary)" : "var(--color-canvas)",
              color: active ? "#fff" : "var(--color-ink)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── the editor ────────────────────────────────────────────────────────────────

export function MockBillEditor({ seed, staffName }: { seed: MockBillSeed; staffName: string }) {
  const fresh = (): MockBillDraft => ({ ...emptyDraft(seed), cashier: staffName });

  const [draft, setDraft] = useState<MockBillDraft>(fresh);
  // Bumped by Reset. Used as a `key` on the form column so every NumberInput's local text
  // is thrown away and re-seeded from the new draft, rather than lingering from the old one.
  const [resetKey, setResetKey] = useState(0);
  const [printOpen, setPrintOpen] = useState(false);
  const [manualTotal, setManualTotal] = useState(false);

  const totals = useMemo(() => deriveTotals(draft), [draft]);

  const set = <K extends keyof MockBillDraft>(key: K, value: MockBillDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const patchLine = (id: string, patch: Partial<{ name: string; qty: number; price: number }>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  const addLine = () => setDraft((d) => ({ ...d, lines: [...d.lines, newLine()] }));
  const removeLine = (id: string) =>
    setDraft((d) => {
      const lines = d.lines.filter((l) => l.id !== id);
      // Never leave the list empty — an editor with no rows has no obvious way back.
      return { ...d, lines: lines.length ? lines : [newLine()] };
    });
  const shiftLine = (index: number, delta: number) =>
    setDraft((d) => ({ ...d, lines: moveLine(d.lines, index, delta) }));

  const reset = () => {
    setDraft(fresh());
    setManualTotal(false);
    setResetKey((k) => k + 1);
  };

  // Turning the manual total ON seeds it with the figure currently on screen, so the
  // demonstrator edits a real number rather than starting from zero.
  const toggleManualTotal = (on: boolean) => {
    setManualTotal(on);
    set("totalOverride", on ? Number(totals.computedTotal.toFixed(2)) : null);
  };

  // ── the shared component's props ────────────────────────────────────────────
  const restaurant: RestaurantInfo = {
    name: draft.restaurantName,
    address: draft.address.trim() || null,
    contact_phone: draft.phone.trim() || null,
    pan_vat_number: draft.panVat.trim() || null,
    tax_percent: draft.taxPercent,
    service_charge_percent: draft.servicePercent,
    paper_width_mm: draft.paperWidthMm,
    bill_number_label: draft.billLabel,
  };
  const hasCustomer = !!(draft.customerName.trim() || draft.customerPhone.trim());
  // The tender comes back as facts; how a method is SPELLED on a bill belongs to
  // `payment-method.ts`, which is the same map the Sales reprint and the room folio use —
  // so a mock bill's "Cash + Online" reads identically to a real one's.
  const tender = toTender(draft, totals.total);
  // Non-null only for a credit bill. `BillTicket` takes its credit branch when this is set,
  // reading the tender above purely for the "Cash ₹x · Online ₹y" split line.
  const credit = toCredit(draft, totals.total);

  const inputSm = "py-1.5 text-sm";

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-5 pt-4 pb-12">
      {/* Page head. Says plainly what this is — on SCREEN only; nothing here reaches paper. */}
      <div className="flex items-start gap-3 mb-4">
        <span
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
        >
          <Receipt size={20} strokeWidth={1.9} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-medium" style={{ color: "var(--color-ink)" }}>Mock bill</h1>
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            For demos, previews and training. Nothing here is saved, and nothing reaches sales,
            stock, finance or the kitchen.
          </p>
        </div>
        <Link
          href="/employee/dashboard"
          className="text-sm px-3 py-1.5 rounded-lg border shrink-0"
          style={{ ...HAIRLINE, color: "var(--color-ink-mute)" }}
        >
          Done
        </Link>
      </div>

      <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── the form ─────────────────────────────────────────────────────── */}
        <div key={resetKey} className="flex flex-col gap-4 min-w-0">
          <Card title="Bill" subtitle="What the top of the receipt says">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Table / room">
                <Input value={draft.location} onChange={(e) => set("location", e.target.value)} placeholder="Table 1" />
              </Field>
              <Field label="Bill number">
                <Input value={draft.billNo} onChange={(e) => set("billNo", e.target.value)} placeholder="1001" />
              </Field>
              <Field label="Number label">
                <select
                  value={draft.billLabel}
                  onChange={(e) => set("billLabel", e.target.value === "order" ? "order" : "bill")}
                  className="w-full rounded-sm border border-hairline-input bg-canvas px-3 py-2 text-ink text-[15px] font-light shadow-xs"
                >
                  <option value="bill">Bill No</option>
                  <option value="order">Order No</option>
                </select>
              </Field>
              <Field label="Date &amp; time">
                <Input type="datetime-local" value={draft.at} onChange={(e) => set("at", e.target.value)} />
              </Field>
              <Field label="Customer name">
                <Input value={draft.customerName} onChange={(e) => set("customerName", e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Customer phone">
                <Input value={draft.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} placeholder="Optional" />
              </Field>
            </div>
          </Card>

          <Card title="Items" subtitle="Add, edit, reorder or remove lines">
            <div className="flex flex-col gap-2">
              {draft.lines.map((line, i) => (
                <div key={line.id} className="rounded-xl border px-2.5 py-2.5 flex flex-col gap-2" style={HAIRLINE}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-4 text-center shrink-0" style={{ color: "var(--color-ink-mute)" }}>
                      {i + 1}
                    </span>
                    <Input
                      value={line.name}
                      onChange={(e) => patchLine(line.id, { name: e.target.value })}
                      placeholder="Item name"
                      className={`flex-1 ${inputSm}`}
                      aria-label={`Item ${i + 1} name`}
                    />
                    {/* Reorder with buttons, not drag: reliable with a thumb on a phone and
                        with a tablet in a case, which is where this gets used. */}
                    <button
                      type="button"
                      onClick={() => shiftLine(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move item ${i + 1} up`}
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 disabled:opacity-30"
                      style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftLine(i, 1)}
                      disabled={i === draft.lines.length - 1}
                      aria-label={`Move item ${i + 1} down`}
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 disabled:opacity-30"
                      style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      aria-label={`Delete item ${i + 1}`}
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "var(--color-danger-bg)", color: "var(--color-ruby)" }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 pl-6">
                    <span className="text-xs shrink-0" style={{ color: "var(--color-ink-mute)" }}>Qty</span>
                    <NumberInput
                      value={line.qty}
                      onValue={(qty) => patchLine(line.id, { qty })}
                      className={`w-16 ${inputSm}`}
                      placeholder="1"
                    />
                    <span className="text-xs shrink-0" style={{ color: "var(--color-ink-mute)" }}>Rate</span>
                    <NumberInput
                      value={line.price}
                      onValue={(price) => patchLine(line.id, { price })}
                      className={`w-24 ${inputSm}`}
                    />
                    <span className="ml-auto text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
                      {rupee(line.qty * line.price)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addLine}
              className="w-full rounded-xl border py-2.5 text-sm font-medium flex items-center justify-center gap-2"
              style={{ ...HAIRLINE, color: "var(--color-ink)" }}
            >
              <Plus size={15} /> Add item
            </button>
          </Card>

          <Card title="Charges" subtitle="Discount, tax and service, exactly as a real bill applies them">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Discount (₹)">
                <NumberInput value={draft.discount} onValue={(v) => set("discount", v)} />
              </Field>
              <Field label="Tax %">
                <NumberInput value={draft.taxPercent} onValue={(v) => set("taxPercent", v)} />
              </Field>
              <Field label="Service %">
                <NumberInput value={draft.servicePercent} onValue={(v) => set("servicePercent", v)} />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink)" }}>
              <input
                type="checkbox"
                checked={manualTotal}
                onChange={(e) => toggleManualTotal(e.target.checked)}
                className="w-4 h-4"
              />
              Set the grand total manually
            </label>
            {manualTotal && (
              <Field label="Grand total (₹)">
                {/* No `key` needed: ticking the box mounts this fresh, and `toggleManualTotal`
                    has already seeded `totalOverride` in the same batched update — so the
                    field opens showing the figure that was on screen. */}
                <NumberInput value={draft.totalOverride ?? 0} onValue={(v) => set("totalOverride", v)} />
              </Field>
            )}
          </Card>

          <Card title="Payment" subtitle="Drives the PAID / ON CREDIT / UNPAID block at the foot of the bill">
            <ChipRow options={METHODS} value={draft.method} onChange={(v) => set("method", v)} label="Payment method" />

            {draft.method === "mixed" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cash (₹)">
                  <NumberInput value={draft.cash} onValue={(v) => set("cash", v)} />
                </Field>
                <Field label="Online (₹)">
                  <NumberInput value={draft.online} onValue={(v) => set("online", v)} />
                </Field>
              </div>
            )}

            {/* A credit bill is billed IN FULL and settled later, so it carries an account
                and whatever was handed over at billing time. Nothing handed over prints
                "ON CREDIT"; a part payment prints "PARTIALLY PAID" — the same two states a
                real closed-on-credit bill produces. */}
            {draft.method === "credit" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Credit ID">
                    <Input value={draft.creditNumber} onChange={(e) => set("creditNumber", e.target.value)} placeholder="CR-0001" />
                  </Field>
                  <Field label="Credit account">
                    <Input value={draft.creditAccount} onChange={(e) => set("creditAccount", e.target.value)} placeholder="Name on the account" />
                  </Field>
                  <Field label="Account phone" className="col-span-2">
                    <Input value={draft.creditPhone} onChange={(e) => set("creditPhone", e.target.value)} placeholder="Optional" />
                  </Field>
                </div>

                <Field label="Paid at billing — how">
                  <ChipRow
                    options={DOWN_TENDERS}
                    value={draft.tenderedAs}
                    onChange={(v) => set("tenderedAs", v)}
                    label="Down payment tender"
                  />
                </Field>

                {draft.tenderedAs === "mixed" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Cash (₹)">
                      <NumberInput value={draft.cash} onValue={(v) => set("cash", v)} />
                    </Field>
                    <Field label="Online (₹)">
                      <NumberInput value={draft.online} onValue={(v) => set("online", v)} />
                    </Field>
                  </div>
                ) : (
                  <Field label="Paid at billing (₹)">
                    <NumberInput value={draft.tendered} onValue={(v) => set("tendered", v)} />
                  </Field>
                )}
              </>
            )}

            {draft.method !== "unpaid" && (
              <Field label="Cashier">
                <Input value={draft.cashier} onChange={(e) => set("cashier", e.target.value)} placeholder="Optional" />
              </Field>
            )}
          </Card>

          <Card
            title="Receipt header"
            subtitle="Pre-filled from this restaurant's real settings"
            collapsible
            defaultOpen={false}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Restaurant name" className="col-span-2">
                <Input value={draft.restaurantName} onChange={(e) => set("restaurantName", e.target.value)} />
              </Field>
              <Field label="Address" className="col-span-2">
                <Input value={draft.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
              <Field label="PAN / VAT">
                <Input value={draft.panVat} onChange={(e) => set("panVat", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Paper width" className="col-span-2">
                <div className="flex gap-2">
                  {([58, 80] as const).map((w) => {
                    const active = draft.paperWidthMm === w;
                    return (
                      <button
                        key={w}
                        type="button"
                        onClick={() => set("paperWidthMm", w)}
                        aria-pressed={active}
                        className="flex-1 px-3 py-2 rounded-lg border text-sm"
                        style={{
                          borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
                          background: active ? "var(--color-primary)" : "var(--color-canvas)",
                          color: active ? "#fff" : "var(--color-ink)",
                        }}
                      >
                        <Store size={13} className="inline mr-1.5 -mt-0.5" />
                        {w} mm
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </Card>

          <Card title="Notes" subtitle="Only you see this — it is never printed">
            <textarea
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              placeholder="Scratch space for the demo — not part of the bill."
              className="w-full rounded-sm border border-hairline-input bg-canvas px-3 py-2 text-ink text-[15px] font-light shadow-xs"
            />
          </Card>
        </div>

        {/* ── the summary rail ─────────────────────────────────────────────── */}
        <aside
          className="flex flex-col gap-3 lg:sticky"
          // Parks under the sticky StaffNav (56px, plus the notch inset on an iPhone).
          style={{ top: "calc(56px + env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <section className="rounded-2xl border overflow-hidden" style={CARD_STYLE}>
            <div className="px-4 py-3 border-b" style={HAIRLINE}>
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Total</p>
            </div>
            <div className="px-4 py-3.5 flex flex-col gap-1.5 text-sm">
              <Row label="Subtotal" value={rupee(totals.subtotal)} />
              {draft.discount > 0 && <Row label="Discount" value={`- ${rupee(draft.discount)}`} />}
              {totals.tax > 0 && <Row label={`Tax (${draft.taxPercent}%)`} value={rupee(totals.tax)} />}
              {totals.service > 0 && <Row label={`Service (${draft.servicePercent}%)`} value={rupee(totals.service)} />}
              <div className="border-t my-1" style={HAIRLINE} />
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium" style={{ color: "var(--color-ink)" }}>
                  {draft.discount > 0 ? "Total payable" : "Grand total"}
                </span>
                <span className="text-lg font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
                  {rupee(totals.total)}
                </span>
              </div>
              {totals.overridden && (
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  Set manually. Derived figure: {rupee(totals.computedTotal)}.
                </p>
              )}
              {/* A credit bill is billed in full; what the customer still owes is the number
                  the cashier is actually looking for, so show it rather than make them
                  subtract. Mirrors the BALANCE DUE line on the printed bill. */}
              {credit && (
                <>
                  {credit.tendered > 0 && <Row label="Paid at billing" value={rupee(credit.tendered)} />}
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium" style={{ color: "var(--color-ink)" }}>Balance due</span>
                    <span className="text-lg font-medium tabular-nums" style={{ color: "var(--color-ruby)" }}>
                      {rupee(credit.balance)}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                    Prints as {credit.tendered > 0 ? "PARTIALLY PAID" : "ON CREDIT"}.
                  </p>
                </>
              )}
            </div>
            <div className="px-4 pb-4 flex flex-col gap-2">
              <Button
                variant="primary"
                className="w-full flex items-center justify-center gap-2"
                onClick={() => setPrintOpen(true)}
              >
                <Printer size={15} /> Print mock bill
              </Button>
              <button
                type="button"
                onClick={reset}
                className="w-full rounded-pill border py-2 text-sm flex items-center justify-center gap-2"
                style={{ ...HAIRLINE, color: "var(--color-ink-mute)" }}
              >
                <RotateCcw size={14} /> Start over
              </button>
            </div>
          </section>
        </aside>
      </div>

      {/* The preview + print path — the SAME modal and the SAME ticket the real POS uses. */}
      <PrintModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        title="Mock bill — preview"
        paperWidthMm={draft.paperWidthMm}
      >
        <BillTicket
          restaurant={restaurant}
          // The whole verification mark: a trailing "· M" on the number. Nothing else on
          // this receipt differs from a real one.
          billNo={markBillNumber(draft.billNo)}
          billLabel={billNumberLabel(draft.billLabel)}
          location={draft.location}
          at={parseLocalInputValue(draft.at)}
          items={toBillItems(draft)}
          discount={draft.discount}
          grandTotalOverride={totals.overridden ? totals.total : undefined}
          payment={tender ? { ...tender, method: billMethodLabel(tender.method) } : undefined}
          credit={credit}
          customer={
            hasCustomer
              ? {
                  name: draft.customerName.trim() || null,
                  phone: draft.customerPhone.trim() || null,
                  address: null,
                }
              : null
          }
        />
      </PrintModal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ color: "var(--color-ink-mute)" }}>{label}</span>
      <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>{value}</span>
    </div>
  );
}
