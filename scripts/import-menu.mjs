/**
 * Bulk-load a restaurant's menu from a JSON file (see docs/menu-import.md).
 *
 *   node scripts/import-menu.mjs --file docs/menu-data/<name>.json --env .env.production --dry-run
 *   node scripts/import-menu.mjs --file docs/menu-data/<name>.json --env .env.production --yes
 *
 * WHY A SCRIPT: the admin UI is one form submit per item and one per variant. A real menu
 * is ~200 items and ~60 variants; that is an afternoon by hand and a minute here.
 *
 * WHAT IT RELIES ON (all verified in docs/menu-import.md):
 *   • `menu_items.workstation_id` is derived from the category by a BEFORE-INSERT trigger.
 *     We send it anyway — same value the trigger computes, so it is a no-op, but the insert
 *     still satisfies NOT NULL if that trigger is ever missing on a given database.
 *   • `menu_item_variants` has NO restaurant_id column. Sending one fails the insert.
 *   • `menu_items.has_variants` is maintained by a trigger. Never written here.
 *   • A variant's price REPLACES the item price, so variant prices are absolute.
 *
 * IDEMPOTENT: existing categories/items/variants are matched by name and skipped, so a
 * re-run after a partial failure resumes instead of duplicating. It never updates or
 * deletes anything — correcting a price is a deliberate act, not a side effect of re-running.
 */
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const args = argv.slice(2);
const flag = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const dryRun = args.includes("--dry-run");
const confirmed = args.includes("--yes");

const file = flag("--file");
const envFile = flag("--env");
if (!file || !envFile) {
  console.error("usage: --file <menu.json> --env <env file> [--dry-run|--yes]");
  exit(1);
}

// Minimal .env reader — same shape the other scripts use. Values may be quoted.
const env = {};
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error(`${envFile} lacks NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY`);

const menu = JSON.parse(readFileSync(file, "utf8"));
const { restaurant_id: RID, workstations: WS, restaurant, database } = menu._meta;

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : [];
}

const totalItems = menu.categories.reduce((s, c) => s + c.items.length, 0);
const totalVariants = menu.categories.reduce(
  (s, c) => s + c.items.reduce((n, i) => n + (i.variants?.length ?? 0), 0), 0);

console.log(`restaurant : ${restaurant}`);
console.log(`database   : ${database}`);
console.log(`plan       : ${menu.categories.length} categories, ${totalItems} items, ${totalVariants} variants\n`);

if (!dryRun && !confirmed) {
  console.error("Refusing to write without --yes (or use --dry-run to preview).");
  exit(1);
}

// ── existing state, so a re-run is a resume rather than a duplicate ───────────
const existingCats = await rest(`menu_categories?select=id,name&restaurant_id=eq.${RID}`);
const catByName = new Map(existingCats.map((c) => [c.name, c.id]));
const existingItems = await rest(`menu_items?select=id,name&restaurant_id=eq.${RID}&is_deleted=eq.false`);
const itemByName = new Map(existingItems.map((i) => [i.name, i.id]));

let newCats = 0, newItems = 0, newVariants = 0, skipped = 0;

for (const cat of menu.categories) {
  const wsId = WS[cat.station];
  if (!wsId) throw new Error(`category "${cat.name}" has unknown station "${cat.station}"`);

  let catId = catByName.get(cat.name);
  if (!catId) {
    if (dryRun) { console.log(`+ category ${cat.name} (${cat.station})`); catId = "(dry-run)"; }
    else {
      const [row] = await rest("menu_categories", {
        method: "POST",
        body: JSON.stringify({
          restaurant_id: RID, name: cat.name, workstation_id: wsId,
          sort_order: cat.sort ?? 0, is_active: true,
        }),
      });
      catId = row.id;
      catByName.set(cat.name, catId);
    }
    newCats++;
  }

  for (const [idx, item] of cat.items.entries()) {
    let itemId = itemByName.get(item.name);
    if (itemId) { skipped++; continue; }

    if (dryRun) {
      const v = item.variants ? ` [${item.variants.map((x) => `${x.name} ${x.price}`).join(", ")}]` : "";
      console.log(`  + ${cat.name} / ${item.name} ${item.price}${v}`);
      newItems++;
      newVariants += item.variants?.length ?? 0;
      continue;
    }

    const [row] = await rest("menu_items", {
      method: "POST",
      body: JSON.stringify({
        restaurant_id: RID,
        category_id: catId,
        workstation_id: wsId, // trigger recomputes this from the category; harmless, and NOT NULL-safe
        name: item.name,
        description: item.description ?? null,
        price: item.price,
        food_type: item.food_type ?? "veg",
        availability_status: "available",
        is_available: true,
        sort_order: idx + 1,
      }),
    });
    itemId = row.id;
    itemByName.set(item.name, itemId);
    newItems++;

    if (item.variants?.length) {
      // sort_order is explicit: leaving it 0 makes the list fall back to alphabetical,
      // which turns Small/Medium/Large into Large/Medium/Small.
      await rest("menu_item_variants", {
        method: "POST",
        body: JSON.stringify(
          item.variants.map((v, i) => ({
            menu_item_id: itemId, // NOTE: no restaurant_id — that column does not exist
            name: v.name,
            price: v.price,
            is_available: true,
            sort_order: i + 1,
          }))
        ),
      });
      newVariants += item.variants.length;
    }
  }
}

console.log(
  `\n${dryRun ? "[dry run] would create" : "created"}: ` +
  `${newCats} categories, ${newItems} items, ${newVariants} variants` +
  (skipped ? ` (skipped ${skipped} item(s) that already existed)` : "")
);
