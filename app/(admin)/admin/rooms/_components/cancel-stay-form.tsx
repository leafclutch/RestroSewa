"use client";

import { useMemo, useState, useTransition } from "react";
import { cancelRoomStay } from "@/app/actions/rooms";
import { Button } from "@/components/ui/button";
import { TriangleAlert } from "lucide-react";

const rupee = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inputClass = "w-full h-10 rounded-lg border px-3 text-sm";
const inputStyle = {
  borderColor: "var(--color-hairline-input)",
  color: "var(--color-ink)",
  background: "var(--color-canvas)",
} as const;

export type CancelTarget = {
  stayId: string;
  roomNumber: string;
  guestName: string;
  /** The running folio total — nights + food + extras. Written off on cancellation. */
  runningTotal: number;
  nights: number;
  /** NET deposit held (refunds already netted), and how it was originally tendered. */
  advanceHeld: number;
  advanceCash: number;
  advanceOnline: number;
};

type Tender = "cash" | "online" | "mixed";

/**
 * Cancel a checked-in stay and settle the deposit.
 *
 * The one screen where money is written off, so it shows the write-off before it
 * happens: what the guest has run up, what the hotel holds, what it will keep and
 * what goes back. The refund is DERIVED (`held − keep`) rather than typed —
 * `cancel_room_stay` re-derives it server-side and raises REFUND_MISMATCH
 * otherwise, so letting someone type both would only ever produce a rejection.
 */
export function CancelStayForm({
  target,
  onDone,
}: {
  target: CancelTarget;
  onDone: () => void;
}) {
  const [keepRaw, setKeepRaw] = useState("");
  const [tender, setTender] = useState<Tender>("cash");
  const [refundCashRaw, setRefundCashRaw] = useState("");
  const [refundOnlineRaw, setRefundOnlineRaw] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const held = target.advanceHeld;
  const keep = Math.min(Math.max(parseFloat(keepRaw) || 0, 0), held);
  const refund = Math.round((held - keep) * 100) / 100;

  // Typing one half fills the other, exactly as the checkout split and
  // AdvanceFields already do. One behaviour, not a third implementation.
  function handleCash(v: string) {
    setRefundCashRaw(v);
    const n = parseFloat(v);
    setRefundOnlineRaw(
      Number.isFinite(n) && refund > 0
        ? String(Math.max(Math.round((refund - n) * 100) / 100, 0))
        : ""
    );
  }
  function handleOnline(v: string) {
    setRefundOnlineRaw(v);
    const n = parseFloat(v);
    setRefundCashRaw(
      Number.isFinite(n) && refund > 0
        ? String(Math.max(Math.round((refund - n) * 100) / 100, 0))
        : ""
    );
  }

  const split = useMemo(() => {
    if (refund <= 0.005) return { cash: 0, online: 0, ok: true };
    if (tender === "cash") return { cash: refund, online: 0, ok: true };
    if (tender === "online") return { cash: 0, online: refund, ok: true };
    const c = parseFloat(refundCashRaw) || 0;
    const o = parseFloat(refundOnlineRaw) || 0;
    return { cash: c, online: o, ok: Math.abs(c + o - refund) < 0.005 };
  }, [tender, refund, refundCashRaw, refundOnlineRaw]);

  const canSubmit = pin.trim().length > 0 && split.ok && !pending;

  function submit() {
    setError(null);
    start(async () => {
      const res = await cancelRoomStay(pin.trim(), target.stayId, {
        charge: keep,
        refundCash: split.cash,
        refundOnline: split.online,
        reason: reason.trim(),
      });
      if (res && "error" in res) setError(res.error);
      else onDone();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* What is being written off. Shown FIRST and unmissably: the guest may have
          run up nights and room service, and cancelling forgives all of it. */}
      <div
        className="rounded-lg border px-3 py-2.5 flex items-start gap-2"
        style={{
          background: "var(--color-warning-bg)",
          borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)",
        }}
      >
        <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
        <p className="text-xs" style={{ color: "var(--color-warning)" }}>
          Room {target.roomNumber} · {target.guestName} has run up{" "}
          <strong>{rupee(target.runningTotal)}</strong>
          {target.nights > 0 && ` over ${target.nights} ${target.nights === 1 ? "night" : "nights"}`}.
          Cancelling <strong>writes that off</strong> — only what you keep below is charged.
        </p>
      </div>

      {held > 0.005 ? (
        <>
          <div
            className="rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-hairline)" }}
          >
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Deposit held
            </p>
            <p className="text-lg tabular-nums" style={{ color: "var(--color-ink)" }}>
              {rupee(held)}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
              {rupee(target.advanceCash)} cash + {rupee(target.advanceOnline)} online
            </p>
          </div>

          <div>
            <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
              Keep as a cancellation charge
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max={held}
              step="0.01"
              placeholder="0.00"
              value={keepRaw}
              onChange={(e) => setKeepRaw(e.target.value)}
              className={inputClass}
              style={inputStyle}
              autoFocus
            />
            <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-mute)" }}>
              Leave blank to refund the whole deposit. What you keep is recorded as a sale — the
              money is already in your till, so nothing new moves.
            </p>
          </div>

          <div
            className="rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-hairline)" }}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-sm" style={{ color: "var(--color-ink)" }}>
                Refund to guest
              </span>
              <span className="text-lg tabular-nums" style={{ color: "var(--color-primary)" }}>
                {rupee(refund)}
              </span>
            </div>
          </div>

          {refund > 0.005 && (
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                Refund as
              </label>
              <div className="flex gap-2 flex-wrap">
                {(
                  [
                    ["cash", "Cash"],
                    ["online", "Online"],
                    ["mixed", "Cash + Online"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTender(k)}
                    className="text-sm px-3 py-1.5 rounded-full border transition-colors"
                    style={{
                      borderColor: tender === k ? "var(--color-primary)" : "var(--color-hairline)",
                      background: tender === k ? "var(--color-primary)" : "var(--color-canvas)",
                      color: tender === k ? "#fff" : "var(--color-ink)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tender === "mixed" && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="Cash"
                    value={refundCashRaw}
                    onChange={(e) => handleCash(e.target.value)}
                    className={inputClass}
                    style={inputStyle}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="Online"
                    value={refundOnlineRaw}
                    onChange={(e) => handleOnline(e.target.value)}
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
              )}

              {!split.ok && (
                <p className="text-xs mt-1.5" style={{ color: "var(--color-ruby)" }}>
                  Cash and online together must equal {rupee(refund)}.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          No deposit was taken for this stay, so there is nothing to refund or keep.
        </p>
      )}

      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Reason <span style={{ opacity: 0.7 }}>(optional)</span>
        </label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="Guest left early, double booking…"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Security PIN
        </label>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
        <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Every cancellation is recorded in Settings → Security activity, along with what was kept.
        </p>
      </div>

      {error && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Keep the stay
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={!canSubmit}>
          {pending ? "Cancelling…" : "Cancel this stay"}
        </Button>
      </div>
    </div>
  );
}
