"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionDetail, OrderItemRow, OrderTicketRow } from "@/app/actions/pos";
import { generateOrderTicket } from "@/app/actions/pos";
import { Printer, Receipt, RotateCcw } from "lucide-react";
import {
  PrintModal,
  BillTicket,
  Divider,
  Line,
  ticketNumber,
} from "@/app/(employee)/employee/_components/bill-ticket";
import type { RestaurantInfo, BillItem } from "@/app/(employee)/employee/_components/bill-ticket";
import { ticketCodeOf } from "@/lib/workstations/ticket-code";
import { formatBillNumber, billNumberLabel } from "@/lib/billing/bill-number";
import { formatOtNumber } from "@/lib/billing/ot-number";

// Re-export so existing imports (`./print-tickets`) keep working.
export type { RestaurantInfo } from "@/app/(employee)/employee/_components/bill-ticket";

// The minimum a ticket needs to know about a station: its id/name (to match an order
// item), its printed-docket code, and its colour (the button's dot).
export type PrintStation = {
  id: string;
  name: string;
  ticket_code: string | null;
  display_color?: string | null;
};

// A resolved docket: one station (real or the "unassigned" fallback) and the items for
// it that have NOT yet been sent. `items` is therefore what the NEXT ticket would carry.
type Docket = { key: string; name: string; code: string; color: string | null; items: OrderItemRow[] };

// What the server issued when Print was pressed: the ticket, and the items it actually
// stamped. The paper renders from THIS, never from the preview's guess — if another
// device changed the table in between, the record wins.
type Issued = { ticket: OrderTicketRow; items: OrderItemRow[] };

// The key used for items that belong to no workstation at all.
const NO_STATION = "__none";

// ── helpers ───────────────────────────────────────────────────────────────────

function locationLabel(session: SessionDetail): string {
  if (session.table_number) return `Table ${session.table_number}`;
  if (session.room_number) return `Room ${session.room_number}`;
  if (session.type === "walk_in") return "Walk-in";
  return "—";
}

/**
 * Where an ALREADY-ISSUED ticket says it went.
 *
 * A session can be shifted to another table (transfer_session), and a reprint has to
 * show where the paper actually went — not where the party sits now. `location_label` is
 * stamped at transfer time, so it is null on every ticket whose session has not moved:
 * that is the normal case, and the live label is then the correct answer.
 */
function issuedLocationLabel(ticket: OrderTicketRow, session: SessionDetail): string {
  if (!ticket.location_label) return locationLabel(session);
  // A transfer is always same-kind (table→table, room→room), so the session's kind still
  // tells us how to word the frozen label.
  return session.room_id ? `Room ${ticket.location_label}` : `Table ${ticket.location_label}`;
}

// The order's ONE sequential number — the same on the KOT, the BOT, every other
// workstation ticket, and the customer bill. Null when the restaurant hasn't configured
// numbering, in which case each document falls back to its own derived reference.
function resolveOrderNumber(
  session: SessionDetail,
  restaurant: RestaurantInfo
): { label: string; value: string } | null {
  if (session.bill_number == null) return null;
  return {
    label: billNumberLabel(restaurant.bill_number_label),
    value: formatBillNumber(session.bill_number, restaurant.bill_number_pad ?? 0),
  };
}

/**
 * Split items into ONE docket per workstation.
 *
 * Each item is matched to its station by the live `workstation_id` (survives a rename),
 * falling back to the snapshot `workstation_name` (survives the station being deleted),
 * falling back to a single "Order" docket for items with no station at all. Dockets come
 * back in the station's configured sort order, with the unassigned one (if any) last —
 * so the Print buttons read the same top-to-bottom as the stations on the admin screen.
 *
 * This is the ONLY place items are routed to a ticket, so no two dockets can disagree
 * about where an item belongs.
 */
function splitDockets(items: OrderItemRow[], workstations: PrintStation[]): Docket[] {
  const byId = new Map<string, PrintStation>();
  const byName = new Map<string, PrintStation>();
  for (const w of workstations) {
    byId.set(w.id, w);
    byName.set(w.name.trim().toLowerCase(), w);
  }

  const stationFor = (it: OrderItemRow): PrintStation | null => {
    if (it.workstation_id && byId.has(it.workstation_id)) return byId.get(it.workstation_id)!;
    const nm = it.workstation_name?.trim().toLowerCase();
    if (nm && byName.has(nm)) return byName.get(nm)!;
    return null;
  };

  const buckets = new Map<string, Docket>();
  for (const it of items) {
    const st = stationFor(it);
    const key = st ? st.id : NO_STATION;
    if (!buckets.has(key)) {
      buckets.set(
        key,
        st
          ? { key, name: st.name, code: ticketCodeOf(st), color: st.display_color ?? null, items: [] }
          : { key, name: it.workstation_name || "General", code: "OT", color: null, items: [] }
      );
    }
    buckets.get(key)!.items.push(it);
  }

  // Configured station order first, then any unassigned bucket.
  const order = new Map(workstations.map((w, i) => [w.id, i]));
  return [...buckets.values()].sort((a, b) => {
    const ai = order.has(a.key) ? order.get(a.key)! : Number.MAX_SAFE_INTEGER;
    const bi = order.has(b.key) ? order.get(b.key)! : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}

/** The code printed on a ticket's header and number line ("KOT", "BOT", …). */
function codeOfTicket(t: OrderTicketRow, stations: PrintStation[]): string {
  if (t.prefix) return t.prefix.toUpperCase();
  const st = stations.find((s) => s.id === t.workstation_id);
  return st ? ticketCodeOf(st) : "OT";
}

// ── One production docket — a single workstation's items, no pricing ────────────

function StationTicket({
  session,
  restaurant,
  staffName,
  at,
  name,
  items,
  number,
  location,
}: {
  session: SessionDetail;
  restaurant: RestaurantInfo;
  staffName: string;
  at: Date;
  /** Station name for the header ("KITCHEN ORDER TICKET"). */
  name: string;
  items: OrderItemRow[];
  /** The number line. Rendered as-is so the caller decides pending vs issued. */
  number: { label: string; value: string };
  /** Where the paper is for. Defaults to where the session is NOW; a reprint passes the
   *  label frozen on the ticket, so an old KOT keeps saying the table it was cooked for. */
  location?: string;
}) {
  return (
    <>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{restaurant.name}</div>
        <div style={{ fontWeight: 700, letterSpacing: 1, marginTop: 2 }}>
          {name.toUpperCase()} ORDER TICKET
        </div>
      </div>
      <Divider />
      {/* The table/room number is what a runner reads first — make it big. */}
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 20, margin: "2px 0 6px" }}>
        {location ?? locationLabel(session)}
      </div>
      {/* Walk-in customer — the kitchen/delivery needs the name + phone on a takeaway. */}
      {(session.customer_name || session.customer_phone) && (
        <div style={{ textAlign: "center", fontSize: 12, marginBottom: 4 }}>
          {session.customer_name}
          {session.customer_name && session.customer_phone ? " · " : ""}
          {session.customer_phone}
        </div>
      )}
      <Line label={number.label} value={number.value} />
      <Line label="Date" value={at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
      {staffName && <Line label="Staff" value={staffName} />}
      <Divider />

      {items.length === 0 ? (
        <div style={{ textAlign: "center" }}>No items.</div>
      ) : (
        items.map((it) => (
          <div key={it.id} style={{ marginTop: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontWeight: 700, minWidth: 28, fontSize: 15 }}>{it.quantity}×</span>
              <span style={{ flex: 1, overflowWrap: "anywhere" }}>{it.item_name}</span>
            </div>
            {it.notes && <div style={{ paddingLeft: 36, fontStyle: "italic", overflowWrap: "anywhere" }}>↳ {it.notes}</div>}
          </div>
        ))
      )}

      <Divider />
      <div style={{ textAlign: "center", fontSize: 11 }}>
        Total items: {items.reduce((s, i) => s + i.quantity, 0)}
      </div>
    </>
  );
}

// ── public: buttons that open the previews ─────────────────────────────────────

export function SessionPrintButtons({
  session,
  restaurant,
  staffName,
  workstations,
  canPrintTickets,
  canPrintBill,
}: {
  session: SessionDetail;
  restaurant: RestaurantInfo;
  staffName: string;
  /** The restaurant's stations, so each item lands on its OWN workstation ticket. */
  workstations: PrintStation[];
  /** Ticket generation — a billing/order-management action (Cashier/Receptionist), NOT any waiter. */
  canPrintTickets: boolean;
  canPrintBill: boolean;
}) {
  const router = useRouter();
  // Which docket's preview is open (station key), or "bill", or a `reprint:<id>`, or null.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Freeze the ticket's date/number for the life of a preview.
  const [at, setAt] = useState<Date>(() => new Date());
  // Tickets committed during this mount, by docket key. Presence means "already sent" —
  // pressing Print again re-prints the same paper instead of issuing a second ticket.
  const [issued, setIssued] = useState<Record<string, Issued>>({});
  // A ticket was issued, so the server's view of the session is stale. Refreshing is
  // deferred to modal close: doing it mid-print would re-render the docket list out from
  // under the open preview.
  const [stale, setStale] = useState(false);

  const paperWidthMm = restaurant.paper_width_mm ?? 80;

  // The order's shared number — used identically on every workstation ticket and the bill.
  const orderNo = resolveOrderNumber(session, restaurant);

  // ONLY items that have never been sent are eligible for a new ticket. This one filter
  // is the fix for the reprint bug: previously every live item was routed onto every OT,
  // so adding one dish reprinted the whole table.
  const dockets = useMemo(
    () => splitDockets(session.items.filter((i) => !i.ticket_id), workstations),
    [session.items, workstations]
  );

  // Stations that have nothing new but HAVE printed before still get a (disabled) button,
  // so a station never silently disappears from the row between orders.
  const rows = useMemo(() => {
    const byKey = new Map(dockets.map((d) => [d.key, d]));
    for (const t of session.tickets) {
      const key = t.workstation_id ?? NO_STATION;
      if (byKey.has(key)) continue;
      const st = workstations.find((w) => w.id === t.workstation_id);
      byKey.set(key, {
        key,
        name: st?.name ?? t.workstation_name ?? "General",
        code: codeOfTicket(t, workstations),
        color: st?.display_color ?? null,
        items: [],
      });
    }
    const order = new Map(workstations.map((w, i) => [w.id, i]));
    return [...byKey.values()].sort((a, b) => {
      const ai = order.has(a.key) ? order.get(a.key)! : Number.MAX_SAFE_INTEGER;
      const bi = order.has(b.key) ? order.get(b.key)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [dockets, session.tickets, workstations]);

  const showTickets = canPrintTickets && rows.length > 0;
  if (!showTickets && !canPrintBill) return null;

  const billItems: BillItem[] = session.items.map((it) => ({
    id: it.id,
    item_name: it.item_name,
    item_price: Number(it.item_price),
    quantity: it.quantity,
  }));

  const openPreview = (key: string) => {
    setAt(new Date());
    // A fresh preview for a station must not inherit the previous batch's ticket.
    setIssued((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setOpenKey(key);
  };

  const close = () => {
    setOpenKey(null);
    // Pull the new ticket_id stamps (and the reprint list) now that no preview is open.
    if (stale) {
      setStale(false);
      router.refresh();
    }
  };

  /**
   * Commit the ticket at the moment Print is pressed — not when the preview opened, so
   * an idly-opened preview costs nothing and burns no number.
   */
  const commit = (d: Docket) => async (): Promise<{ ok: true } | { ok: false; error?: string }> => {
    if (issued[d.key]) return { ok: true }; // already sent; this press is a re-print
    const res = await generateOrderTicket(
      session.id,
      d.key === NO_STATION ? null : d.key,
      d.items.map((i) => i.id)
    );
    if ("error" in res) return { ok: false, error: res.error };
    setIssued((prev) => ({ ...prev, [d.key]: { ticket: res.ticket, items: res.items } }));
    setStale(true);
    return { ok: true };
  };

  // The number line: pending until the ticket exists, then this station's own OT number,
  // falling back to the order's shared number when OT numbering is switched off.
  const numberLine = (code: string, t: OrderTicketRow | null): { label: string; value: string } => {
    if (!t) return { label: `${code} No`, value: "— pending —" };
    const prefix = (t.prefix || code).toUpperCase();
    if (t.ot_number != null) return { label: `${prefix} No`, value: formatOtNumber(prefix, t.ot_number) };
    if (orderNo) return orderNo;
    return { label: `${prefix} No`, value: ticketNumber(prefix, session.id, at) };
  };

  const btn = "w-full rounded-xl border py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-45";
  const btnStyle = { borderColor: "var(--color-hairline)", background: "var(--color-canvas)", color: "var(--color-ink)" };

  // Items belonging to an already-printed ticket, for the reprint previews.
  const itemsOfTicket = (id: string) => session.items.filter((i) => i.ticket_id === id);
  const reprintTicket = openKey?.startsWith("reprint:")
    ? session.tickets.find((t) => t.id === openKey.slice("reprint:".length)) ?? null
    : null;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {showTickets &&
          rows.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => openPreview(d.key)}
              disabled={d.items.length === 0}
              className={btn}
              style={btnStyle}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: d.color ?? "var(--color-ink-mute)" }}
              />
              <Printer size={15} /> Print {d.code}
              <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                · {d.items.length} new
              </span>
            </button>
          ))}
        {canPrintBill && (
          <button type="button" onClick={() => openPreview("bill")} className={btn} style={btnStyle}>
            <Receipt size={15} /> Print Bill
          </button>
        )}
      </div>

      {/* Reprint history. A ticket already sent to a station can be re-printed as often
          as the paper jams demand — same number, same items, nothing re-issued. */}
      {showTickets && session.tickets.length > 0 && (
        <div className="mt-2 rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
          <p className="px-3 py-1.5 text-xs" style={{ color: "var(--color-ink-mute)", background: "var(--color-canvas-soft)" }}>
            Tickets sent
          </p>
          {session.tickets.map((t) => {
            const code = codeOfTicket(t, workstations);
            const n = itemsOfTicket(t.id).length;
            return (
              <div
                key={t.id}
                className="flex items-center justify-between px-3 py-2 border-t text-sm"
                style={{ borderColor: "var(--color-hairline)" }}
              >
                <span style={{ color: "var(--color-ink)" }}>
                  {t.ot_number != null ? formatOtNumber(code, t.ot_number) : code}
                  <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                    {" · "}{n} item{n === 1 ? "" : "s"}
                    {" · "}
                    {new Date(t.printed_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => openPreview(`reprint:${t.id}`)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border"
                  style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
                >
                  <RotateCcw size={12} /> Reprint
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showTickets &&
        rows.map((d) => {
          const sent = issued[d.key] ?? null;
          const items = sent ? sent.items : d.items;
          return (
            <PrintModal
              key={d.key}
              open={openKey === d.key}
              onClose={close}
              title={`${d.name} — ${d.code} preview`}
              paperWidthMm={paperWidthMm}
              onBeforePrint={commit(d)}
              printLabel={sent ? "Print again" : "Print & send"}
            >
              <StationTicket
                session={session}
                restaurant={restaurant}
                staffName={staffName}
                // Once issued, the paper carries the time the ticket was RECORDED, so the
                // printout and the audit row can never disagree.
                at={sent ? new Date(sent.ticket.printed_at) : at}
                name={d.name}
                items={items}
                number={numberLine(d.code, sent?.ticket ?? null)}
                location={sent ? issuedLocationLabel(sent.ticket, session) : undefined}
              />
            </PrintModal>
          );
        })}

      {reprintTicket && (
        <PrintModal
          open
          onClose={close}
          title={`${codeOfTicket(reprintTicket, workstations)} — reprint`}
          paperWidthMm={paperWidthMm}
          printLabel="Print again"
        >
          <StationTicket
            session={session}
            restaurant={restaurant}
            staffName={staffName}
            at={new Date(reprintTicket.printed_at)}
            name={
              workstations.find((w) => w.id === reprintTicket.workstation_id)?.name ??
              reprintTicket.workstation_name ??
              "General"
            }
            items={itemsOfTicket(reprintTicket.id)}
            number={numberLine(codeOfTicket(reprintTicket, workstations), reprintTicket)}
            location={issuedLocationLabel(reprintTicket, session)}
          />
        </PrintModal>
      )}

      {canPrintBill && (
        <PrintModal open={openKey === "bill"} onClose={close} title="Bill — preview" paperWidthMm={paperWidthMm}>
          <BillTicket
            restaurant={restaurant}
            billNo={orderNo ? orderNo.value : ticketNumber("BILL", session.id, at)}
            billLabel={orderNo ? orderNo.label : undefined}
            location={locationLabel(session)}
            at={at}
            items={billItems}
            customer={
              session.type === "walk_in"
                ? { name: session.customer_name, phone: session.customer_phone, address: session.customer_address }
                : null
            }
          />
        </PrintModal>
      )}
    </>
  );
}
