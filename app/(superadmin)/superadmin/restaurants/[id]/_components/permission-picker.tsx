"use client";

import { PERMISSION_GROUPS } from "@/lib/permissions";

export function PermissionPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(key: string) {
    onChange(
      selected.includes(key) ? selected.filter((p) => p !== key) : [...selected, key]
    );
  }

  function toggleGroup(keys: string[]) {
    const allOn = keys.every((k) => selected.includes(k));
    if (allOn) {
      onChange(selected.filter((p) => !keys.includes(p)));
    } else {
      const missing = keys.filter((k) => !selected.includes(k));
      onChange([...selected, ...missing]);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {PERMISSION_GROUPS.map((group) => {
        const keys = group.items.map((i) => i.key);
        const allOn  = keys.every((k) => selected.includes(k));
        const someOn = keys.some((k) => selected.includes(k));

        return (
          <div key={group.label}>
            {/* Group header */}
            <button
              type="button"
              className="flex items-center gap-2 text-xs uppercase tracking-wide font-medium mb-1.5 w-full text-left"
              style={{ color: someOn ? "var(--color-primary)" : "var(--color-ink-mute)", letterSpacing: "0.06em" }}
              onClick={() => toggleGroup(keys)}
            >
              <span
                className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
                style={{
                  borderColor: allOn ? "var(--color-primary)" : someOn ? "var(--color-primary)" : "var(--color-hairline-input)",
                  background: allOn ? "var(--color-primary)" : someOn ? "rgba(99,102,241,0.15)" : "transparent",
                }}
              >
                {allOn && (
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1 4l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {someOn && !allOn && (
                  <span style={{ width: 6, height: 1.5, background: "var(--color-primary)", display: "block" }} />
                )}
              </span>
              {group.label}
            </button>

            {/* Items */}
            <div className="flex flex-wrap gap-2 pl-5">
              {group.items.map(({ key, label }) => {
                const on = selected.includes(key);
                return (
                  <label
                    key={key}
                    className="flex items-center gap-1.5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => toggle(key)}
                    />
                    <span
                      className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
                      style={{
                        borderColor: on ? "var(--color-primary)" : "var(--color-hairline-input)",
                        background: on ? "var(--color-primary)" : "transparent",
                      }}
                    >
                      {on && (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path d="M1 4l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-ink)" }}>
                      {label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
