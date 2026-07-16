"use client";

import { useMemo, useState } from "react";
import type { SessionDetail, OrderItemRow } from "@/app/actions/pos";
import { Printer, Receipt } from "lucide-react";
import {
  PrintModal,
  BillTicket,
  Divider,
  Line,
  ticketNumber,
  shortId,
} from "@/app/(employee)/employee/_components/bill-ticket";
import type { RestaurantInfo, BillItem } from "@/app/(employee)/employee/_components/bill-ticket";
import { ticketCodeOf } from "@/lib/workstations/ticket-code";

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

// A resolved docket: one station (real or the "unassigned" fallback) and its items.
type Docket = { key: string; name: string; code: string; color: string | null; items: OrderItemRow[] };

// ── helpers ───────────────────────────────────────────────────────────────────

function locationLabel(session: SessionDetail): string {
  if (session.table_number) return `Table ${session.table_number}`;
  if (session.room_number) return `Room ${session.room_number}`;
  if (session.type === "walk_in") return "Walk-in";
  return "—";
}

function orderIds(session: SessionDetail): string[] {
  return [...new Set(session.items.map((i) => i.order_id))];
}

/**
 * Split an order into ONE docket per workstation.
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
    const key = st ? st.id : "__none";
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

// ── One production docket — a single workstation's items, no pricing ────────────

function StationTicket({
  session,
  restaurant,
  staffName,
  at,
  docket,
}: {
  session: SessionDetail;
  restaurant: RestaurantInfo;
  staffName: string;
  at: Date;
  docket: Docket;
}) {
  return (
    <>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{restaurant.name}</div>
        <div style={{ fontWeight: 700, letterSpacing: 1, marginTop: 2 }}>
          {docket.name.toUpperCase()} ORDER TICKET
        </div>
      </div>
      <Divider />
      {/* The table/room number is what a runner reads first — make it big. */}
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 20, margin: "2px 0 6px" }}>
        {locationLabel(session)}
      </div>
      <Line label={`${docket.code} No`} value={ticketNumber(docket.code, session.id, at)} />
      <Line label={orderIds(session).length > 1 ? "Orders" : "Order"} value={orderIds(session).map(shortId).join(", ") || "—"} />
      <Line label="Date" value={at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
      {staffName && <Line label="Staff" value={staffName} />}
      <Divider />

      {docket.items.length === 0 ? (
        <div style={{ textAlign: "center" }}>No items.</div>
      ) : (
        docket.items.map((it) => (
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
        Total items: {docket.items.reduce((s, i) => s + i.quantity, 0)}
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
  // Which docket's preview is open (station key), or "bill", or null.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Freeze the ticket's date/number for the life of a preview.
  const [at, setAt] = useState<Date>(() => new Date());

  const paperWidthMm = restaurant.paper_width_mm ?? 80;

  // One docket per workstation, computed once.
  const dockets = useMemo(() => splitDockets(session.items, workstations), [session.items, workstations]);

  const showTickets = canPrintTickets && dockets.length > 0;
  if (!showTickets && !canPrintBill) return null;

  const billItems: BillItem[] = session.items.map((it) => ({
    id: it.id,
    item_name: it.item_name,
    item_price: Number(it.item_price),
    quantity: it.quantity,
  }));

  const open = (key: string) => { setAt(new Date()); setOpenKey(key); };

  const btn = "w-full rounded-xl border py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors";
  const btnStyle = { borderColor: "var(--color-hairline)", background: "var(--color-canvas)", color: "var(--color-ink)" };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {showTickets &&
          dockets.map((d) => (
            <button key={d.key} type="button" onClick={() => open(d.key)} className={btn} style={btnStyle}>
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: d.color ?? "var(--color-ink-mute)" }}
              />
              <Printer size={15} /> Print {d.code}
            </button>
          ))}
        {canPrintBill && (
          <button type="button" onClick={() => open("bill")} className={btn} style={btnStyle}>
            <Receipt size={15} /> Print Bill
          </button>
        )}
      </div>

      {showTickets &&
        dockets.map((d) => (
          <PrintModal
            key={d.key}
            open={openKey === d.key}
            onClose={() => setOpenKey(null)}
            title={`${d.name} — ${d.code} preview`}
            paperWidthMm={paperWidthMm}
          >
            <StationTicket session={session} restaurant={restaurant} staffName={staffName} at={at} docket={d} />
          </PrintModal>
        ))}

      {canPrintBill && (
        <PrintModal open={openKey === "bill"} onClose={() => setOpenKey(null)} title="Bill — preview" paperWidthMm={paperWidthMm}>
          <BillTicket
            restaurant={restaurant}
            billNo={ticketNumber("BILL", session.id, at)}
            orders={orderIds(session)}
            location={locationLabel(session)}
            at={at}
            items={billItems}
          />
        </PrintModal>
      )}
    </>
  );
}
