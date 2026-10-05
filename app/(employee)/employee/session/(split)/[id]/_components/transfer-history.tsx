import { MoveRight } from "lucide-react";
import { formatShort } from "@/lib/format-time";
import type { SessionTransferRow } from "@/app/actions/pos";

/**
 * "8:15 PM · A1 → B4 · by Cashier John" (§14).
 *
 * Renders nothing at all when the session has never moved, which is almost every
 * session — a permanently visible empty "History" heading would be noise on a screen a
 * cashier reads under time pressure.
 */
export function TransferHistory({ transfers }: { transfers: SessionTransferRow[] }) {
  if (transfers.length === 0) return null;

  const noun = (kind: string) => (kind === "room" ? "Room move" : "Table shift");

  return (
    <div
      className="rounded-xl border px-3 py-2.5 mb-4"
      style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
    >
      <p className="text-xs mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
        Moved {transfers.length === 1 ? "once" : `${transfers.length} times`}
      </p>
      <ul className="flex flex-col gap-1.5">
        {transfers.map((t) => (
          <li key={t.id} className="flex items-baseline gap-2 flex-wrap text-sm">
            <span className="tabular text-xs" style={{ color: "var(--color-ink-mute)" }}>
              {formatShort(t.created_at)}
            </span>
            <span className="inline-flex items-center gap-1" style={{ color: "var(--color-ink)" }}>
              {t.from_label}
              <MoveRight size={12} style={{ color: "var(--color-ink-mute)" }} />
              {t.to_label}
            </span>
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              {noun(t.kind)}
              {t.staff_name ? ` · ${t.staff_name}` : ""}
              {t.reason ? ` · ${t.reason}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
