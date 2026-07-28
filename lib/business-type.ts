// Business type → which feature modules a restaurant has.
//
// `restaurants.type` is an enum constrained (DB check) to one of:
//   restaurant | hotel | restaurant_hotel
// chosen when the client is created in the Super Admin. Everything that gates a
// module on business type reads THESE helpers — never compare the raw string in a
// component, so the rule lives in one place and stays consistent everywhere.

export type BusinessType = "restaurant" | "hotel" | "restaurant_hotel";

/** Coerce whatever is on the row into a known type; unknown/legacy → restaurant. */
export function normalizeBusinessType(v: unknown): BusinessType {
  return v === "hotel" || v === "restaurant_hotel" ? v : "restaurant";
}

/** Has the HOTEL side — rooms, check-in/out, folios, room service. */
export function hasRooms(type: BusinessType): boolean {
  return type === "hotel" || type === "restaurant_hotel";
}

/** Has the RESTAURANT side — tables, walk-ins, menu, dine-in orders, stock.
 *  (Hotel-only hiding of restaurant modules is deferred; this helper is here so it
 *  can be switched on without another pass — see roadmap.) */
export function hasRestaurant(type: BusinessType): boolean {
  return type === "restaurant" || type === "restaurant_hotel";
}
