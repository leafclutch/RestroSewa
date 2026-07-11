"use client";

import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";

// Shared, reusable receipt/ticket rendering used by both the live session screen
// (KOT + pre-payment bill) and the Sales dashboard (reprint of a PAID bill).

export type RestaurantInfo = {
  name: string;
  address: string | null;
  contact_phone: string | null;
  pan_vat_number: string | null;
  // Optional charges, applied to the bill only when > 0 (read from settings).
  tax_percent?: number;
  service_charge_percent?: number;
};

export type BillItem = { id: string; item_name: string; item_price: number; quantity: number };

// Present only for a bill that has been closed — drives the PAID / ON CREDIT block.
export type BillPayment = {
  method: string; // display label, e.g. "Cash", "Cash + Online"
  cashier?: string | null;
  cash?: number; // split, for a mixed payment
  online?: number;
  card?: number;
};

// Present only for a bill closed with money still owed. A credit bill is billed
// in full — this is what's left of it.
export type BillCredit = {
  credit_number: string;
  customer_name: string;
  customer_phone?: string | null;
  /** Handed over at billing time. */
  tendered: number;
  /** Still owed right now (after any later repayments). */
  balance: number;
};

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export function ticketNumber(prefix: string, seedId: string, at: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${shortId(seedId)}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
}

const rupee = (n: number) => `₹${n.toFixed(2)}`;

// ── print stylesheet (hides the app chrome, prints only the ticket) ────────────

function PrintStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
@media print {
  body { background:#fff !important; }
  body * { visibility: hidden !important; }
  .rs-ticket-print, .rs-ticket-print * { visibility: visible !important; }
  .rs-ticket-print { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 8px; }
  .rs-no-print { display: none !important; }
  @page { margin: 8mm; }
}
`,
      }}
    />
  );
}

// ── generic preview + print modal ──────────────────────────────────────────────

export function PrintModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center overflow-y-auto rs-no-print"
      style={{ background: "rgba(13,37,61,0.45)" }}
      onClick={onClose}
    >
      <PrintStyles />
      <div
        className="w-full max-w-sm my-6 rounded-2xl overflow-hidden"
        style={{ background: "var(--color-canvas)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b rs-no-print" style={{ borderColor: "var(--color-hairline)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{title}</p>
          <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}>
            <X size={16} />
          </button>
        </div>

        {/* The ticket — the only thing that ends up on paper. */}
        <div className="px-4 py-4 max-h-[70vh] overflow-y-auto" style={{ background: "var(--color-canvas-soft)" }}>
          <div
            className="rs-ticket-print mx-auto bg-white"
            style={{ width: 300, padding: "18px 16px", color: "#000", fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontSize: 12, lineHeight: 1.5 }}
          >
            {children}
          </div>
        </div>

        <div className="flex gap-2 px-4 py-3 border-t rs-no-print" style={{ borderColor: "var(--color-hairline)" }}>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button>
          <Button variant="primary" className="flex-1 flex items-center justify-center gap-2" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── ticket primitives ──────────────────────────────────────────────────────────

export function Divider() {
  return <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />;
}

export function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

// ── Bill (customer bill) — works both before payment (UNPAID) and as a reprint
//    of a completed transaction (PAID + method + cashier) ─────────────────────────

export function BillTicket({
  restaurant,
  billNo,
  orders,
  location,
  at,
  items,
  payment,
  credit,
}: {
  restaurant: RestaurantInfo;
  billNo: string;
  orders: string[];
  location: string;
  at: Date;
  items: BillItem[];
  payment?: BillPayment;
  credit?: BillCredit | null;
}) {
  const subtotal = items.reduce((s, i) => s + Number(i.item_price) * i.quantity, 0);
  const taxPct = restaurant.tax_percent ?? 0;
  const svcPct = restaurant.service_charge_percent ?? 0;
  const tax = subtotal * (taxPct / 100);
  const service = subtotal * (svcPct / 100);
  const grandTotal = subtotal + tax + service;

  // Show the tender split whenever the bill was settled with more than one.
  const parts = payment
    ? [
        { label: "Cash", v: payment.cash ?? 0 },
        { label: "Online", v: payment.online ?? 0 },
        { label: "Card", v: payment.card ?? 0 },
      ].filter((p) => p.v > 0)
    : [];
  const tenderSplit =
    parts.length > 1 ? parts.map((p) => `${p.label} ${rupee(p.v)}`).join(" · ") : null;

  return (
    <>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{restaurant.name}</div>
        {restaurant.address && <div style={{ fontSize: 11 }}>{restaurant.address}</div>}
        {restaurant.contact_phone && <div style={{ fontSize: 11 }}>Ph: {restaurant.contact_phone}</div>}
        {restaurant.pan_vat_number && <div style={{ fontSize: 11 }}>PAN/VAT: {restaurant.pan_vat_number}</div>}
        <div style={{ fontWeight: 700, letterSpacing: 1, marginTop: 4 }}>{payment ? "TAX INVOICE" : "BILL"}</div>
      </div>
      <Divider />
      <Line label={payment ? "Receipt No" : "Bill No"} value={billNo} />
      <Line label={orders.length > 1 ? "Orders" : "Order"} value={orders.map(shortId).join(", ") || "—"} />
      <Line label="Table" value={location} />
      <Line label="Date" value={at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
      {payment?.cashier && <Line label="Cashier" value={payment.cashier} />}
      {credit && <Line label="Credit ID" value={credit.credit_number} />}
      {credit && <Line label="Customer" value={credit.customer_name} />}
      <Divider />

      {/* Items */}
      <div style={{ display: "flex", fontWeight: 700, fontSize: 11 }}>
        <span style={{ flex: 1 }}>Item</span>
        <span style={{ width: 28, textAlign: "center" }}>Qty</span>
        <span style={{ width: 54, textAlign: "right" }}>Rate</span>
        <span style={{ width: 62, textAlign: "right" }}>Amount</span>
      </div>
      <div style={{ borderTop: "1px solid #000", margin: "4px 0" }} />
      {items.length === 0 ? (
        <div style={{ textAlign: "center" }}>No items.</div>
      ) : (
        items.map((it) => (
          <div key={it.id} style={{ display: "flex", alignItems: "flex-start", marginTop: 2 }}>
            <span style={{ flex: 1 }}>{it.item_name}</span>
            <span style={{ width: 28, textAlign: "center" }}>{it.quantity}</span>
            <span style={{ width: 54, textAlign: "right" }}>{Number(it.item_price).toFixed(2)}</span>
            <span style={{ width: 62, textAlign: "right" }}>{(Number(it.item_price) * it.quantity).toFixed(2)}</span>
          </div>
        ))
      )}
      <Divider />

      <Line label="Subtotal" value={rupee(subtotal)} />
      {tax > 0 && <Line label={`Tax (${taxPct}%)`} value={rupee(tax)} />}
      {service > 0 && <Line label={`Service (${svcPct}%)`} value={rupee(service)} />}
      <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
      <Line label="GRAND TOTAL" value={rupee(grandTotal)} bold />
      <Divider />

      {credit ? (
        // Closed with money still owed — the receipt has to say so, and say how
        // much, or it reads as a paid bill.
        <>
          <Line
            label="Status"
            value={credit.tendered > 0 ? "PARTIALLY PAID" : "ON CREDIT"}
            bold
          />
          {credit.tendered > 0 && <Line label="Paid at billing" value={rupee(credit.tendered)} />}
          {tenderSplit && <div style={{ fontSize: 11, textAlign: "right" }}>{tenderSplit}</div>}
          <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
          <Line label="BALANCE DUE" value={rupee(credit.balance)} bold />
          {credit.customer_phone && (
            <div style={{ fontSize: 11, marginTop: 4 }}>Ph: {credit.customer_phone}</div>
          )}
          <div style={{ textAlign: "center", fontSize: 11, marginTop: 6 }}>
            Please retain this receipt until the balance is settled.
          </div>
        </>
      ) : payment ? (
        <>
          <Line label="Status" value="PAID" bold />
          <Line label="Payment" value={payment.method} />
          {tenderSplit && <div style={{ fontSize: 11, textAlign: "right" }}>{tenderSplit}</div>}
        </>
      ) : (
        <div style={{ textAlign: "center", fontSize: 11 }}>Status: UNPAID</div>
      )}
      {!credit && (
        <div style={{ textAlign: "center", fontSize: 11, marginTop: 6 }}>Thank you! Please visit again.</div>
      )}
    </>
  );
}

// ── Credit receipt — the record of a customer's debt and everything paid against
//    it. Reprintable at any time; reflects the balance as of NOW. ──────────────

export type CreditReceiptEntry = {
  id: string;
  amount: number;
  method: string;
  staff_name: string | null;
  created_at: string;
  at_billing: boolean;
};

export function CreditReceiptTicket({
  restaurant,
  creditNumber,
  customerName,
  customerPhone,
  openedAt,
  location,
  billAmount,
  paidAmount,
  balance,
  history,
  notes,
}: {
  restaurant: RestaurantInfo;
  creditNumber: string;
  customerName: string;
  customerPhone: string | null;
  openedAt: Date;
  location: string;
  billAmount: number;
  paidAmount: number;
  balance: number;
  history: CreditReceiptEntry[];
  notes: string | null;
}) {
  const settled = balance <= 0;

  return (
    <>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{restaurant.name}</div>
        {restaurant.address && <div style={{ fontSize: 11 }}>{restaurant.address}</div>}
        {restaurant.contact_phone && <div style={{ fontSize: 11 }}>Ph: {restaurant.contact_phone}</div>}
        {restaurant.pan_vat_number && <div style={{ fontSize: 11 }}>PAN/VAT: {restaurant.pan_vat_number}</div>}
        <div style={{ fontWeight: 700, letterSpacing: 1, marginTop: 4 }}>
          {settled ? "CREDIT RECEIPT — SETTLED" : "CREDIT RECEIPT"}
        </div>
      </div>
      <Divider />
      <Line label="Credit ID" value={creditNumber} />
      <Line label="Customer" value={customerName} />
      {customerPhone && <Line label="Phone" value={customerPhone} />}
      <Line label="Table" value={location} />
      <Line label="Opened" value={openedAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
      <Divider />

      <Line label="Original bill" value={rupee(billAmount)} />
      <Line label="Total paid" value={rupee(paidAmount)} />
      <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
      <Line label={settled ? "BALANCE" : "BALANCE DUE"} value={rupee(balance)} bold />
      <Divider />

      <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Payment history</div>
      {history.length === 0 ? (
        <div style={{ textAlign: "center", fontSize: 11 }}>No payments received yet.</div>
      ) : (
        history.map((h) => (
          <div key={h.id} style={{ marginTop: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>
                {new Date(h.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                {" · "}
                {h.method}
                {h.at_billing ? " (at billing)" : ""}
              </span>
              <span>{rupee(h.amount)}</span>
            </div>
            {h.staff_name && (
              <div style={{ fontSize: 10, color: "#444" }}>Received by {h.staff_name}</div>
            )}
          </div>
        ))
      )}

      {notes && (
        <>
          <Divider />
          <div style={{ fontSize: 11 }}>Note: {notes}</div>
        </>
      )}

      <Divider />
      <div style={{ textAlign: "center", fontSize: 11 }}>
        {settled
          ? "This credit is fully settled. Thank you!"
          : "Please retain this receipt until the balance is settled."}
      </div>
    </>
  );
}
