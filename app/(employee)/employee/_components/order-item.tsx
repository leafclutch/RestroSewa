"use client";

import { useState, useTransition } from "react";
import { cancelOrderItem, updateOrderItemStatus } from "@/app/actions/pos";
import type { OrderItemRow } from "@/app/actions/pos";
import {
  activeQuantity,
  cancelledQuantity,
  cancellableQuantity,
  describeLine,
} from "@/lib/order-quantities";
import { Check, X } from "lucide-react";

// One order line, on a table's bill or a room's folio.
//
// Lifted out of the table's session screen so the ROOM screen renders the SAME
// control rather than a lookalike. That is the difference between "the two
// sections look consistent" and "the two sections ARE the same thing" — a change
// to how an item is served or cancelled now lands in both places at once, and
// they cannot drift apart later.

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  served: "Served",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "#f97316",
  served: "var(--color-ink-mute)",
};

export function OrderItem({
  item,
  canCancel = false,
}: {
  item: OrderItemRow;
  canCancel?: boolean;
}) {
  const [, start] = useTransition();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [qty, setQty] = useState(1);

  // One step: pending → served. There is no middle state any more.
  const nextStatus = item.item_status === "pending" ? "served" : null;

  // ⚠️ THREE COUNTS ON ONE LINE, and they are not interchangeable — see
  // lib/order-quantities.ts. Derived there rather than inline so this screen, the
  // bill and the kitchen ticket cannot drift into disagreeing about what "how many"
  // means.
  const active = activeQuantity(item);
  const cancelledQty = cancelledQuantity(item);
  const cancellableQty = cancellableQuantity(item);
  const summary = describeLine(item);
  const cancellable = canCancel && cancellableQty > 0;

  function doCancel(units: number) {
    setCancelError(null);
    setPicking(false);
    start(async () => {
      // `cancellableQty` is what THIS render believed was still cancellable. The
      // server refuses if the line moved in the meantime rather than cancelling the
      // wrong number of units — a blind retry would take more off the bill.
      const res = await cancelOrderItem(item.id, units, cancellableQty);
      if (res?.error) setCancelError(res.error);
      setQty(1);
    });
  }

  return (
    <div
      className="border-b last:border-0"
      style={{
        borderColor: "var(--color-hairline)",
        opacity: item.item_status === "served" ? 0.45 : 1,
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm" style={{ color: "var(--color-ink)" }}>
          {active > 1 && (
            <span className="font-medium mr-1" style={{ color: "var(--color-ink-mute)" }}>
              ×{active}
            </span>
          )}
          {item.item_name}
          {item.is_custom && (
            <span
              className="ml-1.5 px-1 rounded align-middle"
              style={{ fontSize: "9px", lineHeight: "14px", background: "var(--color-canvas-soft)", color: "var(--color-primary)", letterSpacing: "0.04em" }}
            >
              CUSTOM
            </span>
          )}
        </p>
        {/* Say what happened to this line, rather than showing the original count as
            if all of it were still coming. "Ordered 3 · Cancelled 1 · Remaining 2" is
            the whole point of the feature being visible at the counter. Null when the
            line is unremarkable, so an ordinary bill doesn't grow a row of noise. */}
        {summary && (
          <p
            className="text-xs mt-0.5"
            style={{ color: cancelledQty > 0 ? "#dc2626" : "var(--color-ink-mute)" }}
          >
            {summary}
          </p>
        )}
        {item.workstation_name && (
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {item.workstation_name}
          </p>
        )}
        {item.notes && (
          <p className="text-xs italic mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {item.notes}
          </p>
        )}
      </div>

      {/* The line's share of the bill — active units only, so it matches the total. */}
      <p className="text-sm tabular shrink-0" style={{ color: "var(--color-ink-mute)" }}>
        ₹{(Number(item.item_price) * active).toFixed(0)}
      </p>

      <span
        className="text-xs shrink-0 min-w-[52px] text-center"
        style={{ color: STATUS_COLOR[item.item_status] }}
      >
        {STATUS_LABEL[item.item_status]}
      </span>

      {nextStatus && (
        <button
          type="button"
          title="Mark as served"
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "var(--color-canvas-soft)" }}
          onClick={() =>
            start(async () => {
              await updateOrderItemStatus(item.id, "served");
            })
          }
        >
          <Check size={13} style={{ color: "var(--color-ink-mute)" }} />
        </button>
      )}

      {/* Cancelling takes units off the bill AND puts their stock back on the shelf,
          so it is confirmed rather than one-tap.

          A single cancellable unit keeps the old one-tap-plus-confirm flow — making
          a cashier pick "1 of 1" would be pure friction. More than one opens the
          stepper, because "cancel 1 of 3" is the case this whole feature exists for
          and it must not be reachable only by cancelling all three. */}
      {cancellable && (
        <button
          type="button"
          title={cancellableQty > 1 ? "Cancel units of this item" : "Cancel this item"}
          aria-label={`Cancel ${item.item_name}`}
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "var(--color-canvas-soft)" }}
          onClick={() => {
            if (cancellableQty > 1) {
              setQty(1);
              setPicking((p) => !p);
              return;
            }
            if (
              !confirm(
                `Cancel ${item.item_name}?\n\nIt comes off the bill and its stock goes back.`
              )
            )
              return;
            doCancel(1);
          }}
        >
          <X size={13} style={{ color: "#dc2626" }} />
        </button>
      )}

      </div>

      {/* How many units to take off. Defaults to 1 rather than "all": the common
          case is a guest changing their mind about one of several, and defaulting
          to the whole line is the behaviour this feature replaced. */}
      {picking && (
        <div
          className="flex items-center gap-2 px-4 pb-3 flex-wrap"
          style={{ color: "var(--color-ink-mute)" }}
        >
          <span className="text-xs">Cancel how many?</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="One fewer"
              className="w-6 h-6 rounded-full text-sm leading-none"
              style={{ background: "var(--color-canvas-soft)" }}
              onClick={() => setQty((n) => Math.max(1, n - 1))}
            >
              −
            </button>
            <span className="text-sm tabular min-w-[24px] text-center" style={{ color: "var(--color-ink)" }}>
              {qty}
            </span>
            <button
              type="button"
              aria-label="One more"
              className="w-6 h-6 rounded-full text-sm leading-none"
              style={{ background: "var(--color-canvas-soft)" }}
              onClick={() => setQty((n) => Math.min(cancellableQty, n + 1))}
            >
              +
            </button>
          </div>
          <span className="text-xs">of {cancellableQty}</span>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded"
            style={{ background: "var(--color-canvas-soft)" }}
            onClick={() => setQty(cancellableQty)}
          >
            All
          </button>
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded font-medium"
            style={{ background: "#dc2626", color: "#fff" }}
            onClick={() => {
              if (
                !confirm(
                  `Cancel ${qty} × ${item.item_name}?\n\n` +
                    `${
                      active - qty === 0
                        ? "The whole line comes off"
                        : `${active - qty} will still be on`
                    } the bill, and the stock for the cancelled units goes back.`
                )
              )
                return;
              doCancel(qty);
            }}
          >
            Cancel {qty}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1"
            onClick={() => setPicking(false)}
          >
            Keep
          </button>
        </div>
      )}

      {cancelError && (
        <p className="text-xs px-4 pb-3" style={{ color: "#dc2626" }}>
          {cancelError}
        </p>
      )}
    </div>
  );
}
