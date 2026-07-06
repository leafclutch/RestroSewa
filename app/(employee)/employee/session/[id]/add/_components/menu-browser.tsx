"use client";

import { useState, useActionState, useTransition } from "react";
import { submitOrder } from "@/app/actions/pos";
import type { ActionResult, CartItem } from "@/app/actions/pos";
import type { CategoryRow, MenuItemRow } from "@/app/actions/menu";
import { Button } from "@/components/ui/button";
import { Minus, Plus, ShoppingBag } from "lucide-react";

const FOOD_DOT: Record<string, { color: string; title: string }> = {
  veg:     { color: "#1a7a4a", title: "Veg" },
  non_veg: { color: "#c0392b", title: "Non-Veg" },
  vegan:   { color: "#2563eb", title: "Vegan" },
  egg:     { color: "#b45309", title: "Egg" },
};

export function MenuBrowser({
  sessionId,
  categories,
  items,
}: {
  sessionId: string;
  categories: CategoryRow[];
  items: MenuItemRow[];
}) {
  const [activeCategoryId, setActiveCategoryId] = useState<string>(
    categories[0]?.id ?? ""
  );
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(
    submitOrder,
    null
  );
  const [, startTransition] = useTransition();

  const visibleItems = items.filter(
    (i) => i.category_id === activeCategoryId && i.availability_status === "available"
  );

  function adjust(item: MenuItemRow, delta: number) {
    setCart((prev) => {
      const next = new Map(prev);
      const current = next.get(item.id) ?? 0;
      const updated = current + delta;
      if (updated <= 0) {
        next.delete(item.id);
      } else {
        next.set(item.id, Math.min(updated, 99));
      }
      return next;
    });
  }

  const cartTotal = Array.from(cart.entries()).reduce((sum, [id, qty]) => {
    const item = items.find((i) => i.id === id);
    return sum + (item ? Number(item.price) * qty : 0);
  }, 0);
  const cartCount = Array.from(cart.values()).reduce((a, b) => a + b, 0);

  function handlePlaceOrder() {
    const cartItems: CartItem[] = Array.from(cart.entries())
      .map(([id, quantity]) => {
        const item = items.find((i) => i.id === id);
        if (!item) return null;
        return {
          menu_item_id: item.id,
          variant_id: null,
          item_name: item.name,
          item_price: Number(item.price),
          workstation_id: item.workstation_id,
          workstation_name: "", // populated server-side from the workstation relation
          quantity,
          notes: null,
        };
      })
      .filter(Boolean) as CartItem[];

    const fd = new FormData();
    fd.set("session_id", sessionId);
    fd.set("items", JSON.stringify(cartItems));
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

  return (
    <div className="flex flex-col h-full">
      {/* Category tabs */}
      <div
        className="flex gap-1 overflow-x-auto px-4 py-2 border-b shrink-0"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCategoryId(c.id)}
            className="px-3 py-1.5 rounded-lg text-sm whitespace-nowrap shrink-0"
            style={{
              background: activeCategoryId === c.id ? "var(--color-primary)" : "transparent",
              color: activeCategoryId === c.id ? "#fff" : "var(--color-ink-mute)",
              fontWeight: activeCategoryId === c.id ? 400 : 300,
            }}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Items grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {visibleItems.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No items in this category.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {visibleItems.map((item) => {
              const qty = cart.get(item.id) ?? 0;
              return (
                <div
                  key={item.id}
                  className="rounded-xl border p-3 flex flex-col gap-2"
                  style={{
                    background: qty > 0 ? "#f0f0ff" : "var(--color-canvas)",
                    borderColor: qty > 0 ? "var(--color-primary)" : "var(--color-hairline)",
                  }}
                >
                  <div className="flex items-start gap-1.5">
                    {FOOD_DOT[item.food_type] && (
                      <span
                        title={FOOD_DOT[item.food_type].title}
                        className="mt-0.5 w-2.5 h-2.5 rounded-sm border flex-shrink-0"
                        style={{ borderColor: FOOD_DOT[item.food_type].color, background: FOOD_DOT[item.food_type].color + "22" }}
                      />
                    )}
                    <p className="text-sm leading-tight flex-1" style={{ color: "var(--color-ink)" }}>
                      {item.name}
                    </p>
                  </div>
                  <p className="text-sm tabular" style={{ color: "var(--color-ink-mute)" }}>
                    ₹{Number(item.price).toFixed(0)}
                  </p>
                  <div className="flex items-center gap-2 mt-auto">
                    {qty === 0 ? (
                      <button
                        type="button"
                        onClick={() => adjust(item, 1)}
                        className="flex-1 h-8 rounded-lg text-sm flex items-center justify-center gap-1"
                        style={{ background: "var(--color-primary)", color: "#fff" }}
                      >
                        <Plus size={14} /> Add
                      </button>
                    ) : (
                      <div className="flex items-center gap-1 flex-1">
                        <button
                          type="button"
                          onClick={() => adjust(item, -1)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ background: "var(--color-canvas-soft)" }}
                        >
                          <Minus size={14} style={{ color: "var(--color-ink)" }} />
                        </button>
                        <span className="flex-1 text-center text-sm font-medium tabular" style={{ color: "var(--color-ink)" }}>
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => adjust(item, 1)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ background: "var(--color-primary)" }}
                        >
                          <Plus size={14} style={{ color: "#fff" }} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart bar */}
      {cartCount > 0 && (
        <div
          className="shrink-0 border-t px-4 py-3 flex items-center gap-3"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <div className="flex items-center gap-2 flex-1">
            <ShoppingBag size={16} style={{ color: "var(--color-primary)" }} />
            <span className="text-sm" style={{ color: "var(--color-ink)" }}>
              {cartCount} item{cartCount !== 1 ? "s" : ""}
            </span>
            <span className="text-sm tabular" style={{ color: "var(--color-ink-mute)" }}>
              · ₹{cartTotal.toFixed(0)}
            </span>
          </div>
          {state?.error && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
          )}
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={handlePlaceOrder}
          >
            {pending ? "Placing…" : "Place order"}
          </Button>
        </div>
      )}
    </div>
  );
}
