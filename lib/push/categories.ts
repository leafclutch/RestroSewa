// What a staff member can mute, and what falls into each bucket.
//
// This is the frame the notification catalogue hangs off. Every alert the system can
// raise belongs to exactly ONE category, and a staff member can switch any category
// off for themselves. New event types slot into an existing category and inherit its
// preference automatically — nobody has to remember to wire up a new toggle.
//
// DEFAULT IS ON. A new alert type reaches people unless they have said otherwise:
// the failure mode of "a waiter never learns table 6 is calling" is a guest sitting
// unserved, and the failure mode of "one alert too many" is a shrug. Muting is
// therefore an opt-OUT, and the table stores only the exceptions — no row means on.

export const NOTIFICATION_CATEGORIES = {
  // Guests asking for a person. The most time-critical thing on the floor.
  service: "Waiter calls",
  // Orders: placed, awaiting approval, cancelled.
  orders: "Orders",
  // Bills, payments, refunds, customer credit.
  billing: "Billing",
  // Orders for the station you work — kitchen, bar, bakery, whatever you're assigned.
  //
  // The spec asked for KITCHEN and BAR as two separate switches. They can't be, and
  // pretending otherwise would be worse than saying so: a workstation in this schema
  // is just a name a restaurant typed in, with no notion of "is a bar". The only way
  // to split them would be to string-match "bar" against a user-entered label, which
  // breaks the moment someone calls it "Drinks" or "Cocktails" or writes it in
  // Nepali.
  //
  // And it would buy nothing. Staff are ASSIGNED to workstations: a bartender is on
  // the Bar and can only ever receive bar orders, so a "Kitchen" switch on their
  // phone would be a switch that does nothing. Two toggles where one is inert is a
  // worse interface than one toggle that is true.
  station: "Orders for your station",
  // Takings, margins, daily finance.
  finance: "Finance",
  // Products running low or out.
  stock: "Low stock",
  // Room-service orders and room requests.
  room_service: "Room service",
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export const ALL_CATEGORIES = Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[];

export function isCategory(v: string): v is NotificationCategory {
  return Object.hasOwn(NOTIFICATION_CATEGORIES, v);
}

/**
 * Which category does an event type belong to?
 *
 * Note `call_waiter` is `service`, not `orders`. The spec's category list didn't have
 * a home for a guest raising their hand, and filing it under Orders would mean a
 * waiter who mutes order chatter also stops being told that table 6 has been waiting
 * ten minutes — which is the single alert nobody should be able to mute by accident.
 * So it gets its own bucket, and muting it is a deliberate act.
 */
const CATEGORY_OF: Record<string, NotificationCategory> = {
  call_waiter: "service",
  request_bill: "billing",
  table_activation_request: "orders",

  // Workstation events — the chef's and bartender's alerts.
  new_order: "station",
  order_cancelled: "station",

  // Front-of-house money.
  payment_received: "billing",
};

export function categoryOf(type: string): NotificationCategory | null {
  return CATEGORY_OF[type] ?? null;
}

/** A short line under each toggle, so the switch says what it actually silences. */
export const CATEGORY_HINT: Record<NotificationCategory, string> = {
  service: "A guest is asking for a waiter",
  orders: "Orders awaiting your approval",
  billing: "Bill requests and payments taken",
  station: "New and cancelled orders for the station you're assigned to",
  finance: "Takings and daily finance alerts",
  stock: "Products running low or out of stock",
  room_service: "Room-service orders and room requests",
};
