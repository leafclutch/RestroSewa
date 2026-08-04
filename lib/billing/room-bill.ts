// The room folio, arranged for the shared bill renderer.
//
// PURE MAPPING ONLY. Every figure here comes from `buildFolio`, which is the single room
// calculator (lib/room-billing.ts). Re-deriving so much as a subtotal in this file would be a
// second implementation of the same rule, and the two would eventually disagree — which is
// the entire reason room-billing.ts was written as pure functions in the first place.
//
// It exists because the room bill and the table bill were rendered by two different pieces of
// code, and the paid one was wrong: it rebuilt its lines from `session_order_items`, which
// holds FOOD only, so the room charge and the extras never appeared and the printed lines did
// not add up to the amount charged. One mapper, called from both the unpaid folio and the
// paid Sales bill, is what stops that happening again.
//
// `import type` is erased at runtime, which is what lets `node --test` run this file directly
// (see lib/billing/room-bill.test.ts). Keep this module erasable-syntax TypeScript: no enums,
// no parameter properties, and no value imports.

import type { RoomFolio, FolioLine } from "@/lib/room-billing";

export type BillSectionLine = {
  id: string;
  item_name: string;
  item_price: number;
  quantity: number;
};

export type BillSection = { title: string; lines: BillSectionLine[] };

export type BillStay = {
  roomType: string;
  rate: number;
  nights: number;
  checkIn: string;
  checkOut: string;
  duration: string;
};

export type RoomBillView = {
  sections: BillSection[];
  stay: BillStay;
  subtotal: number;
  discount: number;
  grandTotal: number;
};

export type RoomBillInput = { folio: RoomFolio; roomType: string };

/**
 * A folio line is already "one thing, at one amount" — the room charge is 2 nights folded
 * into a single 5,000 line, not 2 × 2,500. So quantity is 1 and the amount IS the price;
 * the qty/rate breakdown rides along inside the label, where `detail` already spells it out
 * ("2 × ₹2,500 per night"). Splitting it into qty and rate columns would re-derive money.
 */
function toLine(l: FolioLine): BillSectionLine {
  return {
    id: l.key,
    item_name: l.detail ? `${l.label} (${l.detail})` : l.label,
    item_price: l.amount,
    quantity: 1,
  };
}

export function folioToBill({ folio, roomType }: RoomBillInput): RoomBillView {
  // An empty section prints as a heading with nothing under it, which reads like a mistake
  // on paper — so a stay with no extras simply has no Extras heading.
  const sections: BillSection[] = [{ title: "Room charge", lines: [toLine(folio.room)] }];
  if (folio.extras.length > 0) {
    sections.push({ title: "Extras", lines: folio.extras.map(toLine) });
  }
  if (folio.food.length > 0) {
    sections.push({ title: "Food & beverages", lines: folio.food.map(toLine) });
  }

  return {
    sections,
    stay: {
      roomType,
      rate: folio.rate,
      nights: folio.nights,
      checkIn: folio.checkIn,
      checkOut: folio.checkOut,
      duration: folio.duration,
    },
    subtotal: folio.subtotal,
    discount: folio.discount,
    grandTotal: folio.grandTotal,
  };
}
