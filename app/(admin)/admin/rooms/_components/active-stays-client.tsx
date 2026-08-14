"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, XCircle } from "lucide-react";
import type { ActiveStay } from "@/app/actions/rooms";
import { Modal } from "@/app/(admin)/admin/_components/modal";
import { Button } from "@/components/ui/button";
import { CancelStayForm, type CancelTarget } from "./cancel-stay-form";

const rupee = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * Checked-in guests, with a way to cancel a stay.
 *
 * Sits on `/admin/rooms` rather than on the room grid because cancelling is not a
 * room operation — it ends a GUEST's stay and settles their deposit. It is only
 * rendered for someone holding `cancel_room_stay` (the owner passes
 * automatically), and the server re-checks that plus the Security PIN.
 */
export function ActiveStaysClient({ stays }: { stays: ActiveStay[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<CancelTarget | null>(null);

  return (
    <section
      className="rounded-xl border overflow-hidden mb-6"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        <BedDouble size={15} style={{ color: "var(--color-ink-mute)" }} />
        <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          Checked-in guests
        </span>
        <span className="text-xs ml-auto" style={{ color: "var(--color-ink-mute)" }}>
          {stays.length === 0
            ? "None"
            : `${stays.length} ${stays.length === 1 ? "guest" : "guests"}`}
        </span>
      </div>

      {stays.length === 0 ? (
        <p className="px-4 py-6 text-sm text-center" style={{ color: "var(--color-ink-mute)" }}>
          Nobody is checked in right now.
        </p>
      ) : (
        stays.map((s) => (
          <div
            key={s.stay_id}
            className="flex items-start justify-between gap-3 px-4 py-3 border-t flex-wrap"
            style={{ borderColor: "var(--color-hairline)" }}
          >
            <div className="min-w-0">
              <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                Room {s.room_number} · {s.guest_name}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
                {new Date(s.check_in_at).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
                {" · "}
                {s.nights} {s.nights === 1 ? "night" : "nights"} · run up {rupee(s.runningTotal)}
                {s.advanceHeld > 0.005 && ` · deposit ${rupee(s.advanceHeld)}`}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setTarget({
                  stayId: s.stay_id,
                  roomNumber: s.room_number,
                  guestName: s.guest_name,
                  runningTotal: s.runningTotal,
                  nights: s.nights,
                  advanceHeld: s.advanceHeld,
                  advanceCash: s.advanceCash,
                  advanceOnline: s.advanceOnline,
                })
              }
            >
              <XCircle size={14} /> Cancel stay
            </Button>
          </div>
        ))
      )}

      <Modal
        open={target !== null}
        title="Cancel this stay"
        subtitle="Ends the stay without billing it, and settles the deposit"
        onClose={() => setTarget(null)}
      >
        {target && (
          <CancelStayForm
            target={target}
            onDone={() => {
              setTarget(null);
              // The stay list, the room grid and the finance figures all move.
              router.refresh();
            }}
          />
        )}
      </Modal>
    </section>
  );
}
