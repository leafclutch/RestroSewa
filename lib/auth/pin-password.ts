// Staff log in with a 4-digit PIN, but the PIN is stored as the password of a Supabase
// Auth account (`emp-<id>@restrosewa.internal`). Supabase Auth enforces a minimum
// password length — 6 by default — and rejects a bare 4-digit PIN with
// "Password should be at least 6 characters".
//
// So the PIN is never handed to Auth as-is: it goes through this fixed mapping on every
// write (create, reset) and every login. The mapping adds no secrecy — it is public in
// this file — and none is claimed; a PIN's strength is its lockout (see
// `pin_lockout_status`), not its length.
//
// ⚠️ Accounts created before this existed still hold the raw PIN. The PIN login tries
// the mapped password first and falls back to the raw PIN, upgrading the account on a
// successful legacy login (app/actions/auth.ts). Do not remove that fallback until every
// staff account has logged in at least once since this shipped.

export const AUTH_MIN_PASSWORD_LENGTH = 6;

const PREFIX = "rspin-";

export function pinToAuthPassword(pin: string): string {
  return `${PREFIX}${pin}`;
}
