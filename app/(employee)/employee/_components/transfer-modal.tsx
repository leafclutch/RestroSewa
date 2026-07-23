"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, MoveRight } from "lucide-react";
import { Modal } from "@/app/(admin)/admin/_components/modal";
import { Button } from "@/components/ui/button";
import { getTransferTargets, transferSession } from "@/app/actions/transfer";
import type { TransferTarget } from "@/app/actions/transfer";

/**
 * Move a live session to another table, or a live stay to another room.
 *
 * Two steps on purpose: pick, then confirm. Shifting a table rearranges a bill that is
 * already open and cannot be undone with a second tap, so the destination is shown back
 * to the user as "A1 → B4" before anything happens.
 *
 * PORTALED TO <body>, and that is not optional. The dashboard carries the `.rs-page`
 * entry animation; any ancestor with a `transform` becomes the containing block for
 * `position: fixed`, and the modal would anchor to THAT box instead of the viewport —
 * landing off-screen while its backdrop still dims the page. Same trap documented in
 * credits-view.tsx.
 */
export function TransferModal({
  sessionId,
  fallbackLabel,
  onClose,
  onDone,
}: {
  sessionId: string;
  /** Shown until the server tells us where this session actually is. */
  fallbackLabel: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  // createPortal needs a document, which does not exist during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [kind, setKind] = useState<"table" | "room">("table");
  const [currentLabel, setCurrentLabel] = useState(fallbackLabel);
  const [targets, setTargets] = useState<TransferTarget[] | null>(null);
  const [picked, setPicked] = useState<TransferTarget | null>(null);
  const [reason, setReason] = useState("");
  const [upgrade, setUpgrade] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getTransferTargets(sessionId).then((res) => {
      if (cancelled) return;
      if ("error" in res) {
        setError(res.error);
        setTargets([]);
        return;
      }
      setKind(res.kind);
      setCurrentLabel(res.current_label);
      setTargets(res.targets);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const noun = kind === "room" ? "room" : "table";

  const confirm = useCallback(() => {
    if (!picked) return;
    setError(null);
    startTransition(async () => {
      const amount = Number(upgrade);
      const res = await transferSession({
        sessionId,
        destTableId: kind === "table" ? picked.id : null,
        destRoomId: kind === "room" ? picked.id : null,
        reason: reason || null,
        upgradeAmount: kind === "room" && Number.isFinite(amount) && amount > 0 ? amount : null,
      });
      if ("error" in res) {
        setError(res.error);
        // Send them back to the list: the destination is usually gone, not the intent.
        setPicked(null);
        const fresh = await getTransferTargets(sessionId);
        if (!("error" in fresh)) setTargets(fresh.targets);
        return;
      }
      onDone?.();
      onClose();
    });
  }, [picked, sessionId, kind, reason, upgrade, onClose, onDone]);

  if (!mounted) return null;

  const body = (
    <Modal
      open
      onClose={pending ? () => {} : onClose}
      title={kind === "room" ? "Move room" : "Shift table"}
      subtitle={`Currently ${noun} ${currentLabel}`}
    >
      {error && (
        <p
          className="text-sm rounded-md px-3 py-2 mb-3"
          style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}
        >
          {error}
        </p>
      )}

      {targets === null ? (
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
          Loading…
        </p>
      ) : picked ? (
        <>
          {/* Step 2 — confirm. */}
          <div className="flex flex-col items-center gap-1 py-3">
            <span className="text-lg" style={{ color: "var(--color-ink-mute)" }}>
              {currentLabel}
            </span>
            <ArrowDown size={18} style={{ color: "var(--color-ink-mute)" }} />
            <span className="text-2xl font-medium" style={{ color: "var(--color-ink)" }}>
              {picked.label}
            </span>
          </div>

          <p className="text-sm text-center mb-4" style={{ color: "var(--color-ink-mute)" }}>
            The bill, orders and tickets all move with the guest. Nothing is re-charged.
          </p>

          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="w-full h-9 rounded-sm border px-3 text-sm mb-3"
            style={{
              borderColor: "var(--color-hairline-input)",
              color: "var(--color-ink)",
              background: "var(--color-canvas)",
            }}
          />

          {kind === "room" && (
            <>
              <input
                value={upgrade}
                onChange={(e) => setUpgrade(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="Upgrade charge (optional)"
                className="w-full h-9 rounded-sm border px-3 text-sm"
                style={{
                  borderColor: "var(--color-hairline-input)",
                  color: "var(--color-ink)",
                  background: "var(--color-canvas)",
                }}
              />
              {/* The nightly rate is a single snapshot on the stay, and the folio bills
                  rate × total nights — so raising it would re-bill nights already spent
                  in the old room. An upgrade is a separate line instead. */}
              <p className="text-xs mt-1.5 mb-3" style={{ color: "var(--color-ink-mute)" }}>
                The nightly rate stays as it was at check-in. Add an amount here to charge
                for the upgrade.
              </p>
            </>
          )}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setPicked(null)}
              disabled={pending}
            >
              Back
            </Button>
            <Button variant="primary" className="flex-1" onClick={confirm} disabled={pending}>
              {pending ? "Moving…" : "Confirm"}
            </Button>
          </div>
        </>
      ) : targets.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
          {error
            ? "Nothing to move to."
            : `No free ${noun}s right now. A ${noun} has to be empty and clean before a session can move onto it.`}
        </p>
      ) : (
        <>
          {/* Step 1 — pick. Buttons rather than a <select>: nothing employee-facing in
              this app uses one, and a grid of numbers reads like the floor plan. */}
          <p className="text-sm mb-3" style={{ color: "var(--color-ink-mute)" }}>
            Move this session to:
          </p>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))" }}>
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setError(null);
                  setPicked(t);
                }}
                className="rounded-xl border p-3 text-center transition-colors hover:opacity-80"
                style={{
                  borderColor: "var(--color-hairline)",
                  color: "var(--color-ink)",
                  background: "var(--color-canvas-soft)",
                }}
              >
                <span className="flex items-center justify-center gap-1 text-base">
                  <MoveRight size={13} style={{ color: "var(--color-ink-mute)" }} />
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );

  return createPortal(body, document.body);
}
