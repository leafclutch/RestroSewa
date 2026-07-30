"use client";

import { useActionState, useState } from "react";
import { updateSecurityPin, type ActionResult } from "@/app/actions/security";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldAlert, CheckCircle2, ShieldCheck, ShieldOff } from "lucide-react";

// The admin Security PIN. Its own form (and action), separate from the discount PIN: this
// is an OWNER control that authorizes editing completed money records — payments and
// purchases — and future sensitive ops (refunds, resets). It belongs to the admin and is
// not meant to be shared with staff.
//
// Write-only: hashed in the DB and never read back, so this form can only ever SET a new
// one or remove it — there is nothing to prefill.
export function SecurityPinClient({ pinSet }: { pinSet: boolean }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateSecurityPin, null);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");

  const saved = state !== null && "ok" in state;
  const errored = state !== null && "error" in state;
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  return (
    <form
      action={action}
      className="rounded-xl border px-5 py-5 max-w-lg"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
        <ShieldAlert size={15} /> Security PIN
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
        A 4-digit PIN required before editing a completed payment or purchase — and future
        sensitive actions. <strong>Without a PIN, no one can edit these records at all</strong> —
        setting one here is what turns editing on. This is the owner&apos;s PIN; keep it to
        yourself rather than sharing it with staff.
      </p>

      {/* Current state — the PIN itself can never be shown, only whether one exists. */}
      <div
        className="rounded-lg border px-4 py-2.5 mb-4 text-sm flex items-center gap-2"
        style={{
          borderColor: pinSet ? "color-mix(in srgb, var(--color-success) 27%, transparent)" : "var(--color-hairline)",
          background: pinSet ? "var(--color-success-bg)" : "var(--color-canvas-soft)",
          color: pinSet ? "var(--color-success)" : "var(--color-ink-mute)",
        }}
      >
        {pinSet ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}
        {pinSet ? "A Security PIN is set — editing is on." : "No PIN set — editing is off."}
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            {pinSet ? "New PIN" : "PIN"}
          </span>
          <Input
            name="security_pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={4}
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(digits(e.target.value))}
            className="w-32 tracking-[0.4em]"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Confirm PIN</span>
          <Input
            name="security_pin_confirm"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={4}
            placeholder="••••"
            value={confirm}
            onChange={(e) => setConfirm(digits(e.target.value))}
            className="w-32 tracking-[0.4em]"
          />
        </label>
      </div>

      {pin !== "" && confirm !== "" && pin !== confirm && (
        <p className="text-xs mt-2" style={{ color: "var(--color-ruby)" }}>The two PINs don&apos;t match.</p>
      )}

      <div className="flex items-center gap-3 mt-5 flex-wrap">
        <Button type="submit" name="clear_pin" value="0" variant="primary" disabled={pending}>
          {pending ? "Saving…" : pinSet ? "Change PIN" : "Set PIN"}
        </Button>

        {pinSet && (
          <Button type="submit" name="clear_pin" value="1" variant="secondary" disabled={pending}>
            Remove PIN (turns editing off)
          </Button>
        )}

        {saved && (
          <span className="text-sm flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
            <CheckCircle2 size={15} /> Saved
          </span>
        )}
        {errored && (
          <span className="text-sm" style={{ color: "var(--color-ruby)" }}>{(state as { error: string }).error}</span>
        )}
      </div>
    </form>
  );
}
