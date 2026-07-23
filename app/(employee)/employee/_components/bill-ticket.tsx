"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
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
  // Printed at the top of a customer bill, when the restaurant has uploaded one.
  logo_url?: string | null;
  // Thermal roll width in mm; sizes the print page + on-screen preview. Default 80.
  paper_width_mm?: 58 | 80;
  // How the order's sequential number is shown (Admin → Settings). Used by the bill
  // AND the workstation tickets so every document on an order reads the same.
  bill_number_pad?: number;
  bill_number_label?: "bill" | "order";
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
// Thermal-first: the page IS the roll. `@page { size: <W>mm auto }` tells the browser
// the paper is a W-mm-wide continuous roll with NO margins, so the receipt fills the
// full width instead of sitting as a sliver inside an A4 sheet — and the print preview
// then matches the physical output. On a plain A4 printer the same rules simply print a
// tidy W-mm column down the left edge, so A4 stays a valid fallback.

function PrintStyles({ widthMm }: { widthMm: 58 | 80 }) {
  const fontPx = widthMm === 58 ? 11 : 12;
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
@media print {
  html, body { background:#fff !important; margin:0 !important; padding:0 !important; }
  /* The ticket is portaled to <body>, so it is a direct sibling of the app. Hiding every
     OTHER top-level node with display:none — NOT visibility:hidden — is what stops the
     bill printing as several identical pages: a visibility:hidden page still occupies its
     full height, and when that height spans multiple pages (e.g. a long Sales list you
     reprint a paid bill from) the browser paints a position:fixed ticket on EVERY one of
     them. display:none removes that height, so the ticket is the only thing left and it
     prints exactly once, in normal flow. */
  body > :not(.rs-print-portal) { display: none !important; }
  /* Unwrap the modal's on-screen chrome (backdrop, card, scroll box) so the ticket flows
     as the sole page content instead of sitting inside a fixed, scrolling, coloured box.
     the :not(style) is essential — this style tag is itself a child of .rs-print-portal, and
     forcing display:block on it would print its own CSS source text at the top of the page. */
  .rs-print-portal {
    position: static !important;
    display: block !important;
    overflow: visible !important;
    background: #fff !important;
  }
  .rs-print-portal > *:not(style) {
    position: static !important;
    display: block !important;
    overflow: visible !important;
    max-height: none !important;
    margin: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    border: 0 !important;
  }
  .rs-print-portal > *:not(style) > * {
    max-height: none !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    background: transparent !important;
  }
  .rs-print-portal style { display: none !important; }
  .rs-no-print { display: none !important; }
  .rs-ticket-print {
    position: static !important;
    width: ${widthMm}mm !important;
    max-width: ${widthMm}mm !important;
    margin: 0 auto !important;
    padding: 0 2mm !important;
    box-shadow: none !important;
    background: #fff !important;
    font-size: ${fontPx}px !important;
    overflow-wrap: anywhere;
  }
  .rs-ticket-print img { max-width: 100% !important; }
}
`,
      }}
    />
  );
}

// mm → CSS px at 96dpi, so the on-screen preview is the same width as the printed roll.
const MM_PER_PX = 25.4 / 96; // ≈ 0.2646
const mmToPx = (mm: number) => Math.round(mm / MM_PER_PX);
const pxToMm = (px: number) => px * MM_PER_PX;

// ── generic preview + print modal ──────────────────────────────────────────────

export function PrintModal({
  open,
  onClose,
  title,
  children,
  paperWidthMm = 80,
  onBeforePrint,
  printLabel = "Print",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Thermal roll width; sizes both the print page and the on-screen preview. */
  paperWidthMm?: 58 | 80;
  /**
   * Runs on Print, BEFORE the browser dialog opens; a non-ok result aborts it.
   *
   * Exists so an Order Ticket can be recorded server-side at the moment it is actually
   * printed — claiming its number and marking its items as sent — rather than when the
   * preview is merely opened. Callers update their own state inside this, and the
   * repainted ticket is what gets measured and printed. Bill/receipt callers omit it.
   *
   * The `error` is shown in the modal, so the reason a print was refused ("another till
   * already sent these") reaches the person holding the printer.
   */
  onBeforePrint?: () => Promise<{ ok: true } | { ok: false; error?: string }>;
  /** Overrides the Print button's text (e.g. "Print & send to Kitchen"). */
  printLabel?: string;
}) {
  // Portaled to <body>, and `document` only exists after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The ticket, and a dedicated <style> that owns the @page size.
  const ticketRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLStyleElement>(null);

  // A thermal roll has a fixed WIDTH but no fixed height — it prints continuously and
  // cuts at the end of the content. So the printed page must be `<width>mm × <content>mm`.
  // Chromium ignores `@page { size: <w> auto }` (it silently falls back to Letter, leaving
  // the receipt in the corner of a huge sheet), and only honours an EXPLICIT height. So we
  // measure the ticket's real rendered height at the roll width and set the page to match —
  // one continuous receipt, no wasted paper, preview == print.
  const measureAndSetPage = useCallback(() => {
    const el = ticketRef.current;
    const pageEl = pageRef.current;
    if (!el || !pageEl) return;
    const prevW = el.style.width;
    const prevP = el.style.padding;
    // Lay the ticket out at the exact print geometry, measure, then restore.
    el.style.width = `${paperWidthMm}mm`;
    el.style.padding = "0 2mm";
    const heightPx = el.getBoundingClientRect().height;
    el.style.width = prevW;
    el.style.padding = prevP;
    // +4mm tail so the last line never clips and the auto-cutter has a little margin.
    const heightMm = Math.max(1, Math.ceil(pxToMm(heightPx)) + 4);
    pageEl.textContent = `@page { size: ${paperWidthMm}mm ${heightMm}mm; margin: 0; }`;
  }, [paperWidthMm]);

  // Size the page whenever the preview opens (covers Ctrl+P as well as the Print button).
  useEffect(() => {
    if (open && mounted) measureAndSetPage();
    if (open) setErr(null);
  }, [open, mounted, measureAndSetPage]);

  if (!open || !mounted) return null;

  const previewPx = mmToPx(paperWidthMm);

  const handlePrint = async () => {
    if (onBeforePrint) {
      setBusy(true);
      setErr(null);
      let res: { ok: true } | { ok: false; error?: string };
      try {
        res = await onBeforePrint();
      } catch {
        res = { ok: false };
      }
      setBusy(false);
      if (!res.ok) {
        setErr(res.error ?? "Could not prepare this ticket. Nothing was printed.");
        return;
      }
      // `onBeforePrint` changed what the ticket says (its number, its items). React has
      // to actually PAINT that before we measure, because the page height is measured
      // from live DOM — measuring first would size the page to the stale ticket. Two
      // frames is the reliable "after the next paint" barrier.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    measureAndSetPage(); // re-measure against the final laid-out content, then print
    window.print();
  };

  // Rendered at <body>, NOT inline. Two reasons, both learned the hard way:
  //  1. `position: fixed` here escapes the `.rs-page` entry-animation transform (and any
  //     pull-to-refresh transform), which would otherwise become its containing block and
  //     fling the modal off-screen — the same trap the credits modal hit.
  //  2. The outer div deliberately does NOT carry `rs-no-print`. It used to, and since the
  //     ticket lives INSIDE it, `display:none` on this ancestor removed the ticket from the
  //     print document entirely — the "print comes out blank" bug. The chrome (header/footer)
  //     is hidden via its own `rs-no-print`; the ticket is shown via the visibility rules.
  return createPortal(
    <div
      className="rs-print-portal fixed inset-0 z-[80] flex items-start sm:items-center justify-center overflow-y-auto"
      style={{ background: "rgba(13,37,61,0.45)" }}
      onClick={onClose}
    >
      <PrintStyles widthMm={paperWidthMm} />
      {/* Owns the @page size — set dynamically to the roll width × measured content height. */}
      <style ref={pageRef} />
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
            ref={ticketRef}
            className="rs-ticket-print mx-auto bg-white"
            style={{ width: previewPx, padding: "14px 12px", color: "#000", fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontSize: paperWidthMm === 58 ? 11 : 12, lineHeight: 1.45, overflowWrap: "anywhere" }}
          >
            {children}
          </div>
        </div>

        <div className="px-4 py-3 border-t rs-no-print" style={{ borderColor: "var(--color-hairline)" }}>
          {err && (
            <p className="text-xs mb-2 text-center" style={{ color: "var(--color-danger)" }}>{err}</p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>Close</Button>
            <Button
              variant="primary"
              className="flex-1 flex items-center justify-center gap-2"
              onClick={handlePrint}
              disabled={busy}
            >
              <Printer size={14} /> {busy ? "Preparing…" : printLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
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

// Discreet software credit at the very foot of a receipt — well below the restaurant's
// own name/logo/thank-you, in small muted type, so it never competes with their branding.
// Printed once per receipt (each receipt component renders it a single time).
export function PoweredBy() {
  return (
    <div
      className="rs-powered-by"
      style={{ textAlign: "center", marginTop: 10, fontSize: 9, lineHeight: 1.35, color: "#555" }}
    >
      <div style={{ letterSpacing: 0.3 }}>Powered by HRestroSewa</div>
      <div style={{ fontSize: 8, color: "#777" }}>Restaurant &amp; Hotel Management System</div>
    </div>
  );
}

// ── Bill (customer bill) — works both before payment (UNPAID) and as a reprint
//    of a completed transaction (PAID + method + cashier) ─────────────────────────

// Optional customer block for takeaway / delivery bills.
export type BillCustomer = { name: string | null; phone: string | null; address: string | null };

export function BillTicket({
  restaurant,
  billNo,
  billLabel,
  location,
  at,
  items,
  payment,
  credit,
  customer,
  discount = 0,
}: {
  restaurant: RestaurantInfo;
  billNo: string;
  /** Overrides the bill-number line label (e.g. "Bill No" / "Order No" from settings).
   *  When absent, falls back to "Receipt No" for a paid bill, "Bill No" otherwise. */
  billLabel?: string;
  location: string;
  at: Date;
  items: BillItem[];
  payment?: BillPayment;
  credit?: BillCredit | null;
  customer?: BillCustomer | null;
  /** Knocked off at payment. Only a paid bill has one — the pre-payment preview is
   *  printed before the cashier has entered it, so it passes 0. */
  discount?: number;
}) {
  const hasCustomer = !!(customer && (customer.name || customer.phone || customer.address));
  const subtotal = items.reduce((s, i) => s + Number(i.item_price) * i.quantity, 0);
  const taxPct = restaurant.tax_percent ?? 0;
  const svcPct = restaurant.service_charge_percent ?? 0;
  const tax = subtotal * (taxPct / 100);
  const service = subtotal * (svcPct / 100);
  // The discount comes off AFTER tax/service — it's a reduction of the amount payable,
  // not of the goods, so the tax lines still reconcile against the subtotal above them.
  const grandTotal = Math.max(0, subtotal + tax + service - discount);

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
        {restaurant.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={restaurant.logo_url}
            alt=""
            style={{ maxHeight: 48, maxWidth: "100%", margin: "0 auto 4px", display: "block", objectFit: "contain" }}
          />
        )}
        <div style={{ fontWeight: 700, fontSize: 15 }}>{restaurant.name}</div>
        {restaurant.address && <div style={{ fontSize: 11 }}>{restaurant.address}</div>}
        {restaurant.contact_phone && <div style={{ fontSize: 11 }}>Ph: {restaurant.contact_phone}</div>}
        {restaurant.pan_vat_number && <div style={{ fontSize: 11 }}>PAN No.: {restaurant.pan_vat_number}</div>}
        <div style={{ fontWeight: 700, letterSpacing: 1, marginTop: 4 }}>{payment ? "TAX INVOICE" : "BILL"}</div>
      </div>
      <Divider />
      {/* The table/room is what staff match the bill to — make it prominent. */}
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{location}</div>
      <Line label={billLabel ?? (payment ? "Receipt No" : "Bill No")} value={billNo} />
      <Line label="Date" value={at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
      {payment?.cashier && <Line label="Cashier" value={payment.cashier} />}
      {credit && <Line label="Credit ID" value={credit.credit_number} />}
      {credit && <Line label="Customer" value={credit.customer_name} />}
      {hasCustomer && (
        <>
          {customer!.name && <Line label="Customer" value={customer!.name} />}
          {customer!.phone && <Line label="Phone" value={customer!.phone} />}
          {customer!.address && (
            <div style={{ fontSize: 11, marginTop: 2 }}>{customer!.address}</div>
          )}
        </>
      )}
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
            <span style={{ flex: 1, overflowWrap: "anywhere" }}>{it.item_name}</span>
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
      {discount > 0 && <Line label="Discount" value={`- ${rupee(discount)}`} />}
      <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
      <Line label={discount > 0 ? "TOTAL PAYABLE" : "GRAND TOTAL"} value={rupee(grandTotal)} bold />
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
      <PoweredBy />
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
      <PoweredBy />
    </>
  );
}
