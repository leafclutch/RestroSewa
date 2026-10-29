"use client";

import { useState, useActionState, useTransition, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
// Type only (erased at build): the enum's runtime value is the plain string "full".
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { submitOrder } from "@/app/actions/pos";
import type { ActionResult, CartItem } from "@/app/actions/pos";
import type { CategoryRow, MenuItemRow, VariantRow } from "@/app/actions/menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FoodMark } from "@/components/ui/food-mark";
import { assignCategoryHues, styleOf } from "@/lib/category-colors";
import { ListPlus, Minus, Plus, Search, ShoppingBag, SquarePen, TriangleAlert, X } from "lucide-react";
import { useCurrency } from "@/components/currency-provider";

// A staff-typed off-menu line held in the cart before submit. `price` is a string while
// being typed; it's parsed to a number only when the order is placed. `workstation_id` null
// means bill-only (no KOT/BOT).
type CustomLine = {
  key: number;
  name: string;
  price: string;
  quantity: number;
  notes: string;
  workstation_id: string | null;
};

type Workstation = { id: string; name: string };

// A cart line is an item AND the variant chosen for it: a Large Coffee and a
// Small Coffee are two lines, not one line of quantity 2. The map is therefore
// keyed by both. (It used to be keyed by item id alone, which is why a variant
// could never have been represented even once the DB supported it.)
type LineKey = string;

const keyOf = (itemId: string, variantId: string | null): LineKey =>
  variantId ? `${itemId}::${variantId}` : itemId;

const parseKey = (key: LineKey): { itemId: string; variantId: string | null } => {
  const [itemId, variantId] = key.split("::");
  return { itemId, variantId: variantId ?? null };
};

// "All" is a VIRTUAL category (same idea as the customer site's): never stored or
// fetched, it just stands in the `activeCategoryId` state. A `__`-fenced literal
// can't collide with a uuid.
const ALL_CATEGORY_ID = "__all__";

export function MenuBrowser({
  sessionId,
  categories,
  items,
  variants,
  canAddCustom = false,
  workstations = [],
  onOrderPlaced,
  returnHref,
  desktopReturnHref,
}: {
  sessionId: string;
  categories: CategoryRow[];
  items: MenuItemRow[];
  variants: VariantRow[];
  /** Whether this user holds `manage_custom_items` — gates the whole custom-item affordance. */
  canAddCustom?: boolean;
  /** Stations a custom item can be routed to (empty ⇒ bill-only is the only choice). */
  workstations?: Workstation[];
  /**
   * Called once an order successfully submits (after the cart's already been
   * cleared). Omit it and this navigates back to the session page itself —
   * the standalone mobile `/add` route's behavior, and the only sensible
   * default for a component that otherwise has no way to know it's not the
   * whole page. The desktop/tablet split-view passes its own callback (switch
   * the tab, refresh) instead, since there it stays mounted in a pane rather
   * than being the page.
   */
  onOrderPlaced?: () => void;
  /**
   * Where the default (no `onOrderPlaced`) success navigation goes. Defaults to
   * the session page; a room stay passes its room screen so it doesn't bounce
   * through the table session route's layout before that page redirects.
   */
  returnHref?: string;
  /**
   * The phone-only "Add items" page passes where to go when the window is DESKTOP width
   * (1024px+): there the room / table screen already has this menu built in beside the
   * order, so staying on a menu-only page is a dead end — someone who opened it on a
   * phone-sized window and then widened it was stuck here. The split panes leave it out.
   */
  desktopReturnHref?: string;
}) {
  const cur = useCurrency();
  const router = useRouter();
  // Opens on "All", like the customer site — the whole menu, grouped by category,
  // before narrowing it down.
  const [activeCategoryId, setActiveCategoryId] = useState<string>(ALL_CATEGORY_ID);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Map<LineKey, number>>(new Map());
  const [picking, setPicking] = useState<MenuItemRow | null>(null);
  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(submitOrder, null);
  const [, startTransition] = useTransition();

  // Custom (off-menu) lines and the "Add custom item" form.
  const customKey = useRef(1);
  const [customLines, setCustomLines] = useState<CustomLine[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [cName, setCName] = useState("");
  const [cPrice, setCPrice] = useState("");
  const [cQty, setCQty] = useState(1);
  const [cNote, setCNote] = useState("");
  const [cStation, setCStation] = useState<string>("");

  // `submitOrder` no longer redirects on success (it can't — this component may
  // be mounted in a persistent split-view pane, not a standalone page) — it
  // just returns `null`, indistinguishable from the action never having run.
  // So success is detected the same way `wasPending` refs elsewhere in this
  // codebase detect a `useActionState` completing cleanly (e.g.
  // `ImportCreditForm`): a pending→not-pending transition with no error.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !(state && "error" in state)) {
      setCart(new Map());
      setCustomLines([]);
      if (onOrderPlaced) onOrderPlaced();
      else router.push(returnHref ?? `/employee/session/${sessionId}`);
    }
    wasPending.current = pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state]);

  const variantsOf = useMemo(() => {
    const m = new Map<string, VariantRow[]>();
    for (const v of variants) {
      const list = m.get(v.menu_item_id);
      if (list) list.push(v);
      else m.set(v.menu_item_id, [v]);
    }
    return m;
  }, [variants]);

  // One hue per category, resolved over the whole list at once (distinct up to 12) — see
  // lib/category-colors.ts. Drives the tab colours and each item card's category accent.
  const hueMap = useMemo(() => assignCategoryHues(categories), [categories]);
  const catStyleOf = (categoryId: string) => styleOf(hueMap.get(categoryId) ?? "orange");

  // While searching, the active category is set aside and every available item whose name matches
  // is shown as a flat list — the fastest way to find a dish is to type it, not to hunt for its
  // tab. The input is a plain controlled field, so it never remounts and never loses focus.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const showingAll = !searching && activeCategoryId === ALL_CATEGORY_ID;
  const availableItems = useMemo(
    () => items.filter((i) => i.availability_status === "available"),
    [items]
  );
  const visibleItems = searching
    ? availableItems.filter((i) => i.name.toLowerCase().includes(q))
    : showingAll
    ? availableItems
    : availableItems.filter((i) => i.category_id === activeCategoryId);

  // "All" keeps the category structure: built by walking `categories`, which arrives
  // in the admin's order, so the sections inherit it.
  const groupedItems = useMemo(
    () =>
      categories
        .map((c) => ({ category: c, items: availableItems.filter((i) => i.category_id === c.id) }))
        .filter((g) => g.items.length > 0),
    [categories, availableItems]
  );

  function adjust(key: LineKey, delta: number) {
    setCart((prev) => {
      const next = new Map(prev);
      const updated = (next.get(key) ?? 0) + delta;
      if (updated <= 0) next.delete(key);
      else next.set(key, Math.min(updated, 99));
      return next;
    });
  }

  // Tapping an item with variants can't just add it — the price depends on which
  // one, so it opens the picker instead.
  function handleAdd(item: MenuItemRow) {
    const opts = variantsOf.get(item.id);
    if (opts?.length) setPicking(item);
    else adjust(keyOf(item.id, null), 1);
  }

  // How many of this dish are in the cart across all its variants — so the card
  // shows "3" for a coffee that's 1 small and 2 large.
  function qtyOfItem(itemId: string): number {
    let total = 0;
    for (const [key, qty] of cart) {
      if (parseKey(key).itemId === itemId) total += qty;
    }
    return total;
  }

  const priceOf = (itemId: string, variantId: string | null): number => {
    if (variantId) {
      const v = variantsOf.get(itemId)?.find((x) => x.id === variantId);
      if (v) return Number(v.price);
    }
    return Number(items.find((i) => i.id === itemId)?.price ?? 0);
  };

  const labelOf = (itemId: string, variantId: string | null): string => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return "";
    if (!variantId) return item.name;
    const v = variantsOf.get(itemId)?.find((x) => x.id === variantId);
    return v ? `${item.name} (${v.name})` : item.name;
  };

  const cartEntries = Array.from(cart.entries());
  const cartTotal = cartEntries.reduce((sum, [key, qty]) => {
    const { itemId, variantId } = parseKey(key);
    return sum + priceOf(itemId, variantId) * qty;
  }, 0);
  const cartCount = cartEntries.reduce((a, [, qty]) => a + qty, 0);

  // Custom lines add to the same order and the same running total.
  const customCount = customLines.reduce((a, l) => a + l.quantity, 0);
  const customTotal = customLines.reduce((a, l) => a + (parseFloat(l.price) || 0) * l.quantity, 0);
  const totalCount = cartCount + customCount;
  const grandTotal = cartTotal + customTotal;

  // Desktop width on the phone-only page: back to the full screen, whose menu is right
  // there. Only while nothing is waiting in the cart — leaving would throw an untaken
  // order away; once it is placed (or emptied) this fires and takes them back.
  // Warmed once, up front: the room / table screen is fetched in the background while
  // this page is open, so a widened window (or the Back button) switches over instantly
  // instead of sitting on a loading screen.
  useEffect(() => {
    // FULL, not the default: on a dynamic page the default fetches only the loading
    // shell, which is exactly the loading screen this is here to skip.
    if (desktopReturnHref) router.prefetch(desktopReturnHref, { kind: "full" as PrefetchKind });
  }, [desktopReturnHref, router]);

  useEffect(() => {
    if (!desktopReturnHref) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const check = () => {
      if (mq.matches && totalCount === 0) router.replace(desktopReturnHref, { scroll: false });
    };
    check();
    mq.addEventListener("change", check);
    return () => mq.removeEventListener("change", check);
  }, [desktopReturnHref, totalCount, router]);
  const stationName = (id: string | null) => workstations.find((w) => w.id === id)?.name ?? null;

  const cPriceNum = parseFloat(cPrice);
  const customValid = cName.trim().length > 0 && Number.isFinite(cPriceNum) && cPriceNum >= 0 && cQty >= 1;

  function addCustomLine() {
    if (!customValid) return;
    setCustomLines((l) => [
      ...l,
      { key: customKey.current++, name: cName.trim(), price: cPrice, quantity: cQty, notes: cNote.trim(), workstation_id: cStation || null },
    ]);
    setCName(""); setCPrice(""); setCQty(1); setCNote(""); setCStation("");
    setCustomOpen(false);
  }
  const removeCustom = (key: number) => setCustomLines((l) => l.filter((x) => x.key !== key));

  function handlePlaceOrder() {
    // Only ids and quantities travel to the server; it prices the order itself.
    const cartItems: CartItem[] = cartEntries.map(([key, quantity]) => {
      const { itemId, variantId } = parseKey(key);
      return { menu_item_id: itemId, variant_id: variantId, quantity, notes: null };
    });

    // Custom lines carry a staff-typed name/price — the server re-validates and re-checks the
    // permission, so this is a request, not a fact.
    const custom = customLines.map((l) => ({
      name: l.name,
      price: parseFloat(l.price) || 0,
      quantity: l.quantity,
      notes: l.notes || null,
      workstation_id: l.workstation_id,
    }));

    const fd = new FormData();
    fd.set("session_id", sessionId);
    fd.set("items", JSON.stringify(cartItems));
    fd.set("custom_items", JSON.stringify(custom));
    // dispatch must be called inside startTransition (React 19 rule)
    startTransition(() => dispatch(fd));
  }

  if (categories.length === 0) {
    return (
      <p className="text-sm p-5" style={{ color: "var(--color-ink-mute)" }}>
        No menu categories set up yet.
      </p>
    );
  }

  // One menu card: the name at the top left, the price at the bottom left, and a small
  // round + at the bottom right. The WHOLE card is the tap target — tap anywhere to add
  // one (an item with sizes opens its picker instead); the + just marks it. Once the dish
  // is in the order the + becomes a small − count + stepper. The card wears its
  // CATEGORY's colour (a faint tint, a border and the price in the hue) so dishes group by
  // colour; the buttons wear the screen's own colour. The hue is only ever a tint behind
  // text in the hue, never white on a solid hue: the --cat-* tokens are foreground colours
  // that turn light in dark mode. Every card is the same height — the name is held to two
  // lines — so a long name can't make one card taller than the rest of its row.
  const renderItem = (item: MenuItemRow) => {
    const qty = qtyOfItem(item.id);
    const opts = variantsOf.get(item.id) ?? [];
    const hasVariants = opts.length > 0;
    // With variants the card can't show one price — it shows the
    // cheapest as a "from", which is what the guest will pay at minimum.
    const from = hasVariants
      ? Math.min(...opts.map((v) => Number(v.price)))
      : Number(item.price);
    const cat = catStyleOf(item.category_id);
    const inCart = qty > 0;
    // The stepper's own buttons must not ALSO trigger the card's add.
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    return (
      // A div with button semantics, not a <button>: the − / + inside it are buttons of
      // their own, and a button may not contain another.
      <div
        key={item.id}
        role="button"
        tabIndex={0}
        aria-label={hasVariants ? `Choose a size of ${item.name}` : `Add ${item.name}`}
        onClick={() => handleAdd(item)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleAdd(item);
          }
        }}
        className="rounded-xl border-[1.5px] p-2.5 @lg:p-3 flex flex-col gap-2 cursor-pointer select-none transition-[transform,background-color,border-color] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{
          background: `color-mix(in srgb, ${cat.color} ${inCart ? 12 : 6}%, var(--color-canvas))`,
          borderColor: inCart ? cat.color : `color-mix(in srgb, ${cat.color} 35%, var(--color-hairline))`,
          boxShadow: inCart ? `0 0 0 1px ${cat.color}, var(--shadow-card)` : "var(--shadow-card)",
          outlineColor: "var(--color-primary)",
        }}
      >
        <div className="min-w-0">
          <div className="flex items-start gap-1.5">
            <span className="mt-[4px] shrink-0">
              <FoodMark type={item.food_type} size={11} />
            </span>
            {/* Two lines' worth of height is always reserved, so every card in a row matches. */}
            <p
              title={item.name}
              className="flex-1 min-h-[2.75em] text-[15px] font-semibold leading-[1.375] line-clamp-2"
              style={{ color: "var(--color-ink)" }}
            >
              {item.name}
            </p>
            {/* A guest may ask the waiter, not read the QR menu — the note is on hover. */}
            {item.allergy_info && (
              <span className="mt-[3px] shrink-0" title={item.allergy_info} style={{ color: "var(--color-ruby)" }}>
                <TriangleAlert size={13} />
              </span>
            )}
          </div>
          {/* Mixed results while searching: say which category each one is from. */}
          {searching && (
            <p className="text-xs font-semibold truncate mt-0.5" style={{ color: cat.color }}>
              {categories.find((c) => c.id === item.category_id)?.name}
            </p>
          )}
        </div>

        {/* Price on the left; the small + (or − count +) on the right. */}
        {/* Wraps on a narrow card (a phone's two columns): the − count + drops under the
            price, right-aligned, rather than squeezing the price to nothing. */}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <p className="text-sm tabular whitespace-nowrap" style={{ color: cat.color }}>
            {hasVariants && <span style={{ color: "var(--color-ink-mute)" }}>from </span>}
            <span className="font-bold">{cur.money(from)}</span>
          </p>

          {/* An item with sizes always routes through the picker, so it keeps the single
              mark even when some are already in the order — a bare −/+ would have no size
              to apply to; the count sits beside it instead. */}
          {qty === 0 || hasVariants ? (
            <span className="flex items-center gap-1 shrink-0">
              {hasVariants && qty > 0 && (
                <span className="text-sm font-bold tabular" style={{ color: "var(--color-ink)" }}>{qty}</span>
              )}
              <span
                aria-hidden
                title={hasVariants ? "Choose a size" : "Add"}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "var(--color-primary)", color: "#fff" }}
              >
                {hasVariants ? <ListPlus size={16} strokeWidth={2.3} /> : <Plus size={17} strokeWidth={2.6} />}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                aria-label={`One less ${item.name}`}
                onClick={(e) => { stop(e); adjust(keyOf(item.id, null), -1); }}
                onKeyDown={stop}
                // Solid red: taking one back is the "undo" of the card, and has to be found
                // at a glance beside the teal +, never tapped by mistake for it.
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:brightness-110"
                style={{ background: "#dc2626", color: "#fff", boxShadow: "0 1px 3px rgba(220,38,38,0.35)" }}
              >
                <Minus size={15} strokeWidth={2.8} />
              </button>
              <span key={qty} className="tally-pop min-w-6 text-center text-base font-bold tabular" style={{ color: "var(--color-ink)" }}>
                {qty}
              </span>
              <button
                type="button"
                aria-label={`One more ${item.name}`}
                onClick={(e) => { stop(e); adjust(keyOf(item.id, null), 1); }}
                onKeyDown={stop}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "var(--color-primary)", color: "#fff" }}
              >
                <Plus size={15} strokeWidth={2.6} />
              </button>
            </span>
          )}
        </div>
      </div>
    );
  };

  // Cards flow to the pane's width, not the screen's: this menu lives in a phone page,
  // a split-view pane and the room screen's column, each a different width. Every card
  // is at least 160px; as many fit as the space allows.
  // A narrow pane (a phone) always gets two even columns — at 160px minimum a 360px
  // phone fitted only ONE card per row; from 512px of pane up, cards flow by width.
  const GRID = "grid gap-2.5 grid-cols-2 @lg:gap-3 @lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]";

  // The category list, as data, for both the wide rail and the narrow chip row.
  const tabs = [
    { id: ALL_CATEGORY_ID, name: "All", count: availableItems.length, color: "var(--color-primary)" },
    ...categories.map((c) => ({
      id: c.id,
      name: c.name,
      count: availableItems.filter((i) => i.category_id === c.id).length,
      color: catStyleOf(c.id).color,
    })),
  ];

  return (
    // `flex-1 min-h-0`, NOT `h-full`. This is a flex child sitting BELOW the page's
    // "Add items" header bar, so `h-full` (100% of the whole column) overflowed the
    // column by exactly the header's height and pushed the cart bar — and the Place
    // order button on it — off the bottom of the screen. `min-h-0` is the other half:
    // a flex item defaults to `min-height:auto`, so without it a long menu refuses to
    // shrink and shoves the footer off again.
    //
    // `@container`: the layout below answers to THIS pane's width (rail vs chips),
    // because the same menu is a phone page, a split-view pane and a room column.
    <div className="@container flex flex-col flex-1 min-h-0">
      {/* Search — the fastest path to a dish — with "Custom item" beside it. A non-empty
          query sets the categories aside and searches every one of them at once. */}
      <div className="px-4 pt-3.5 pb-3 shrink-0 flex items-center gap-2 border-b" style={{ borderColor: "var(--color-hairline)" }}>
        <div className="relative flex-1 min-w-0">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--color-ink-mute)" }} />
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the menu"
            aria-label="Search the menu"
            className="w-full h-11 rounded-xl border pl-10 pr-9 text-base"
            style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full"
              style={{ color: "var(--color-ink-mute)" }}
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Off-menu line — only for staff with `manage_custom_items`. The label folds
            away on a narrow pane; the icon never does. */}
        {canAddCustom && (
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            title="Add a custom item"
            className="shrink-0 h-11 inline-flex items-center gap-1.5 text-sm font-semibold px-3 rounded-xl border-[1.5px]"
            style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)", background: "var(--color-canvas)" }}
          >
            <SquarePen size={16} />
            <span className="hidden @md:inline">Custom item</span>
          </button>
        )}
      </div>

      {/* Narrow pane: the categories as one scrolling row of chips. Each chip wears its
          category's hue as a tint behind text in the hue; the chosen one gets a ring and
          bold. Tints and coloured text only — never white on a category fill (--cat-* are
          foreground tokens that invert in dark). Hidden while searching.
          Any number of categories: the row scrolls sideways — by swipe, by the slim
          scrollbar, or by an ordinary mouse wheel (turned sideways here) — and the chosen
          chip is brought into view. A long name is cut with "…" at a sane width, in full
          on hover, so one category can't take the whole row. */}
      {!searching && (
        <div
          className="@2xl:hidden flex gap-2 overflow-x-auto thin-scrollbar px-4 py-3 border-b shrink-0"
          style={{ borderColor: "var(--color-hairline)" }}
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          {tabs.map((t) => {
            const active = activeCategoryId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={(e) => {
                  setActiveCategoryId(t.id);
                  e.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
                }}
                aria-pressed={active}
                title={t.name}
                className="h-11 max-w-[13rem] px-4 rounded-full text-sm whitespace-nowrap truncate shrink-0 border-[1.5px] transition-colors"
                style={{
                  background: `color-mix(in srgb, ${t.color} ${active ? 26 : 14}%, var(--color-canvas))`,
                  color: t.color,
                  borderColor: active ? t.color : `color-mix(in srgb, ${t.color} 45%, transparent)`,
                  boxShadow: active ? `inset 0 0 0 1px ${t.color}` : "none",
                  fontWeight: active ? 700 : 600,
                }}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Wide pane: the categories as a rail down the left, like the section keys on a
            till — no sideways scrolling. Each sits on a tint of its hue; the chosen one
            deepens and gets a ring. Hidden while searching. Any number of categories: the
            rail scrolls on its own, apart from the dishes. A long name wraps onto as many
            lines as it needs — each key is `shrink-0`, so a long list can't squash the
            keys and clip their names. */}
        {!searching && (
          <nav
            aria-label="Menu categories"
            className="hidden @2xl:flex flex-col gap-1 w-48 @5xl:w-56 shrink-0 min-h-0 overflow-y-auto thin-scrollbar p-2.5 border-r"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            {tabs.map((t) => {
              const active = activeCategoryId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveCategoryId(t.id)}
                  aria-pressed={active}
                  className="w-full shrink-0 flex items-center gap-2.5 min-h-11 px-3 py-2 rounded-lg text-left text-sm transition-colors"
                  style={{
                    background: `color-mix(in srgb, ${t.color} ${active ? 24 : 10}%, var(--color-canvas))`,
                    color: t.color,
                    fontWeight: active ? 700 : 600,
                    boxShadow: active ? `inset 0 0 0 1.5px ${t.color}` : "none",
                  }}
                >
                  <span className="flex-1 min-w-0 leading-snug break-words">{t.name}</span>
                  <span className="text-xs font-semibold tabular shrink-0 px-1.5 rounded-md" style={{ color: t.color, background: `color-mix(in srgb, ${t.color} 16%, var(--color-canvas))` }}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Items — the ONLY scrolling region. `min-h-0` again, for the same reason as the
            root: this is what makes the menu scroll instead of growing the column. */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto menu-scrollbar px-4 pt-4 pb-5" style={{ background: "var(--color-canvas-soft)" }}>
          {visibleItems.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Search size={26} style={{ color: "var(--color-ink-mute)", opacity: 0.6 }} />
              <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
                {searching
                  ? `Nothing matches “${query.trim()}”. Check the spelling, or add it as a custom item.`
                  : "Nothing available in this category right now."}
              </p>
            </div>
          ) : showingAll ? (
            /* "All" — every dish, still grouped under its category heading in the admin's
               order, the same way the customer site's "All" reads. Empty categories drop
               out rather than render a bare heading. */
            <div className="flex flex-col gap-7">
              {groupedItems.map(({ category, items: catItems }) => {
                const cat = catStyleOf(category.id);
                return (
                  <section key={category.id}>
                    <div
                      className="flex items-center gap-2.5 mb-3 px-3 py-2 rounded-lg border"
                      style={{
                        background: `color-mix(in srgb, ${cat.color} 12%, var(--color-canvas))`,
                        borderColor: `color-mix(in srgb, ${cat.color} 35%, transparent)`,
                      }}
                    >
                      <h3 className="text-lg font-bold leading-snug flex-1 min-w-0 break-words" style={{ color: cat.color }}>
                        {category.name}
                      </h3>
                      <span
                        className="text-xs font-bold tabular px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap"
                        style={{ background: "var(--color-canvas)", color: cat.color }}
                      >
                        {catItems.length} {catItems.length === 1 ? "item" : "items"}
                      </span>
                    </div>
                    <div className={GRID}>
                      {catItems.map(renderItem)}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className={GRID}>
              {visibleItems.map(renderItem)}
            </div>
          )}
        </div>
      </div>

      {/* Variant picker */}
      {picking && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setPicking(null)}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: "var(--color-canvas)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                {picking.name}
              </p>
              <button type="button" onClick={() => setPicking(null)} style={{ color: "var(--color-ink-mute)" }}>
                <X size={16} />
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Choose an option
            </p>

            <div className="flex flex-col gap-1.5">
              {(variantsOf.get(picking.id) ?? []).map((v) => {
                const inCart = cart.get(keyOf(picking.id, v.id)) ?? 0;
                return (
                  <div
                    key={v.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border"
                    style={{
                      borderColor: inCart > 0 ? "var(--color-primary)" : "var(--color-hairline)",
                      background: inCart > 0 ? "var(--color-canvas-soft)" : "transparent",
                    }}
                  >
                    <span className="flex-1 text-sm" style={{ color: "var(--color-ink)" }}>
                      {v.name}
                    </span>
                    <span className="text-sm tabular" style={{ color: "var(--color-ink-mute)" }}>
                      {cur.money(Number(v.price))}
                    </span>
                    {inCart === 0 ? (
                      <button
                        type="button"
                        onClick={() => adjust(keyOf(picking.id, v.id), 1)}
                        className="h-8 px-3 rounded-lg text-sm flex items-center gap-1"
                        style={{ background: "var(--color-primary)", color: "#fff" }}
                      >
                        <Plus size={14} /> Add
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`One less ${v.name}`}
                          onClick={() => adjust(keyOf(picking.id, v.id), -1)}
                          // Solid red, like the − on the menu cards.
                          className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:brightness-110"
                          style={{ background: "#dc2626", color: "#fff", boxShadow: "0 1px 3px rgba(220,38,38,0.35)" }}
                        >
                          <Minus size={15} strokeWidth={2.8} />
                        </button>
                        <span
                          className="w-6 text-center text-sm font-medium tabular"
                          style={{ color: "var(--color-primary)" }}
                        >
                          {inCart}
                        </span>
                        <button
                          type="button"
                          aria-label={`One more ${v.name}`}
                          onClick={() => adjust(keyOf(picking.id, v.id), 1)}
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                          style={{ background: "var(--color-primary)" }}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Button type="button" variant="primary" onClick={() => setPicking(null)} className="w-full">
              Done
            </Button>
          </div>
        </div>
      )}

      {/* Add custom item */}
      {customOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setCustomOpen(false)}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: "var(--color-canvas)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                Custom item
              </p>
              <button type="button" onClick={() => setCustomOpen(false)} style={{ color: "var(--color-ink-mute)" }}>
                <X size={16} />
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Item name</span>
              <Input value={cName} maxLength={80} placeholder="e.g. Special platter" autoFocus onChange={(e) => setCName(e.target.value)} />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Price ({cur.symbol})</span>
                <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" value={cPrice} onChange={(e) => setCPrice(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 w-28">
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Quantity</span>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="One less" onClick={() => setCQty((q) => Math.max(1, q - 1))}
                    className="w-9 h-9 rounded-lg flex items-center justify-center border shrink-0"
                    style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)" }}>
                    <Minus size={14} style={{ color: "var(--color-ink)" }} />
                  </button>
                  <span className="flex-1 text-center text-base font-medium tabular" style={{ color: "var(--color-ink)" }}>{cQty}</span>
                  <button type="button" aria-label="One more" onClick={() => setCQty((q) => Math.min(99, q + 1))}
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--color-primary)" }}>
                    <Plus size={14} style={{ color: "#fff" }} />
                  </button>
                </div>
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Note (optional)</span>
              <Input value={cNote} maxLength={120} placeholder="e.g. no onions" onChange={(e) => setCNote(e.target.value)} />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Send to station (optional)</span>
              <select
                value={cStation}
                onChange={(e) => setCStation(e.target.value)}
                className="w-full text-sm rounded-lg border px-3 py-2"
                style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
              >
                <option value="">Bill only (no kitchen ticket)</option>
                {workstations.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>

            <Button type="button" variant="primary" className="w-full" disabled={!customValid} onClick={addCustomLine}>
              Add to order
            </Button>
          </div>
        </div>
      )}

      {/* Cart bar */}
      {totalCount > 0 && (
        <div
          className="shrink-0 border-t px-4 py-3 flex flex-col gap-2"
          style={{
            background: "var(--color-canvas)",
            borderColor: "var(--color-hairline)",
            // ADDS to the py-3 rather than replacing it (which `.pb-safe` would, leaving
            // 0 bottom padding on any device without a notch). Installed on an iPhone
            // this bar is the last thing on screen and the home indicator sits over the
            // bottom ~34px — exactly where the Place order button is. The base 2.25rem
            // (not 0.75rem) also clears the fixed subscription watermark
            // (`components/subscription-watermark.tsx`), which sits `bottom-2` and,
            // on mobile, centered under this same bar — without the extra room it
            // sat right on top of the Place order button.
            paddingBottom: "calc(2.25rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* Each variant is its own line, so a staff member can see that the
              order is 1 Small and 2 Large before they send it. */}
          <div className="flex flex-col gap-1 max-h-28 overflow-y-auto thin-scrollbar">
            {cartEntries.map(([key, qty]) => {
              const { itemId, variantId } = parseKey(key);
              return (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate" style={{ color: "var(--color-ink-mute)" }}>
                    {qty} × {labelOf(itemId, variantId)}
                  </span>
                  <span className="tabular" style={{ color: "var(--color-ink-mute)" }}>
                    {cur.money(priceOf(itemId, variantId) * qty)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${labelOf(itemId, variantId)}`}
                    onClick={() => adjust(key, -qty)}
                    style={{ color: "var(--color-ink-mute)" }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}

            {/* Custom lines — marked, with their station if routed to one. */}
            {customLines.map((l) => (
              <div key={`c-${l.key}`} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate" style={{ color: "var(--color-ink-mute)" }}>
                  {l.quantity} × {l.name}
                  <span
                    className="ml-1 px-1 rounded align-middle"
                    style={{ fontSize: "9px", lineHeight: "14px", background: "var(--color-canvas-soft)", color: "var(--color-primary)" }}
                  >
                    CUSTOM
                  </span>
                  {l.workstation_id && (
                    <span className="ml-1" style={{ color: "var(--color-ink-mute)" }}>· {stationName(l.workstation_id)}</span>
                  )}
                </span>
                <span className="tabular" style={{ color: "var(--color-ink-mute)" }}>
                  {cur.money((parseFloat(l.price) || 0) * l.quantity)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => removeCustom(l.key)}
                  style={{ color: "var(--color-ink-mute)" }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          {state?.error && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
          )}
          {/* Count + total on the left, one big Place order on the right. */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <span
                className="relative w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--color-primary) 12%, var(--color-canvas))", color: "var(--color-primary)" }}
              >
                <ShoppingBag size={18} />
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center tabular"
                  style={{ background: "var(--color-primary)", color: "#fff" }}
                >
                  {totalCount}
                </span>
              </span>
              <div className="min-w-0">
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  {totalCount} item{totalCount !== 1 ? "s" : ""} in order
                </p>
                <p className="text-lg font-bold tabular leading-tight" style={{ color: "var(--color-ink)" }}>
                  {cur.money(grandTotal)}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={handlePlaceOrder}
              className="h-12 px-5 rounded-xl text-base font-semibold inline-flex items-center gap-2 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              style={{ background: "var(--color-primary)", color: "#fff" }}
            >
              {pending ? "Placing…" : "Place order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
