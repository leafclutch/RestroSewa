// Presentation for a workstation's Order-Ticket (OT) number, e.g. "KOT-00125".
//
// The prefix is the workstation's ticket code (Kitchen→KOT, Bar→BOT, …) and the number is
// its own independent counter (see the assign_workstation_ot_number trigger). Kept in one
// place so the Settings preview and the printed ticket format the same number identically.

// Zero-pad width for OT numbers — 5 digits (KOT-00125), matching the configured examples.
export const OT_PAD = 5;

/** "KOT" + 125 → "KOT-00125". */
export function formatOtNumber(prefix: string, n: number, pad: number = OT_PAD): string {
  return `${prefix}-${String(n).padStart(pad, "0")}`;
}
