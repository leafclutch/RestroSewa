/**
 * Everything the landing page SAYS lives here — prices, plan limits, contact details, FAQ — so a
 * price change or a new offer is a one-file edit and the visible page, the JSON-LD and the FAQ
 * structured data can never disagree with each other.
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hrestrosewa.com").replace(/\/$/, "");

/** Sales line — the same number takes calls and WhatsApp. Digits only for the links. */
const SALES_NUMBER = "9779766715796";

export const CONTACT = {
  phoneDisplay: "+977-9766715796",
  phoneHref: `tel:+${SALES_NUMBER}`,
  whatsappHref: `https://wa.me/${SALES_NUMBER}`,
  email: "hrestrosewa@gmail.com",
};

/** A WhatsApp chat link to the sales number with `text` already typed into the message box. */
export const whatsappLink = (text: string) => `https://wa.me/${SALES_NUMBER}?text=${encodeURIComponent(text)}`;

/** Length of the free trial offered before buying — shown in the hero, pricing, FAQ and popup. */
export const TRIAL = "7-day free trial";

/** The festive campaign shown in the ribbon and on the pricing cards. Set to null to end it. */
export const OFFER: { name: string; short: string } | null = {
  name: "Dashain–Tihar Offer",
  short: "Dashain–Tihar offer",
};

export type Plan = {
  id: "basic" | "pro";
  name: string;
  tagline: string;
  bestFor: string;
  tables: string;
  /** Regular first-year price. */
  listPrice: number;
  /** First-year price while OFFER is running. */
  offerPrice: number;
  /** Yearly renewal from the second year onward. */
  renewalPrice: number;
  highlights: string[];
  featured?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "basic",
    name: "Basic",
    tagline: "For restaurants, cafés & bars",
    bestFor: "Restaurants with up to 30 tables",
    tables: "Up to 30 tables",
    listPrice: 15000,
    offerPrice: 12000,
    renewalPrice: 10000,
    highlights: [
      "Up to 30 tables",
      "Table orders, KOT & kitchen/bar queues",
      "QR digital menu for guests",
      "Billing, split bills, credit & payments",
      "Stock, purchases, vendors & expenses",
      "Staff PIN login, attendance & salary tracker",
      "Daily sales & item-wise reports",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For large restaurants & hotels",
    bestFor: "30+ tables, hotels, or restaurant + hotel",
    tables: "30+ tables (no limit)",
    listPrice: 18000,
    offerPrice: 15000,
    renewalPrice: 12000,
    featured: true,
    highlights: [
      "Everything in Basic",
      "More than 30 tables — no table limit",
      "Hotel & lodge room management",
      "Restaurant + hotel in one system",
      "Room stays, check-in/out & room billing",
      "Move a table's order to a guest's room",
    ],
  },
];

export const formatRs = (n: number) => `Rs. ${n.toLocaleString("en-IN")}`;

/** Rows for the side-by-side comparison table. `true`/`false` render as a tick/dash. */
export const COMPARISON: { label: string; basic: string | boolean; pro: string | boolean }[] = [
  { label: "Number of tables", basic: "Up to 30", pro: "30+ (no limit)" },
  { label: "Restaurant / café / bar", basic: true, pro: true },
  { label: "Hotel & lodge (rooms)", basic: false, pro: true },
  { label: "Restaurant + hotel together", basic: false, pro: true },
  { label: "Transfer table order to a room", basic: false, pro: true },
  { label: "Table orders & KOT to kitchen/bar", basic: true, pro: true },
  { label: "QR menu — guests order, call waiter, ask for bill", basic: true, pro: true },
  { label: "Staff app with instant order notifications", basic: true, pro: true },
  { label: "Billing, split bills & credit", basic: true, pro: true },
  { label: "Stock, purchases & vendors", basic: true, pro: true },
  { label: "Staff attendance, salary tracker & deductions", basic: true, pro: true },
  { label: "Sales, item-sales & finance reports", basic: true, pro: true },
  { label: "Daily summary report by email", basic: true, pro: true },
  { label: "Works on phone, tablet & PC (installable app)", basic: true, pro: true },
];

const [B, P] = PLANS;

export const FAQ: { q: string; a: string }[] = [
  {
    q: "How much does HRestroSewa cost?",
    a:
      `Basic costs ${formatRs(B.listPrice)} for the first year and Pro costs ${formatRs(P.listPrice)}.` +
      (OFFER ? ` During the ${OFFER.name}, Basic is ${formatRs(B.offerPrice)} and Pro is ${formatRs(P.offerPrice)} for the first year.` : ""),
  },
  {
    q: "What is the renewal fee after the first year?",
    a: `The first-year fee is a one-time first installment. From the second year, renewal is ${formatRs(B.renewalPrice)} per year for Basic and ${formatRs(P.renewalPrice)} per year for Pro.`,
  },
  {
    q: "Which plan should I choose?",
    a: "Choose Basic if you run a restaurant, café or bar with up to 30 tables. Choose Pro if you have more than 30 tables, run a hotel or lodge, or run a restaurant and hotel together.",
  },
  {
    q: "Is hotel / room management included in Basic?",
    a: "No. Room and stay management for hotels and lodges is part of the Pro plan, along with the ability to bill a restaurant order to a guest's room.",
  },
  {
    q: "Can I try HRestroSewa before paying?",
    a: "Yes. We give a one-week (7-day) free trial. We set it up with your menu and tables so you can use it in your real restaurant or hotel before you decide. Message us on WhatsApp to start.",
  },
  {
    q: "Can I upgrade from Basic to Pro later?",
    a: "Yes. If you add more tables or open rooms, contact us and we will switch your account to Pro.",
  },
  {
    q: "Do my guests need to download an app to order?",
    a: "No. Guests just scan the QR code on their table (or in their room on Pro) with their phone camera. The menu opens in the browser, where they can order, call a waiter or ask for the bill.",
  },
  {
    q: "How do my staff know when a guest orders?",
    a: "Staff install the HRestroSewa app on their phone from the browser — no app store needed. New QR orders, waiter calls and bill requests arrive as instant notifications, and a new table can be approved straight from the notification.",
  },
  {
    q: "What devices do I need?",
    a: "Any phone, tablet, laptop or PC with a modern browser. HRestroSewa can be installed like an app on Android, iPhone and desktop. No special POS hardware is required.",
  },
  {
    q: "Do you help with setup and training?",
    a: "Yes. We help you set up your menu, tables, rooms and staff accounts, and train your team so you can start taking orders on day one.",
  },
];

/** The pre-filled WhatsApp message for "Get Basic" / "Get Pro", so sales sees exactly what was picked. */
export function planEnquiry(p: Plan): string {
  const firstYear = OFFER ? p.offerPrice : p.listPrice;
  return [
    `Hello HRestroSewa, I want the ${p.name} plan.`,
    ``,
    `Plan: ${p.name}`,
    `Tables: ${p.tables}`,
    `Best for: ${p.bestFor}`,
    OFFER
      ? `First year: ${formatRs(firstYear)} (${OFFER.name}, regular ${formatRs(p.listPrice)})`
      : `First year: ${formatRs(firstYear)}`,
    `Renewal: ${formatRs(p.renewalPrice)} per year from year two`,
    ``,
    `My restaurant/hotel name:`,
    `Location:`,
    `Number of tables/rooms:`,
  ].join("\n");
}

/** The pre-filled WhatsApp message for the popup's "Claim the offer". */
export function offerEnquiry(): string {
  const lines = PLANS.map((p) => `- ${p.name}: ${formatRs(OFFER ? p.offerPrice : p.listPrice)} first year, then ${formatRs(p.renewalPrice)}/yr`);
  return [
    `Hello HRestroSewa, I want to claim the ${OFFER?.name ?? "current offer"}.`,
    ...lines,
    ``,
    `Please share the details. My restaurant/hotel name:`,
  ].join("\n");
}

/** The pre-filled WhatsApp message for the general "Message us" button. */
export const GENERAL_ENQUIRY = [
  "Hello HRestroSewa, I visited your website and I'd like to learn more about HRestroSewa for my business.",
  "",
  "My name:",
  "Restaurant/hotel name:",
  "Location:",
].join("\n");

/** The pre-filled WhatsApp message for the floating "Book a demo" button. */
export const DEMO_ENQUIRY = [
  "Hello HRestroSewa, I visited your website and I'd like to book a free demo.",
  "",
  "My name:",
  "Restaurant/hotel name:",
  "Location:",
  "Preferred day/time:",
].join("\n");

/** localStorage key for the landing page's Light/Dark choice. Lives here (not in the client
 * toggle module) because the server page's inline no-flash script needs the real string. */
export const THEME_KEY = "hrs_landing_theme";
