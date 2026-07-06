"use client";

import { useActionState, useEffect, useState } from "react";
import { createStaffMember } from "@/app/actions/staff";
import type { ActionResult } from "@/app/actions/staff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { PermissionPicker } from "./permission-picker";

const PIN_LENGTH = 4;
const KEYPAD = ["1","2","3","4","5","6","7","8","9","","0","⌫"] as const;

function PinEntry({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className="w-8 h-8 rounded border flex items-center justify-center text-sm font-medium"
            style={{
              borderColor: i < value.length ? "var(--color-primary)" : "var(--color-hairline-input)",
              background: "var(--color-canvas-soft)",
              color: "var(--color-ink)",
            }}
          >
            {i < value.length ? "•" : ""}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {KEYPAD.map((key, i) => {
          if (key === "") return <div key={i} />;
          if (key === "⌫") {
            return (
              <button
                key={i}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(value.slice(0, -1))}
                className="col-span-2 h-8 rounded text-sm flex items-center justify-center"
                style={{ background: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
              >
                ⌫
              </button>
            );
          }
          return (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => value.length < PIN_LENGTH && onChange(value + key)}
              className="col-span-2 h-8 rounded text-sm flex items-center justify-center"
              style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
            >
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AddStaffForm({ restaurantId }: { restaurantId: string }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<"restaurant_employee" | "restaurant_admin">("restaurant_employee");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(
    createStaffMember,
    null
  );

  useEffect(() => {
    if (state && "redirectTo" in state) {
      window.location.replace(state.redirectTo);
    }
  }, [state]);

  function handleClose() {
    setOpen(false);
    setPin("");
    setRole("restaurant_employee");
    setPermissions([]);
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add staff member
      </Button>
    );
  }

  const isNavigating = !!(state && "redirectTo" in state);
  const errorMsg = state && "error" in state ? state.error : null;
  const pinValid = pin.length === PIN_LENGTH;

  return (
    <div
      className="rounded-xl border px-5 py-5 flex flex-col gap-5"
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-primary)",
        borderWidth: 1.5,
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          New staff member
        </p>
        <button type="button" onClick={handleClose} style={{ color: "var(--color-ink-mute)" }}>
          <X size={16} />
        </button>
      </div>

      <form action={dispatch} className="flex flex-col gap-5">
        <input type="hidden" name="restaurant_id" value={restaurantId} />
        <input type="hidden" name="pin" value={pin} />
        <input type="hidden" name="permissions" value={JSON.stringify(role === "restaurant_employee" ? permissions : [])} />

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="display_name"
            className="text-xs uppercase tracking-wide font-medium"
            style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
          >
            Name
          </label>
          <Input id="display_name" name="display_name" placeholder="Raj Kumar" required />
        </div>

        {/* Job Title */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="title"
            className="text-xs uppercase tracking-wide font-medium"
            style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
          >
            Job Title (optional)
          </label>
          <Input id="title" name="title" placeholder="Cashier, Waiter, Manager, Chef…" />
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Display-only — permissions are assigned independently below.
          </p>
        </div>

        {/* System Role */}
        <div className="flex flex-col gap-1.5">
          <p
            className="text-xs uppercase tracking-wide font-medium"
            style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
          >
            System Access
          </p>
          <div className="flex gap-4">
            <label
              className="flex items-center gap-2 cursor-pointer rounded-lg border px-3 py-2 flex-1 text-sm"
              style={{
                borderColor: role === "restaurant_employee" ? "var(--color-primary)" : "var(--color-hairline)",
                background: role === "restaurant_employee" ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
                color: "var(--color-ink)",
              }}
            >
              <input
                type="radio"
                name="role"
                value="restaurant_employee"
                checked={role === "restaurant_employee"}
                onChange={() => setRole("restaurant_employee")}
                className="sr-only"
              />
              <span>
                <span className="font-medium block">Staff</span>
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  Employee POS — permissions below apply
                </span>
              </span>
            </label>
            <label
              className="flex items-center gap-2 cursor-pointer rounded-lg border px-3 py-2 flex-1 text-sm"
              style={{
                borderColor: role === "restaurant_admin" ? "var(--color-primary)" : "var(--color-hairline)",
                background: role === "restaurant_admin" ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
                color: "var(--color-ink)",
              }}
            >
              <input
                type="radio"
                name="role"
                value="restaurant_admin"
                checked={role === "restaurant_admin"}
                onChange={() => setRole("restaurant_admin")}
                className="sr-only"
              />
              <span>
                <span className="font-medium block">Admin</span>
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  Full access to management dashboard
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Permissions — only for staff role */}
        {role === "restaurant_employee" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p
                className="text-xs uppercase tracking-wide font-medium"
                style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
              >
                Permissions
              </p>
              <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                {permissions.length} selected
              </span>
            </div>
            <div
              className="rounded-lg border px-4 py-4"
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
            >
              <PermissionPicker selected={permissions} onChange={setPermissions} />
            </div>
          </div>
        )}

        {/* PIN */}
        <div className="flex flex-col gap-1.5">
          <p
            className="text-xs uppercase tracking-wide font-medium"
            style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
          >
            Login PIN (4 digits)
          </p>
          <PinEntry value={pin} onChange={setPin} />
          {pin.length > 0 && !pinValid && (
            <p className="text-xs mt-1" style={{ color: "var(--color-ruby)" }}>
              PIN must be exactly 4 digits.
            </p>
          )}
        </div>

        {errorMsg && (
          <p
            className="text-sm rounded-md px-3 py-2"
            style={{ color: "var(--color-ruby)", background: "#fff0f4" }}
          >
            {errorMsg}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={!pinValid || pending || isNavigating}
        >
          {pending || isNavigating ? "Creating…" : "Create staff member"}
        </Button>
      </form>
    </div>
  );
}
