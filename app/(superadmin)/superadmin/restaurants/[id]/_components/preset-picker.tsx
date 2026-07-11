"use client";

import { STAFF_PRESETS } from "@/lib/permissions";

// A row of one-click job-type presets that fill the permission checkboxes.
// Applying a preset replaces the current selection; the admin can then still
// edit any individual permission below. `activeKey` (from matchPreset) marks
// the preset that exactly matches the current selection — null means custom.
export function PresetPicker({
  activeKey,
  onApply,
}: {
  activeKey: string | null;
  onApply: (permissions: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {STAFF_PRESETS.map((preset) => {
          const active = activeKey === preset.key;
          return (
            <button
              key={preset.key}
              type="button"
              title={preset.description}
              onClick={() => onApply([...preset.permissions])}
              className="text-xs px-2.5 py-1 rounded-full border transition-colors"
              style={{
                borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                background: active ? "var(--color-primary)" : "var(--color-canvas)",
                color: active ? "#fff" : "var(--color-ink)",
              }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        {activeKey
          ? "Preset applied — fine-tune individual permissions below if needed."
          : "Pick a preset to auto-fill permissions, or set them manually below."}
      </p>
    </div>
  );
}
