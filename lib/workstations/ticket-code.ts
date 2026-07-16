// The short code that names a workstation's printed docket: Kitchen → KOT, Bar → BOT,
// Bakery → BAOT, Grill → GOT, Coffee → COT, and so on for any station a restaurant
// creates. There is no fixed list — the code comes from the workstation itself.
//
// This one module is the single source of truth so the code an admin SEES on the
// Workstations screen is exactly the code that PRINTS on the ticket. Both the admin UI
// and the cashier's print buttons call `ticketCodeOf`.

// The auto default: first A–Z letter of the name, uppercased, + "OT".
//   "Kitchen" → "KOT", "Bar" → "BOT", "Coffee" → "COT".
// Bar→B and Bakery→B collide, which is why a station can store an explicit override
// (Bakery → "BAOT"); the auto value is only the fallback.
export function defaultTicketCode(name: string): string {
  const first = (name || "").toUpperCase().replace(/[^A-Z]/g, "").charAt(0);
  return `${first || "X"}OT`;
}

// The code to actually use: the admin's explicit `ticket_code` if set, else the auto
// default derived from the name. Normalised to A–Z0–9, uppercase.
export function ticketCodeOf(w: { name: string; ticket_code?: string | null }): string {
  const explicit = (w.ticket_code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return explicit || defaultTicketCode(w.name);
}
