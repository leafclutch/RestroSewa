// Which dishes in a cart carry an allergy warning — the list the customer must answer
// "are you allergic to any of these?" for before an order is sent.
//
// Zero imports, so `node --test` can load it directly (see lib/allergy.test.ts).

export type AllergyFlag = { name: string; allergy: string };

/**
 * One entry per DISH, in cart order. A dish in the cart twice (Small + Large) is asked
 * about once, and a blank or whitespace-only note is no warning at all.
 */
export function allergyFlagsForCart(
  cartItemIds: string[],
  items: { id: string; name: string; allergy_info: string | null }[]
): AllergyFlag[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const flags: AllergyFlag[] = [];
  for (const id of cartItemIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const note = byId.get(id)?.allergy_info?.trim();
    if (note) flags.push({ name: byId.get(id)!.name, allergy: note });
  }
  return flags;
}
