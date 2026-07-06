"use client";

import { useState, useTransition } from "react";
import { updateWorkstationAssignments } from "@/app/actions/staff";
import type { WorkstationRow } from "@/app/actions/workstations";

export function WorkstationAssign({
  staffId,
  restaurantId,
  workstations,
  initialAssigned,
}: {
  staffId: string;
  restaurantId: string;
  workstations: WorkstationRow[];
  initialAssigned: string[];
}) {
  const [assigned, setAssigned] = useState<Set<string>>(new Set(initialAssigned));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    const next = new Set(assigned);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAssigned(next);
    setError(null);

    startTransition(async () => {
      const r = await updateWorkstationAssignments(staffId, restaurantId, Array.from(next));
      if (r && "error" in r) setError(r.error);
    });
  }

  if (workstations.length === 0) {
    return (
      <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        No workstations
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        {workstations.map((w) => {
          const active = assigned.has(w.id);
          return (
            <button
              key={w.id}
              type="button"
              disabled={pending}
              onClick={() => toggle(w.id)}
              title={w.name}
              className="text-xs px-2 py-0.5 rounded-full border transition-colors"
              style={{
                background: active ? (w.display_color ?? "var(--color-primary)") + "22" : "transparent",
                borderColor: active ? (w.display_color ?? "var(--color-primary)") : "var(--color-hairline)",
                color: active ? (w.display_color ?? "var(--color-primary)") : "var(--color-ink-mute)",
                opacity: pending ? 0.6 : 1,
                cursor: pending ? "wait" : "pointer",
              }}
            >
              {w.name}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{error}</p>
      )}
    </div>
  );
}
