// Turning custom (off-menu) cart lines into order rows.
//
// This is the DELIBERATE exception to lib/order-items.ts. There, the client may never set a
// price — every value is looked up from the menu. A custom item is exactly the opposite: staff
// type the name and price themselves. That is why it lives behind its own permission
// (`manage_custom_items`) and its own validated path, and is NEVER reachable from the customer
// phone flow. The name/price are still snapshot onto the row like any other item, and the row
// is flagged `is_custom` so bills, tickets and reports can mark it.

export type CustomItemRequest = {
  name: string;
  price: number;
  quantity: number;
  notes?: string | null;
  /** Optional workstation. Given → the line prints on that station's KOT/BOT; null → bill-only. */
  workstation_id?: string | null;
};

export type ResolvedCustomItem = {
  menu_item_id: null;
  variant_id: null;
  workstation_id: string | null;
  item_name: string;
  item_price: number;
  workstation_name: string | null;
  quantity: number;
  notes: string | null;
  is_custom: true;
};

export type ResolveCustomResult =
  | { ok: true; items: ResolvedCustomItem[] }
  | { ok: false; error: string };

const MAX_QTY = 99;
const MAX_NAME = 80;
const MAX_PRICE = 1_000_000;

// Validates and snapshots custom lines. An empty list is fine (an order may have none). The
// workstation, if named, is verified to belong to THIS restaurant — so a line can't be routed
// to another restaurant's station — and its name is snapshot like the menu path does.
export async function resolveCustomItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  restaurantId: string,
  lines: CustomItemRequest[]
): Promise<ResolveCustomResult> {
  if (!lines?.length) return { ok: true, items: [] };

  const wsIds = [
    ...new Set(lines.map((l) => l.workstation_id).filter((v): v is string => Boolean(v))),
  ];
  const wsName = new Map<string, string>();
  if (wsIds.length > 0) {
    const { data } = await service
      .from("workstations")
      .select("id, name")
      .eq("restaurant_id", restaurantId)
      .in("id", wsIds);
    for (const w of (data as { id: string; name: string }[]) ?? []) wsName.set(w.id, w.name);
  }

  const resolved: ResolvedCustomItem[] = [];
  for (const line of lines) {
    const name = (line.name ?? "").trim();
    if (!name) return { ok: false, error: "Every custom item needs a name." };
    if (name.length > MAX_NAME) {
      return { ok: false, error: `A custom item name can be at most ${MAX_NAME} characters.` };
    }

    const price = Number(line.price);
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, error: `Enter a valid price for "${name}".` };
    }
    if (price > MAX_PRICE) return { ok: false, error: `That price is too large for "${name}".` };

    const quantity = Math.floor(Number(line.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) return { ok: false, error: "Invalid quantity." };
    if (quantity > MAX_QTY) {
      return { ok: false, error: `You can add at most ${MAX_QTY} of an item at a time.` };
    }

    let workstationId: string | null = null;
    let workstationName: string | null = null;
    if (line.workstation_id) {
      const found = wsName.get(line.workstation_id);
      if (found === undefined) return { ok: false, error: "That workstation isn't available." };
      workstationId = line.workstation_id;
      workstationName = found;
    }

    resolved.push({
      menu_item_id: null,
      variant_id: null,
      workstation_id: workstationId,
      item_name: name,
      item_price: Math.round(price * 100) / 100, // numeric(10,2)
      workstation_name: workstationName,
      quantity,
      notes: line.notes?.trim() || null,
      is_custom: true,
    });
  }

  return { ok: true, items: resolved };
}
