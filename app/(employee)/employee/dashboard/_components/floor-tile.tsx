import { ArrowRight } from "lucide-react";

/**
 * The dashboard's table / walk-in tile, shared so the two grids read as one family:
 * icon · number · arrow on one row, a status dot under it. Busy tiles fill solid in the
 * section's fixed fill; free ones sit neutral grey. The compact session-rail tiles are
 * NOT this — they keep their own denser look.
 */
export const TILE =
  "flex flex-col justify-center gap-1 rounded-xl border-[1.5px] w-full px-2.5 py-2 text-left transition-all";
export const TILE_SHADOW = "var(--shadow-card)";
export const TILE_MIN_HEIGHT = 64;
export const TILE_FREE_STYLE = {
  background: "var(--color-canvas-soft)",
  borderColor: "var(--color-hairline-input)",
  boxShadow: TILE_SHADOW,
} as const;

export function TileTop({
  icon: Icon,
  number,
  fg,
  chip,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }>;
  number: string;
  fg: string;
  /** The arrow chip on the right. Leave it out for no arrow; an empty slot of the same
   *  size keeps the number centred either way (and leaves room for a control laid over it). */
  chip?: { background: string; color: string };
}) {
  return (
    <span className="flex items-center gap-1.5 w-full">
      <Icon size={14} strokeWidth={1.9} className="shrink-0" style={{ color: fg, opacity: 0.85 }} />
      <span className="flex-1 min-w-0 text-center text-base font-semibold truncate" style={{ color: fg }}>{number}</span>
      {chip ? (
        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={chip}>
          <ArrowRight size={13} strokeWidth={2.2} />
        </span>
      ) : (
        <span aria-hidden className="w-6 h-6 shrink-0" />
      )}
    </span>
  );
}

export function TileStatus({ label, fg, dot }: { label: string; fg: string; dot: string }) {
  return (
    <span className="flex items-center justify-center gap-1 text-[12px] truncate" style={{ color: fg }}>
      <span aria-hidden className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
      <span className="truncate">{label}</span>
    </span>
  );
}
