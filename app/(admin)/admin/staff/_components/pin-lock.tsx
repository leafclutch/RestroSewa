"use client";

import { useState, useTransition } from "react";
import { Lock, LockOpen } from "lucide-react";
import { unlockStaffPin } from "@/app/actions/staff";

/**
 * A staff member's wrong-PIN lockout, on their card on the Staff page, with the manager's
 * way out of it. Shown only while there is something to say: locked (with the time left
 * and an Unlock button), or a few wrong tries already counted (Reset, so a slip doesn't
 * linger towards a lockout). Nothing at all for a clean account.
 */
export function PinLock({
  staffId,
  restaurantId,
  lockedMinutes,
  failedAttempts,
  canUnlock,
}: {
  staffId: string;
  restaurantId: string;
  /** Minutes left on the lock; 0 = not locked. Worked out on the server. */
  lockedMinutes: number;
  failedAttempts: number;
  /** Restaurant admins only — the action re-checks this. */
  canUnlock: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const locked = lockedMinutes > 0 && !done;
  if ((!locked && (failedAttempts === 0 || done)) || (!locked && !canUnlock)) {
    return done ? (
      <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium" style={{ color: "#1a7a4a" }}>
        <LockOpen size={12} /> PIN unlocked — they can sign in now
      </p>
    ) : null;
  }

  const unlock = () =>
    start(async () => {
      setError(null);
      const res = await unlockStaffPin(staffId, restaurantId);
      if (res && "error" in res) setError(res.error);
      else setDone(true);
    });

  return (
    <div
      className="mt-2 rounded-lg border px-2.5 py-2 flex flex-wrap items-center gap-x-2 gap-y-1.5"
      style={
        locked
          ? { borderColor: "color-mix(in srgb, var(--color-ruby) 35%, transparent)", background: "color-mix(in srgb, var(--color-ruby) 7%, var(--color-canvas))" }
          : { borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }
      }
    >
      <span
        className="inline-flex items-center gap-1 text-xs font-semibold flex-1 min-w-0"
        style={{ color: locked ? "var(--color-ruby)" : "var(--color-ink-mute)" }}
      >
        <Lock size={12} className="shrink-0" />
        {locked
          ? `PIN locked · ${lockedMinutes} min left`
          : `${failedAttempts} wrong PIN ${failedAttempts === 1 ? "try" : "tries"} of 5`}
      </span>
      {canUnlock && (
        <button
          type="button"
          onClick={unlock}
          disabled={pending}
          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md disabled:opacity-50"
          style={
            locked
              ? { background: "var(--color-ruby)", color: "#fff" }
              : { border: "1px solid var(--color-hairline-input)", color: "var(--color-ink)", background: "var(--color-canvas)" }
          }
        >
          <LockOpen size={12} />
          {pending ? "…" : locked ? "Unlock" : "Reset"}
        </button>
      )}
      {error && (
        <p className="w-full text-xs" style={{ color: "var(--color-ruby)" }}>{error}</p>
      )}
    </div>
  );
}
