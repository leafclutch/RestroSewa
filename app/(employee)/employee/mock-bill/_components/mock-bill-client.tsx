"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { SecurityPinDialog } from "@/components/security-pin-dialog";
import { unlockMockBill } from "@/app/actions/mock-bill";
import type { MockBillSeed } from "@/lib/mock-bill/draft";
import { MockBillEditor } from "./mock-bill-editor";

/**
 * The locked shell.
 *
 * `unlocked` starts false and the ONLY thing that flips it is a successful server call.
 * The editor is not hidden behind a CSS class or a route guard that could be side-stepped —
 * it is simply not mounted, and its props do not exist, until the PIN has been verified
 * against the bcrypt hash in the database and the attempt has been written to
 * `security_audit_log`.
 *
 * Closing the dialog without unlocking goes back to the dashboard rather than leaving a
 * dead page on screen.
 */
export function MockBillClient({ seed, staffName }: { seed: MockBillSeed; staffName: string }) {
  const [unlocked, setUnlocked] = useState(false);
  const router = useRouter();

  if (unlocked) return <MockBillEditor seed={seed} staffName={staffName} />;

  return (
    <>
      {/* Something deliberate to look at behind the dialog, so the page doesn't read as
          broken while the PIN is being typed. */}
      <div className="max-w-md mx-auto px-4 py-16 text-center flex flex-col items-center gap-3">
        <span
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
        >
          <ShieldAlert size={22} strokeWidth={1.7} />
        </span>
        <p className="text-base font-medium" style={{ color: "var(--color-ink)" }}>
          Mock billing
        </p>
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
          This workspace is protected by the Security PIN.
        </p>
      </div>

      <SecurityPinDialog
        open
        onClose={() => router.push("/employee/dashboard")}
        onSuccess={() => setUnlocked(true)}
        title="Mock billing"
        description="Enter the Security PIN to open the mock bill workspace."
        confirmLabel="Unlock"
        onConfirm={async (pin) => {
          const res = await unlockMockBill(pin);
          if ("error" in res) return { error: res.error };
          return { ok: true };
        }}
      />
    </>
  );
}
