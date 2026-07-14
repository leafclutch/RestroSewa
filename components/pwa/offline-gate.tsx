"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Check } from "lucide-react";
import { useOnline } from "@/lib/pwa/use-online";

/**
 * The offline policy, in one component.
 *
 * Two jobs, and the second one is the important one:
 *
 *   1. SAY SO. A persistent bar, not a toast — a toast that has faded is a staff
 *      member who no longer knows.
 *
 *   2. REFUSE TO WRITE. This is a point of sale. The single worst thing it can do
 *      offline is ACCEPT a bill, a payment or an order that never actually reached
 *      the database, because the person who tapped it walks away believing the table
 *      is settled. That is worse than a POS that plainly does not work: one leaves a
 *      staff member informed, the other leaves them wrong.
 *
 *      So every mutation is blocked at the door. Almost every write in this app is a
 *      `<form action={serverAction}>`, which means ONE capture-phase submit listener
 *      catches essentially all of them — no retrofitting a guard onto a hundred
 *      buttons, and no way for a new button to quietly opt out of the policy.
 *
 * Deliberately NOT an offline write queue. Queueing POS mutations and replaying them
 * on reconnect sounds helpful and is a trap: two devices billing the same table while
 * offline will both "succeed", and reconciling that afterwards is a genuinely hard
 * correctness problem, not a feature. Refusing is the honest answer.
 */
export function OfflineGate() {
  const online = useOnline();
  const router = useRouter();
  const [blocked, setBlocked] = useState(false);
  const [justReconnected, setJustReconnected] = useState(false);

  // The listener below is bound once and must not be re-bound on every render — so it
  // reads connectivity from a ref rather than closing over the state.
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const flashBlocked = useCallback(() => {
    setBlocked(true);
    window.setTimeout(() => setBlocked(false), 3200);
  }, []);

  useEffect(() => {
    const onSubmit = (e: Event) => {
      if (onlineRef.current) return;

      // Capture phase + stopImmediatePropagation: React's own submit handling is
      // attached at the root, so merely preventing the default is not enough — the
      // action would still be invoked. This has to stop the event before React ever
      // sees it.
      e.preventDefault();
      e.stopImmediatePropagation();
      flashBlocked();
    };

    document.addEventListener("submit", onSubmit, { capture: true });
    return () => document.removeEventListener("submit", onSubmit, { capture: true });
  }, [flashBlocked]);

  // Coming back: re-read the screen. Whatever the floor did while this device was
  // deaf, it did — the tables, the queue and the bills have all moved on.
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;

    wasOffline.current = false;
    router.refresh();

    setJustReconnected(true);
    const t = window.setTimeout(() => setJustReconnected(false), 2600);
    return () => window.clearTimeout(t);
  }, [online, router]);

  if (online && !justReconnected) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[60] pb-safe pointer-events-none"
    >
      <div
        className="mx-auto max-w-md m-3 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg"
        style={{
          background: online ? "#1a7a4a" : "#0d253d",
          color: "#fff",
        }}
      >
        {online ? (
          <>
            <Check size={16} className="shrink-0" />
            <p className="text-sm min-w-0">Back online — refreshing.</p>
          </>
        ) : (
          <>
            <CloudOff size={16} className="shrink-0" />
            <p className="text-sm min-w-0 break-words">
              {blocked
                ? "You're offline — that didn't save. Try again once you're back."
                : "You're offline. You can look, but nothing can be saved right now."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
