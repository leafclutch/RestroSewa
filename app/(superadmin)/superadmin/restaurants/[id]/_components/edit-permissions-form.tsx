"use client";

import { useActionState, useEffect, useState } from "react";
import { updateStaffPermissions } from "@/app/actions/staff";
import type { ActionResult } from "@/app/actions/staff";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { PermissionPicker } from "./permission-picker";

export function EditPermissionsForm({
  staffId,
  staffName,
  restaurantId,
  initialPermissions,
  onClose,
}: {
  staffId: string;
  staffName: string;
  restaurantId: string;
  initialPermissions: string[];
  onClose: () => void;
}) {
  const [permissions, setPermissions] = useState<string[]>(initialPermissions);
  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(
    updateStaffPermissions,
    null
  );

  useEffect(() => {
    // null means success — close after save
    if (state === null && !pending) {
      // Guard against the initial render (state starts as null)
      return;
    }
  }, [state, pending]);

  // Close on successful update (state goes null after a successful action that returns null)
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (submitted && state === null && !pending) onClose();
  }, [submitted, state, pending, onClose]);

  useEffect(() => {
    if (pending) setSubmitted(true);
  }, [pending]);

  const errorMsg = state && "error" in state ? state.error : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-12 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl flex flex-col gap-5 px-6 py-6 mb-8"
        style={{ background: "var(--color-canvas)", boxShadow: "0 16px 48px rgba(0,0,0,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-medium" style={{ color: "var(--color-ink)" }}>
              Edit permissions
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
              {staffName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Picker */}
        <div
          className="rounded-lg border px-4 py-4"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
        >
          <PermissionPicker selected={permissions} onChange={setPermissions} />
        </div>

        {errorMsg && (
          <p
            className="text-sm rounded-md px-3 py-2"
            style={{ color: "var(--color-ruby)", background: "#fff0f4" }}
          >
            {errorMsg}
          </p>
        )}

        {/* Actions */}
        <form action={dispatch} className="flex gap-2">
          <input type="hidden" name="staff_id" value={staffId} />
          <input type="hidden" name="restaurant_id" value={restaurantId} />
          <input type="hidden" name="permissions" value={JSON.stringify(permissions)} />
          <Button type="submit" variant="primary" disabled={pending} className="flex-1">
            {pending ? "Saving…" : `Save — ${permissions.length} permission${permissions.length !== 1 ? "s" : ""}`}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </form>
      </div>
    </div>
  );
}
