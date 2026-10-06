/**
 * Folds identical lines into one with the quantities added up.
 *
 * Every round of ordering is its own `session_order`, so a dish ordered three times
 * from one table is three order lines in the database — and printed as three rows of
 * "1 × Momo". On paper (the bill, the KOT/BOT) that should read as ONE row, "3 × Momo".
 * The database rows stay separate on purpose (each can be cancelled on its own, and
 * each belongs to the ticket it went out on); this only changes how they're shown.
 *
 * Lines merge only when everything printed about them is the same — `keyOf` decides
 * what that is. The bill keys on name + rate + custom (so a price change between
 * rounds stays two lines, never a blended rate); a kitchen ticket also keys on the
 * note, since "no onion" on one plate must not vanish into a plain one.
 *
 * Order is kept: a merged line sits where its first occurrence was. The first line's
 * other fields (its id, used as a React key) are kept.
 */
export function mergeLines<T extends { quantity: number }>(lines: T[], keyOf: (l: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const l of lines) {
    const k = keyOf(l);
    const prev = merged.get(k);
    if (prev) merged.set(k, { ...prev, quantity: Number(prev.quantity) + Number(l.quantity) });
    else merged.set(k, { ...l, quantity: Number(l.quantity) });
  }
  return [...merged.values()];
}

/** The bill's rule: same name, same rate, same custom flag. */
export const billLineKey = (l: { item_name: string; item_price: number; is_custom?: boolean | null }) =>
  `${l.item_name}\u0000${Number(l.item_price)}\u0000${l.is_custom ? 1 : 0}`;
