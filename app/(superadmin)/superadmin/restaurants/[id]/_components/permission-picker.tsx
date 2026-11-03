"use client";

import { ACCESS_SECTIONS, applyLevel, detectLevel } from "@/lib/permissions";
import type { AccessSection } from "@/lib/permissions";
import { hasRooms, type BusinessType } from "@/lib/business-type";

/**
 * One row per section of the app: pick a level, then any extras. Replaces a wall of
 * 33 checkboxes where several did nothing and whole sections (Sales, Credits) were
 * switched on by permissions with unrelated names. See ACCESS_SECTIONS.
 *
 * Emits the same flat permission list as before, so saving and enforcement are
 * unchanged. A section whose stored keys match no level shows "Custom" and is left
 * exactly as it is until someone picks a level for it.
 */
export function PermissionPicker({
  selected,
  onChange,
  businessType,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  /** When set, hides sections the business type doesn't have (Rooms for a
   *  restaurant-only client). Omitted ⇒ all sections shown. */
  businessType?: BusinessType;
}) {
  const sections =
    businessType && !hasRooms(businessType)
      ? ACCESS_SECTIONS.filter((s) => !s.roomsOnly)
      : ACCESS_SECTIONS;

  return (
    <div className="flex flex-col gap-4">
      <Area title="Front of house" sections={sections.filter((s) => s.area === "front")} selected={selected} onChange={onChange} />
      <Area title="Back office" sections={sections.filter((s) => s.area === "back")} selected={selected} onChange={onChange} />
    </div>
  );
}

function Area({
  title,
  sections,
  selected,
  onChange,
}: {
  title: string;
  sections: AccessSection[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <p
        className="text-xs uppercase font-medium mb-1"
        style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
      >
        {title}
      </p>
      <div
        className="rounded-lg border divide-y"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        {sections.map((s) => (
          <SectionRow key={s.key} section={s} selected={selected} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

function SectionRow({
  section,
  selected,
  onChange,
}: {
  section: AccessSection;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const current = detectLevel(section, selected);
  const level = section.levels.find((l) => l.key === current);
  const on = current !== "none";
  // Extras show once the section is on — or when one is already granted, so a stored
  // grant is never invisible.
  const extras = (section.extras ?? []).filter((e) => on || selected.includes(e.key));

  function toggleExtra(key: string) {
    onChange(selected.includes(key) ? selected.filter((p) => p !== key) : [...selected, key]);
  }

  return (
    <div className="px-3 py-2.5" style={{ borderColor: "var(--color-hairline)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className="text-sm font-medium w-28 shrink-0"
          style={{ color: on ? "var(--color-ink)" : "var(--color-ink-mute)" }}
        >
          {section.label}
        </span>

        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`${section.label} access`}>
          {section.levels.map((l) => {
            const active = current === l.key;
            return (
              <button
                key={l.key}
                type="button"
                role="radio"
                aria-checked={active}
                title={l.hint}
                onClick={() => onChange(applyLevel(selected, section, l.key))}
                className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                style={{
                  borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                  background: active ? "var(--color-primary)" : "var(--color-canvas)",
                  color: active ? "#fff" : "var(--color-ink)",
                }}
              >
                {l.label}
              </button>
            );
          })}
          {current === "custom" && (
            <span
              className="text-xs px-2.5 py-1 rounded-full border"
              style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
            >
              Custom
            </span>
          )}
        </div>
      </div>

      <p className="text-xs mt-1 sm:pl-[124px]" style={{ color: "var(--color-ink-mute)" }}>
        {current === "custom"
          ? "Set by hand before this editor existed. Pick a level to replace it."
          : level?.hint}
      </p>

      {extras.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 sm:pl-[124px]">
          {extras.map((e) => {
            const checked = selected.includes(e.key);
            return (
              <label key={e.key} className="flex items-center gap-1.5 cursor-pointer" title={e.hint}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => toggleExtra(e.key)}
                />
                <span
                  className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
                  style={{
                    borderColor: checked ? "var(--color-primary)" : "var(--color-hairline-input)",
                    background: checked ? "var(--color-primary)" : "transparent",
                  }}
                >
                  {checked && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M1 4l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="text-xs" style={{ color: "var(--color-ink)" }}>
                  {e.label}
                  <span style={{ color: "var(--color-ink-mute)" }}> — {e.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
