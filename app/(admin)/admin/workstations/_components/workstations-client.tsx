"use client";

import { useActionState, useTransition, useState, useEffect } from "react";
import {
  createWorkstation,
  updateWorkstation,
  toggleWorkstationStatus,
  deleteWorkstation,
} from "@/app/actions/workstations";
import type { ActionResult, WorkstationRow } from "@/app/actions/workstations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2 } from "lucide-react";

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#6366f1", "#a855f7", "#ec4899",
  "#64748b",
];

function WorkstationCard({
  w,
  restaurantId,
}: {
  w: WorkstationRow;
  restaurantId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [, startToggle] = useTransition();
  const [, startDelete] = useTransition();
  const [editState, editAction, editPending] = useActionState<ActionResult, FormData>(
    updateWorkstation,
    null
  );
  const [editSubmitted, setEditSubmitted] = useState(false);

  useEffect(() => { if (editPending) setEditSubmitted(true); }, [editPending]);
  useEffect(() => {
    if (editSubmitted && !editPending && editState === null) {
      setEditSubmitted(false);
      setEditing(false);
    }
  }, [editSubmitted, editPending, editState]);

  const currentColor = w.display_color ?? "#64748b";

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        background: "var(--color-canvas)",
        borderColor: editing ? "var(--color-primary)" : "var(--color-hairline)",
        borderWidth: editing ? 1.5 : 1,
      }}
    >
      {/* Row */}
      <div className="flex items-center gap-4 px-4 py-3">
        <div
          className="w-3.5 h-3.5 rounded-full shrink-0"
          style={{ background: currentColor }}
        />

        <p
          className="flex-1 text-sm"
          style={{
            color: "var(--color-ink)",
            textDecoration: w.is_active ? "none" : "line-through",
            opacity: w.is_active ? 1 : 0.5,
          }}
        >
          {w.name}
        </p>

        <button
          type="button"
          className="text-xs px-2 py-1 rounded-md border"
          style={{
            color: w.is_active ? "#1a7a4a" : "var(--color-ink-mute)",
            borderColor: w.is_active ? "#1a7a4a44" : "var(--color-hairline)",
            background: w.is_active ? "#f0fdf4" : "transparent",
          }}
          onClick={() =>
            startToggle(async () => {
              await toggleWorkstationStatus(w.id, !w.is_active);
            })
          }
        >
          {w.is_active ? "Active" : "Inactive"}
        </button>

        <button
          type="button"
          style={{ color: editing ? "var(--color-primary)" : "var(--color-ink-mute)" }}
          onClick={() => setEditing((e) => !e)}
        >
          <Pencil size={14} />
        </button>

        <button
          type="button"
          className="p-1.5 rounded-md"
          style={{ color: "var(--color-ink-mute)" }}
          onClick={() =>
            startDelete(async () => {
              const result = await deleteWorkstation(w.id);
              if (result?.error) alert(result.error);
            })
          }
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Inline edit panel */}
      {editing && (
        <form
          action={editAction}
          className="px-4 pb-4 pt-2 flex flex-col gap-3 border-t"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <input type="hidden" name="id" value={w.id} />
          <div className="flex gap-2 items-center">
            <Input name="name" defaultValue={w.name} required className="flex-1" />
            <Button type="submit" variant="primary" disabled={editPending} className="text-xs px-3 h-9">
              {editPending ? "…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(false)}
              className="text-xs px-3 h-9"
            >
              Cancel
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Color:</span>
            <div className="flex gap-1.5">
              {PRESET_COLORS.map((c) => (
                <label key={c} className="cursor-pointer">
                  <input
                    type="radio"
                    name="display_color"
                    value={c}
                    className="sr-only"
                    defaultChecked={c === currentColor}
                  />
                  <div
                    className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: c,
                      outline: c === currentColor ? "2px solid #6366f1" : "none",
                      outlineOffset: 2,
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
          {editState?.error && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{editState.error}</p>
          )}
        </form>
      )}
    </div>
  );
}

function AddWorkstationForm({ restaurantId }: { restaurantId: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    createWorkstation,
    null
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="restaurant_id" value={restaurantId} />

      <div className="flex gap-3">
        <Input name="name" placeholder="e.g. Kitchen, Bar, Grill…" className="flex-1" required />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Color:
        </span>
        <div className="flex gap-1.5">
          {PRESET_COLORS.map((c) => (
            <label key={c} className="cursor-pointer">
              <input
                type="radio"
                name="display_color"
                value={c}
                className="sr-only"
                defaultChecked={c === "#6366f1"}
              />
              <div
                className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                style={{ background: c }}
              />
            </label>
          ))}
        </div>
      </div>

      {state?.error && (
        <p className="text-sm" style={{ color: "var(--color-ruby)" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}

export function WorkstationsClient({
  workstations,
  restaurantId,
}: {
  workstations: WorkstationRow[];
  restaurantId: string;
}) {
  return (
    <div className="flex flex-col gap-6 max-w-lg">
      {workstations.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
          No workstations yet. Add your first one below.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {workstations.map((w) => (
            <WorkstationCard key={w.id} w={w} restaurantId={restaurantId} />
          ))}
        </div>
      )}

      <div
        className="rounded-xl border px-5 py-5"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <p className="text-sm font-medium mb-3" style={{ color: "var(--color-ink)" }}>
          Add workstation
        </p>
        <AddWorkstationForm restaurantId={restaurantId} />
      </div>
    </div>
  );
}
