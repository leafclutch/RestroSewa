import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOrderItems } from "./order-items.ts";
import { resolveCustomItems } from "./custom-items.ts";

// Mock Supabase service client for order items resolution
function createMockService() {
  return {
    from(table: string) {
      if (table === "menu_items") {
        return {
          select() {
            return {
              eq() {
                return {
                  async in(_col: string, ids: string[]) {
                    const data = [
                      {
                        id: "item-momo-123",
                        name: "Chicken Momo",
                        price: 180,
                        is_available: true,
                        availability_status: "available",
                        is_deleted: false,
                        workstation_id: "ws-kitchen-1",
                        workstations: { name: "Kitchen" },
                      },
                      {
                        id: "item-coke-456",
                        name: "Coke",
                        price: 80,
                        is_available: true,
                        availability_status: "available",
                        is_deleted: false,
                        workstation_id: "ws-bar-1",
                        workstations: { name: "Bar" },
                      },
                    ].filter((item) => ids.includes(item.id));
                    return { data };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "menu_item_variants") {
        return {
          select() {
            return {
              async in() {
                return { data: [] };
              },
            };
          },
        };
      }
      if (table === "workstations") {
        return {
          select() {
            return {
              eq() {
                return {
                  async in(_col: string, ids: string[]) {
                    const data = [
                      { id: "ws-kitchen-1", name: "Kitchen" },
                      { id: "ws-bar-1", name: "Bar" },
                    ].filter((ws) => ids.includes(ws.id));
                    return { data };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("resolveOrderItems sets is_custom: false on menu items", async () => {
  const service = createMockService();
  const res = await resolveOrderItems(service, "rest-1", [
    { menu_item_id: "item-momo-123", quantity: 2, notes: "Spicy" },
  ]);

  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].item_name, "Chicken Momo");
  assert.equal(res.items[0].item_price, 180);
  assert.equal(res.items[0].quantity, 2);
  assert.equal(res.items[0].is_custom, false);
});

test("resolveCustomItems sets is_custom: true on custom items", async () => {
  const service = createMockService();
  const res = await resolveCustomItems(service, "rest-1", [
    {
      name: "Special Fried Rice",
      price: 250,
      quantity: 1,
      notes: "Less oil",
      workstation_id: "ws-kitchen-1",
    },
  ]);

  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].item_name, "Special Fried Rice");
  assert.equal(res.items[0].item_price, 250);
  assert.equal(res.items[0].menu_item_id, null);
  assert.equal(res.items[0].is_custom, true);
});

test("combined menu items + custom items have uniform key sets for bulk DB insertion", async () => {
  const service = createMockService();

  const menuRes = await resolveOrderItems(service, "rest-1", [
    { menu_item_id: "item-momo-123", quantity: 2 },
    { menu_item_id: "item-coke-456", quantity: 1 },
  ]);
  assert.equal(menuRes.ok, true);
  if (!menuRes.ok) return;

  const customRes = await resolveCustomItems(service, "rest-1", [
    {
      name: "Special Fried Rice",
      price: 250,
      quantity: 1,
      workstation_id: "ws-kitchen-1",
    },
    {
      name: "Extra Chicken",
      price: 150,
      quantity: 1,
      workstation_id: null,
    },
  ]);
  assert.equal(customRes.ok, true);
  if (!customRes.ok) return;

  const allItems = [...menuRes.items, ...customRes.items];
  assert.equal(allItems.length, 4);

  // Check that every item in allItems has all required columns defined, including is_custom
  const requiredKeys = [
    "menu_item_id",
    "variant_id",
    "workstation_id",
    "item_name",
    "item_price",
    "workstation_name",
    "quantity",
    "notes",
    "is_custom",
  ];

  for (const item of allItems) {
    const itemKeys = Object.keys(item);
    for (const key of requiredKeys) {
      assert.equal(
        itemKeys.includes(key),
        true,
        `Item "${item.item_name}" is missing key "${key}"`
      );
    }
  }

  // Check specific flags
  assert.equal(allItems[0].is_custom, false);
  assert.equal(allItems[1].is_custom, false);
  assert.equal(allItems[2].is_custom, true);
  assert.equal(allItems[3].is_custom, true);
});
