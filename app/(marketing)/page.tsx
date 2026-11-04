import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BedDouble,
  Bell,
  Boxes,
  Building2,
  ChartColumn,
  Check,
  BellRing,
  ChefHat,
  HandPlatter,
  RefreshCw,
  ScanLine,
  WifiOff,
  Download,
  Crown,
  Mail,
  MessageCircle,
  Minus,
  Phone,
  QrCode,
  Receipt,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { PlatformLogo, PlatformWordmark, PoweredBy } from "@/components/branding/platform-logo";
import type { CSSProperties } from "react";
import { RestaurantLogo } from "@/components/branding/restaurant-logo";
import { getLiveCustomers, type LiveCustomer } from "@/lib/marketing/customers";
import { COMPARISON, CONTACT, FAQ, OFFER, PLANS, SITE_URL, formatRs, DEMO_ENQUIRY, GENERAL_ENQUIRY, THEME_KEY, TRIAL, offerEnquiry, planEnquiry, whatsappLink, type Plan } from "./_content";
import st from "./landing.module.css";
import { OfferPopup } from "./_components/offer-popup";
import { MobileMenu } from "./_components/mobile-menu";
import { Reveal } from "./_components/reveal";
import { ThemeSwitch, ThemeToggle } from "./_components/theme-toggle";

/** Stagger delay for the i-th item of a revealed group. */
const rd = (i: number) => ({ "--rd": `${i * 90}ms` }) as CSSProperties;

// Static, re-rendered at most hourly — so the customer list picks up new paying restaurants
// without a database round-trip on every visit.
export const revalidate = 3600;

const BASIC = PLANS.find((p) => p.id === "basic")!;
const PRO = PLANS.find((p) => p.id === "pro")!;
const firstYearPrice = (p: Plan) => (OFFER ? p.offerPrice : p.listPrice);
const MAX_SAVING = Math.max(...PLANS.map((p) => p.listPrice - p.offerPrice));

/* ------------------------------------------------------------------------------------------------
 * SEO
 * The root layout marks the whole app `noindex` (dashboards are private). The landing page is the
 * one public, indexable surface, so it overrides robots here and carries its own canonical, OG and
 * structured data.
 * ---------------------------------------------------------------------------------------------- */

const TITLE = "HRestroSewa — Restaurant & Hotel Management Software in Nepal";
const DESCRIPTION =
  "All-in-one restaurant POS and hotel management software for Nepal. Table orders, KOT, QR menu, billing, rooms, stock, staff & reports. Basic from Rs. 12,000/year, Pro from Rs. 15,000/year. 7-day free trial.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "restaurant management software Nepal",
    "restaurant POS Nepal",
    "hotel management software Nepal",
    "KOT software",
    "QR menu Nepal",
    "restaurant billing software",
    "lodge management system",
    "café POS",
    "HRestroSewa",
  ],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "HRestroSewa",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_NP",
    images: [{ url: "/hrestrosewa-logo.png", width: 1024, height: 1024, alt: "HRestroSewa" }],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/hrestrosewa-logo.png"],
  },
};

function StructuredData() {
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "HRestroSewa",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Android, iOS, Windows, macOS",
      description: DESCRIPTION,
      url: SITE_URL,
      offers: PLANS.map((p) => ({
        "@type": "Offer",
        name: `${p.name} plan (first year)`,
        price: firstYearPrice(p),
        priceCurrency: "NPR",
        description: `${p.bestFor}. Renews at ${formatRs(p.renewalPrice)} per year.`,
      })),
      publisher: { "@type": "Organization", name: "Leafclutch Technologies Pvt. Ltd." },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output contains no `</script>`: all values are our own constants.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/* ------------------------------------------------------------------------------------------------
 * Content
 * ---------------------------------------------------------------------------------------------- */

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#who", label: "Who it's for" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
  { href: "#contact", label: "Contact" },
];

const AUDIENCES = [
  {
    icon: UtensilsCrossed,
    title: "Restaurants, cafés & bars",
    body: "Run the floor, kitchen and counter from one screen. Perfect for up to 30 tables on Basic.",
    plan: "Basic",
  },
  {
    icon: BedDouble,
    title: "Hotels & lodges",
    body: "Rooms, stays, check-in/out and room bills — with your in-house restaurant included.",
    plan: "Pro",
  },
  {
    icon: Building2,
    title: "Large & multi-section venues",
    body: "Banquet halls, rooftop + ground floor, 30+ tables — no table limit on Pro.",
    plan: "Pro",
  },
];

const FEATURES = [
  {
    icon: UtensilsCrossed,
    title: "Tables & orders",
    body: "Open a table, take the order on any phone, add items, split or merge, and see every table's status live.",
  },
  {
    icon: ChefHat,
    title: "KOT & kitchen queues",
    body: "Orders go straight to the right workstation — kitchen, bar, bakery — with a live queue and ready alerts.",
  },
  {
    icon: QrCode,
    title: "QR menu & ordering",
    body: "Guests scan the table's QR code to see your menu with photos, order themselves, call a waiter or ask for the bill.",
  },
  {
    icon: Receipt,
    title: "Billing & payments",
    body: "Print bills, split them, take cash, card or wallet payments, and track customer credit (udharo).",
  },
  {
    icon: BedDouble,
    title: "Rooms & stays",
    body: "Manage rooms, guest stays and room bills, and move a restaurant order onto a guest's room. (Pro)",
  },
  {
    icon: Boxes,
    title: "Stock, purchases & vendors",
    body: "Record purchases, track stock levels, manage vendors and keep every expense in one ledger.",
  },
  {
    icon: Users,
    title: "Staff, attendance & salary",
    body: "Separate logins for admin and staff with quick PIN sign-in, attendance, salary tracking and deductions.",
  },
  {
    icon: ChartColumn,
    title: "Reports & finance",
    body: "Daily sales, item-wise sales, expenses and profit at a glance — plus a daily summary in your inbox.",
  },
  {
    icon: Smartphone,
    title: "Works on any device",
    body: "Install it like an app on Android, iPhone, tablet or PC. No costly POS machine needed.",
  },
];

const STEPS = [
  { n: "1", title: "Choose your plan", body: "Basic for up to 30 tables, Pro for 30+ tables or hotels." },
  { n: "2", title: "We set it up", body: "We add your menu, tables, rooms and staff, and train your team." },
  { n: "3", title: "Start serving", body: "Take orders, send KOTs and print bills from day one." },
];

/* ------------------------------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------------------------------- */

export default async function LandingPage() {
  const customers = await getLiveCustomers();
  return (
    <div
      data-landing-root
      suppressHydrationWarning
      className={`${st.root} min-h-screen bg-[var(--l-page)] text-[var(--l-ink)] antialiased`}
    >
      {/* Re-apply a stored Light/Dark choice before first paint (default follows the device via CSS). */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.currentScript.parentElement.setAttribute("data-theme",t)}catch(e){}})();`,
        }}
      />
      <StructuredData />
      <Reveal />
      <PageLoader />
      {OFFER && (
        <OfferPopup
          offerName={OFFER.name}
          claimHref={whatsappLink(offerEnquiry())}
          plans={PLANS.map((p) => ({
            name: p.name,
            tables: p.tables,
            listPrice: formatRs(p.listPrice),
            offerPrice: formatRs(p.offerPrice),
            saving: formatRs(p.listPrice - p.offerPrice),
            renewal: formatRs(p.renewalPrice),
            featured: p.featured,
          }))}
        />
      )}
      <Header />
      <main>
        <Hero customers={customers} />
        <CustomerStrip customers={customers} />
        <TrustBar />
        <Audience />
        <Features />
        <SmartFeatures />
        <Pricing />
        <HowItWorks />
        <Faq />
        <Contact />
      </main>
      <Footer />
      <WhatsAppFab />
    </div>
  );
}

/** WhatsApp's glyph — used only on the link that opens a WhatsApp chat. */
function WhatsAppGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.79-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.4 9.4 0 0 1-1.44-5.01c0-5.2 4.23-9.43 9.43-9.43 2.52 0 4.89.98 6.67 2.77a9.36 9.36 0 0 1 2.76 6.67c0 5.2-4.24 9.43-9.44 9.43m8.03-17.46A11.3 11.3 0 0 0 12.05.72C5.79.72.7 5.8.7 12.07c0 2 .52 3.95 1.52 5.67L.6 23.6l6-1.57a11.3 11.3 0 0 0 5.43 1.38h.01c6.26 0 11.35-5.09 11.35-11.35 0-3.03-1.18-5.88-3.32-8.02" />
    </svg>
  );
}

/**
 * Floating WhatsApp launcher, bottom-right: a round icon with an "unread" badge and an
 * always-visible "Book a demo" message pill beside it. Styles: .wa* in landing.module.css.
 */
function WhatsAppFab() {
  return (
    <a
      href={whatsappLink(DEMO_ENQUIRY)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Book a free demo on WhatsApp"
      className={`${st.waFab} group fixed bottom-4 right-4 z-40 flex items-end gap-3 sm:bottom-6 sm:right-6`}
    >
      {/* "Book a demo" message pill — always visible beside the launcher */}
      <span
        aria-hidden
        className={`${st.waPill} relative mb-10 flex items-center gap-2 whitespace-nowrap rounded-2xl rounded-br-md bg-[#ffffff] py-2.5 pl-3 pr-4 text-sm font-semibold text-[#0b1230] ring-1 ring-[#25d366]/30 sm:mb-12`}
      >
        <span className={`${st.waShine} pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]`} />
        <span className={`${st.waDot} relative flex size-2.5 shrink-0 rounded-full bg-[#25d366]`} />
        <span className="relative">
          Book a <span className="text-green-700">free</span> demo
        </span>
      </span>

      {/* Launcher */}
      <span
        className={`${st.waIcon} relative flex size-14 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white shadow-[0_14px_30px_-8px_rgba(37,211,102,0.65)] sm:size-16`}
      >
        <WhatsAppGlyph className="size-7 sm:size-8" />
        <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-[#ef4444] text-[11px] font-bold text-white ring-2 ring-white">
          1
        </span>
      </span>
    </a>
  );
}

/* ---------------------------------------------------------------------------------------------- */

/** Brand splash shown for ~1s on first paint; fades itself out (see .loader in the CSS). */
function PageLoader() {
  return (
    <div className={st.loader} aria-hidden>
      <div className={st.loaderMark}>
        <PlatformLogo size={76} priority />
      </div>
      <PlatformWordmark size={24} />
      <div className={st.loaderBar} />
    </div>
  );
}

function OfferRibbon() {
  if (!OFFER) return null;
  return (
    <div className="bg-gradient-to-r from-[#c2410c] via-[#ea580c] to-[#d97706] text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs sm:text-sm">
        <Sparkles className="hidden size-4 shrink-0 sm:block" aria-hidden />
        <p>
          <strong className="font-semibold">{OFFER.name}:</strong> save up to {formatRs(MAX_SAVING)}
          <span className="hidden lg:inline">
            {" "}on your first year — Basic {formatRs(BASIC.offerPrice)}, Pro {formatRs(PRO.offerPrice)}
          </span>
          .{" "}
          <a href="#pricing" className="whitespace-nowrap font-semibold underline underline-offset-2">
            See plans
          </a>
        </p>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-30">
      <OfferRibbon />
      <div className="border-b border-white/10 bg-[#0b1230]/95 backdrop-blur">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6"
        >
          <Link href="/" className="flex items-center gap-2" aria-label="HRestroSewa home">
            <PlatformLogo size={32} priority />
            <PlatformWordmark size={18} />
          </Link>
          <ul className="hidden items-center gap-7 text-sm text-white/70 lg:flex">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} className={`${st.link} pb-0.5 hover:text-white`}>
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className="hidden whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-white/80 transition-colors hover:text-white sm:inline-block"
            >
              Sign in
            </Link>
            <a
              href="#contact"
              className={`${st.btn} whitespace-nowrap rounded-full bg-[#22c55e] px-3.5 py-1.5 text-sm font-semibold sm:px-4 text-[#052e16] transition-colors hover:bg-[#4ade80]`}
            >
              Get started
            </a>
            <MobileMenu links={NAV} />
          </div>
        </nav>
      </div>
    </header>
  );
}

function Hero({ customers }: { customers: LiveCustomer[] }) {
  return (
    <section className="relative overflow-hidden bg-[#0b1230] text-white">
      {/* Soft colour wash — decorative only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 85% 10%, rgba(83,58,253,0.35) 0%, transparent 70%), radial-gradient(45% 40% at 0% 90%, rgba(34,197,94,0.18) 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-14 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pb-28 lg:pt-20">
        <div>
          <p className={`${st.rise} mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80`}>
            <span className={`${st.liveDot} size-1.5 rounded-full bg-[#4ade80]`} aria-hidden />
            <span>
              Made in Nepal<span className="hidden min-[400px]:inline"> for Nepali restaurants &amp; hotels</span>
            </span>
          </p>
          <h1 className={`${st.rise} text-[clamp(34px,5.6vw,60px)] font-light leading-[1.04] tracking-[-0.035em]`}>
            Restaurant &amp; hotel management,{" "}
            <span className="font-semibold text-[#4ade80]">all in one place.</span>
          </h1>
          <p className={`${st.rise2} mt-6 max-w-xl text-base leading-relaxed text-white/70 sm:text-lg`}>
            HRestroSewa runs your tables, KOTs, QR ordering, billing, rooms, stock, staff and daily
            reports — with instant order alerts on your staff&apos;s phones.
          </p>
          <div className={`${st.rise2} mt-8 flex flex-col gap-3 sm:flex-row`}>
            <a
              href="#pricing"
              className={`${st.btn} group inline-flex items-center justify-center gap-2 rounded-full bg-[#22c55e] px-6 py-3 text-sm font-semibold text-[#052e16] shadow-lg shadow-[#22c55e]/20 transition-colors hover:bg-[#4ade80]`}
            >
              See plans &amp; pricing <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </a>
            <a
              href="#contact"
              className={`${st.btn} inline-flex items-center justify-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10`}
            >
              Book a free demo
            </a>
          </div>
          <p className={`${st.rise2} mt-4 flex items-center gap-2 text-sm text-white/75`}>
            <Check className="size-4 shrink-0 text-[#4ade80]" aria-hidden />
            <span>
              <strong className="font-semibold text-white">{TRIAL}</strong> — try it in your restaurant before you pay.
            </span>
          </p>
          <dl className={`${st.rise3} mt-10 grid max-w-md grid-cols-3 gap-3 border-t sm:gap-4 border-white/10 pt-6`}>
            <HeroStat value={formatRs(Math.round(firstYearPrice(BASIC) / 12))} label="per month* on Basic" />
            <HeroStat value="30+" label="tables on Pro" />
            <HeroStat value="0" label="extra hardware" />
          </dl>
          <p className={`${st.rise3} mt-3 text-[11px] text-white/45`}>
            *{formatRs(firstYearPrice(BASIC))} first year ÷ 12 months{OFFER ? `, with the ${OFFER.short}` : ""}.
          </p>
        </div>
        <div className={st.riseMock}>
          <ProductMock customers={customers.slice(0, 3)} />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums min-[400px]:text-xl sm:text-2xl">{value}</dd>
      <dd className="mt-1 text-xs leading-snug text-white/55">{label}</dd>
    </div>
  );
}

/** A stylised, decorative picture of the floor screen — pure markup, no image to load. */
function ProductMock({ customers }: { customers: LiveCustomer[] }) {
  const tables: { n: number; s: "free" | "busy" | "bill" }[] = [
    { n: 1, s: "busy" }, { n: 2, s: "free" }, { n: 3, s: "bill" }, { n: 4, s: "busy" },
    { n: 5, s: "free" }, { n: 6, s: "busy" }, { n: 7, s: "busy" }, { n: 8, s: "free" },
    { n: 9, s: "bill" }, { n: 10, s: "free" }, { n: 11, s: "busy" }, { n: 12, s: "free" },
  ];
  const tone = {
    free: "border-white/10 bg-white/[0.03] text-white/50",
    busy: "border-[#4ade80]/40 bg-[#22c55e]/15 text-[#bbf7d0]",
    bill: "border-[#fb923c]/40 bg-[#f97316]/15 text-[#fed7aa]",
  } as const;

  return (
    <div aria-hidden className="relative mx-auto w-full max-w-lg">
      <div className="rounded-2xl border border-white/10 bg-[#111a3d] p-3 shadow-2xl shadow-black/40">
        <div className="mb-3 flex items-center gap-1.5 px-1">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="ml-3 text-[11px] text-white/40">Ground floor</span>
          <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-[#4ade80]">
            <span className={`${st.liveDot} size-1.5 rounded-full bg-[#4ade80]`} />
            Live
          </span>
        </div>
        <div className="grid grid-cols-[1fr_112px] gap-2 sm:grid-cols-[1fr_150px] sm:gap-3">
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {tables.map((t) => (
              <div
                key={t.n}
                className={`${st.tile} flex aspect-square flex-col items-center justify-center rounded-lg border text-xs ${tone[t.s]} ${t.n === 4 ? st.ping : ""}`}
              >
                <span className="text-sm font-semibold">T{t.n}</span>
                <span className="text-[9px] uppercase tracking-wide opacity-80">{t.s}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col rounded-lg border border-white/10 bg-white/[0.04] p-2.5 text-[10px] sm:p-3 sm:text-[11px]">
            <p className="mb-2 font-semibold text-white">Table 4 · KOT #218</p>
            {[
              ["Chicken Momo", "2", "640"],
              ["Thakali Set", "1", "550"],
              ["Masala Tea", "3", "240"],
            ].map(([item, q, p]) => (
              <div key={item} className="flex justify-between border-b border-white/5 py-1 text-white/70">
                <span>
                  {q}× {item}
                </span>
                <span className="tabular-nums">{p}</span>
              </div>
            ))}
            <div className="mt-auto flex justify-between pt-2 font-semibold text-white">
              <span>Total</span>
              <span className="tabular-nums">Rs. 1,430</span>
            </div>
            <div className="mt-2 rounded-md bg-[#22c55e] py-1.5 text-center font-semibold text-[#052e16]">
              Print bill
            </div>
          </div>
        </div>
      </div>
      <div className={`${st.float} absolute -bottom-5 left-2 flex items-center gap-2 rounded-xl border border-white/10 bg-[#111a3d] px-3 py-2 text-xs text-white shadow-xl sm:-left-6`}>
        <Bell className="size-4 text-[#4ade80]" />
        Kitchen: T4 order ready
      </div>
      {customers.map((c, i) => (
        <FloatingCustomer key={c.name} c={c} slot={i} />
      ))}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  lodge: "Lodge",
  guesthouse: "Guest house",
  hotel: "Hotel",
  resort: "Resort",
  restaurant_hotel: "Restaurant & Hotel",
};

/** A real customer's badge drifting beside the hero mockup (desktop only — no room on a phone). */
function FloatingCustomer({ c, slot }: { c: LiveCustomer; slot: number }) {
  const place = [
    `${st.floatSlow} -top-7 left-10`,
    `${st.floatAlt} -top-9 right-2`,
    `${st.float} -bottom-9 right-8`,
  ][slot];
  return (
    <div
      className={`${place} absolute hidden items-center gap-2.5 rounded-full border border-white/60 bg-white/95 py-1.5 pl-1.5 pr-4 text-[#0b1230] shadow-xl shadow-black/30 backdrop-blur lg:flex`}
    >
      <RestaurantLogo name={c.name} logoUrl={c.logoUrl} size={30} />
      <span className="flex flex-col leading-tight">
        <span className="max-w-[170px] truncate text-[13px] font-semibold">{c.name}</span>
        <span className="text-[10px] text-slate-500">Uses HRestroSewa</span>
      </span>
    </div>
  );
}

/** Paying customers, drifting past in an endless strip. Free (test) accounts never appear. */
function CustomerStrip({ customers }: { customers: LiveCustomer[] }) {
  if (customers.length === 0) return null;
  // Repeat a short list so one copy of the track is wider than the screen. Repeats are marked
  // `data-dup` so reduced-motion users (who get a static, wrapped list) see each name once.
  const copies = Math.max(1, Math.ceil(8 / customers.length));
  const base = Array.from({ length: copies }, () => customers).flat();
  const dupAttrs = { "data-dup": "", "aria-hidden": true } as const;
  const group = (dup: boolean) => (
    <ul className="flex shrink-0 gap-4 pr-4" {...(dup ? dupAttrs : {})}>
      {base.map((c, i) => (
        <li
          key={i}
          {...(!dup && i >= customers.length ? dupAttrs : {})}
          className={`${st.panel} flex shrink-0 items-center gap-3 rounded-full border bg-[var(--l-surface)] py-2 pl-2 pr-5`}
        >
          <RestaurantLogo name={c.name} logoUrl={c.logoUrl} size={36} />
          <span className="flex flex-col leading-tight">
            <span className="whitespace-nowrap text-sm font-semibold">{c.name}</span>
            {c.type && TYPE_LABEL[c.type] && <span className="text-xs text-[var(--l-mute)]">{TYPE_LABEL[c.type]}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-labelledby="customers-title" className="border-b border-[var(--l-line)] bg-[var(--l-surface)] py-10">
      <h2 id="customers-title" className="px-4 text-center text-sm text-[var(--l-body)]">
        Already running on HRestroSewa — restaurants and hotels across Nepal
      </h2>
      <div className={`${st.marquee} mt-6 overflow-hidden py-1`}>
        <div className={st.track} style={{ "--marquee-duration": `${base.length * 4}s` } as CSSProperties}>
          {group(false)}
          {group(true)}
        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  const items = [
    { icon: Smartphone, text: "Phone, tablet & PC" },
    { icon: ShieldCheck, text: "Secure cloud backup" },
    { icon: Wallet, text: "Cash, card & wallet payments" },
    { icon: Users, text: "Setup & training included" },
  ];
  return (
    <section aria-label="Highlights" className="border-b border-[var(--l-line)] bg-[var(--l-soft)]">
      <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-x-4 gap-y-3 px-4 py-5 text-sm text-[var(--l-body)] sm:px-6 md:grid-cols-4">
        {items.map(({ icon: Icon, text }) => (
          <li key={text} className={`${st.trust} flex items-center gap-2`}>
            <Icon className="size-4 shrink-0 text-[var(--l-green)]" aria-hidden />
            {text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionHeading({ eyebrow, title, body, id }: { eyebrow: string; title: string; body?: string; id: string }) {
  return (
    <div data-reveal className="mx-auto mb-8 max-w-2xl text-center sm:mb-12">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--l-green)]">{eyebrow}</p>
      <h2 id={id} className="text-[clamp(26px,3.6vw,38px)] font-light leading-tight tracking-[-0.02em]">
        {title}
      </h2>
      {body && <p className="mt-4 text-base leading-relaxed text-[var(--l-body)]">{body}</p>}
    </div>
  );
}

function Audience() {
  return (
    <section id="who" aria-labelledby="who-title" className="scroll-mt-28 px-4 py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="who-title"
          eyebrow="Who it's for"
          title="Built for every kind of hospitality business"
          body="Whether you run a 10-table café or a hotel with a restaurant, there is a plan sized for you."
        />
        <div className="grid gap-5 md:grid-cols-3">
          {AUDIENCES.map(({ icon: Icon, title, body, plan }, i) => (
            <article key={title} data-reveal style={rd(i)} className={`${st.card} rounded-2xl border border-[var(--l-line)] bg-[var(--l-surface)] p-6`}>
              <div className="mb-4 flex items-center justify-between">
                <span className={`${st.icon} flex size-11 items-center justify-center rounded-xl bg-[var(--l-indigo-soft)] text-[var(--l-indigo)]`}>
                  <Icon className="size-5" aria-hidden />
                </span>
                {plan === "Pro" ? (
                  <span className={`${st.proBadge} relative inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white`}>
                    <Crown className="relative size-3" aria-hidden />
                    <span className="relative">Pro plan</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--l-green-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--l-green-ink)] ring-1 ring-[var(--l-green-ring)]">
                    <Check className="size-3" aria-hidden />
                    Basic plan
                  </span>
                )}
              </div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--l-body)]">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className={`${st.glow} scroll-mt-28 bg-[var(--l-soft)] px-4 py-14 sm:px-6 sm:py-20`}>
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="features-title"
          eyebrow="Features"
          title="Everything your restaurant or hotel needs"
          body="One system for the front of house, the kitchen, the rooms and the back office — no more paper KOTs or separate spreadsheets."
        />
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            // Phones: icon beside the text (a compact row). From sm up: the stacked card.
            <article
              key={title}
              data-reveal
              style={rd(i % 3)}
              className={`${st.card} grid grid-cols-[auto_1fr] gap-x-4 rounded-2xl border border-[var(--l-line)] bg-[var(--l-surface)] p-5 sm:block sm:p-6`}
            >
              <span className={`${st.icon} row-span-2 flex size-10 items-center justify-center rounded-lg bg-[var(--l-green-soft)] text-[var(--l-green)] sm:mb-4`}>
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--l-body)] sm:mt-2">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}


/* ---------------------------------------------------------------------------------------------- */

const GUEST_POINTS = [
  { icon: ScanLine, text: "Scan the QR code on the table — no app to download" },
  { icon: Receipt, text: "Browse the menu with photos, prices and allergy info" },
  { icon: HandPlatter, text: "Order, call a waiter or ask for the bill in one tap" },
  { icon: RefreshCw, text: "See their order status update live" },
];
const STAFF_POINTS = [
  { icon: Download, text: "Install the HRestroSewa app from the browser — no app store" },
  { icon: BellRing, text: "Instant alerts for new orders, waiter calls and bill requests" },
  { icon: Check, text: "Approve a new table right from the notification" },
  { icon: Smartphone, text: "Works on Android, iPhone, tablets and PCs" },
];
const EXTRAS = [
  { icon: RefreshCw, title: "Live on every device", body: "An order taken on one phone shows up on the kitchen screen and the counter at once." },
  { icon: WifiOff, title: "Safe when internet drops", body: "A clear offline warning, and bills or orders are never saved half-way." },
  { icon: Mail, title: "Daily summary email", body: "Today's sales and totals land in the owner's inbox every day." },
  { icon: BedDouble, title: "Room QR ordering (Pro)", body: "Hotel guests order from their room, and you can move a table's bill to a room." },
];

function SmartFeatures() {
  return (
    <section id="smart" aria-labelledby="smart-title" className="scroll-mt-28 px-4 py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="smart-title"
          eyebrow="Smart features"
          title="Your guests order from their phone. Your staff hear about it instantly."
          body="Less running between tables, fewer missed orders, faster bills."
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <Spotlight
            badge="QR menu"
            title="Guests scan, browse and order"
            body="Put a QR code on every table. Guests see your live menu on their own phone and order without waiting for a waiter."
            points={GUEST_POINTS}
            visual={<GuestPhone />}
            index={0}
          />
          <Spotlight
            badge="Staff app"
            title="Staff get notified on their phone"
            body="Every waiter carries the HRestroSewa app. New orders and requests pop up as notifications, even when the app is closed."
            points={STAFF_POINTS}
            visual={<StaffAlerts />}
            index={1}
          />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {EXTRAS.map(({ icon: Icon, title, body }, i) => (
            <article key={title} data-reveal style={rd(i)} className={`${st.card} rounded-2xl border bg-[var(--l-surface)] p-5`}>
              <span className={`${st.icon} mb-3 flex size-9 items-center justify-center rounded-lg bg-[var(--l-green-soft)] text-[var(--l-green)]`}>
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--l-body)]">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Spotlight({
  badge,
  title,
  body,
  points,
  visual,
  index,
}: {
  badge: string;
  title: string;
  body: string;
  points: { icon: typeof Check; text: string }[];
  visual: React.ReactNode;
  index: number;
}) {
  return (
    <article
      data-reveal
      style={rd(index)}
      className={`${st.card} grid overflow-hidden rounded-3xl border bg-[var(--l-surface)] sm:grid-cols-[1fr_200px]`}
    >
      <div className="p-6 sm:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--l-green-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--l-green-ink)] ring-1 ring-[var(--l-green-ring)]">
          {badge}
        </span>
        <h3 className="mt-4 text-xl font-semibold tracking-[-0.01em] sm:text-2xl">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-[var(--l-body)]">{body}</p>
        <ul className="mt-5 space-y-2.5">
          {points.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-2.5 text-sm">
              <Icon className="mt-0.5 size-4 shrink-0 text-[var(--l-green)]" aria-hidden />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div aria-hidden className="relative flex items-center justify-center bg-[#0b1230] px-6 py-8 sm:px-4">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(70% 60% at 50% 30%, rgba(34,197,94,0.22) 0%, transparent 70%)" }}
        />
        {visual}
      </div>
    </article>
  );
}

/** Decorative: a guest's phone showing the QR menu. */
function GuestPhone() {
  const items: [string, string][] = [
    ["Chicken Momo", "320"],
    ["Veg Thukpa", "260"],
    ["Masala Tea", "80"],
  ];
  return (
    <div className={`${st.floatSlow} relative w-[150px] rounded-[26px] border-4 border-[#1f2a4d] bg-white p-2.5 text-[#0b1230] shadow-2xl shadow-black/50`}>
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
      <p className="text-[9px] font-semibold text-slate-500">Table 4 · Menu</p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map(([n, p]) => (
          <li key={n} className="flex items-center gap-1.5 rounded-lg bg-slate-50 p-1.5">
            <span className="size-6 shrink-0 rounded-md bg-gradient-to-br from-orange-200 to-amber-300" />
            <span className="flex-1 text-[9px] font-semibold leading-tight">{n}</span>
            <span className="text-[9px] text-slate-500">{p}</span>
            <span className="flex size-4 items-center justify-center rounded-full bg-[#22c55e] text-[10px] font-bold leading-none text-white">+</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <span className="rounded-md bg-slate-100 py-1 text-center text-[8px] font-semibold">Call waiter</span>
        <span className="rounded-md bg-slate-100 py-1 text-center text-[8px] font-semibold">Ask bill</span>
      </div>
      <div className="mt-1.5 rounded-md bg-[#22c55e] py-1.5 text-center text-[9px] font-bold text-[#052e16]">Place order · Rs. 660</div>
    </div>
  );
}

/** Decorative: notifications arriving on a staff phone. */
function StaffAlerts() {
  const alerts = [
    { t: "New QR order", d: "Table 4 · 3 items", cls: st.float },
    { t: "Call waiter", d: "Table 7", cls: st.floatAlt },
    { t: "Bill requested", d: "Room 203", cls: st.floatSlow },
  ];
  return (
    <div className="relative flex w-full max-w-[190px] flex-col gap-2">
      {alerts.map((a, i) => (
        <div
          key={a.t}
          className={`${a.cls} flex items-start gap-2 rounded-xl bg-white/95 p-2.5 text-[#0b1230] shadow-xl shadow-black/40`}
          style={{ marginLeft: i === 1 ? 12 : 0 }}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#0b1230]">
            <BellRing className="size-3.5 text-[#4ade80]" />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="flex items-center justify-between gap-1 text-[10px] font-bold">
              {a.t} <span className="text-[8px] font-normal text-slate-400">now</span>
            </span>
            <span className="block text-[9px] text-slate-500">{a.d}</span>
            {i === 0 && (
              <span className="mt-1.5 flex gap-1">
                <span className="rounded bg-[#22c55e] px-1.5 py-0.5 text-[8px] font-bold text-[#052e16]">Approve</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[8px] font-semibold">Reject</span>
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-28 px-4 py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <SectionHeading
          id="pricing-title"
          eyebrow="Pricing"
          title="Simple yearly plans. No hidden charges."
          body="Pay once for the first year, then a lower renewal fee every year after. Pick the plan by the size of your business."
        />

        {OFFER && (
          <p className="mx-auto -mt-4 mb-3 flex w-fit items-center gap-2 rounded-full bg-[var(--l-orange-wash)] px-4 py-1.5 text-sm font-medium text-[var(--l-orange)] ring-1 ring-[var(--l-orange-ring)]">
            <Sparkles className="size-4" aria-hidden />
            {OFFER.name} is live — save up to {formatRs(MAX_SAVING)} on the first year
          </p>
        )}

        <p data-reveal className="mx-auto mb-8 flex w-fit max-w-full items-center gap-2 rounded-2xl bg-[var(--l-green-wash)] px-4 py-2 text-center text-sm text-[var(--l-green-ink)] ring-1 ring-[var(--l-green-ring)]">
          <Check className="size-4 shrink-0" aria-hidden />
          <span>
            Not sure yet? Start with a <strong>one-week free trial</strong> — we set it up for you.
          </span>
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          {PLANS.map((p, i) => (
            <PlanCard key={p.id} plan={p} index={i} />
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-[var(--l-mute)]">
          Prices in Nepali Rupees (NPR). First-year fee is the first installment; renewal is charged yearly from year two.
        </p>

        <CostTable />
        <Comparison />
      </div>
    </section>
  );
}

function PlanCard({ plan: p, index }: { plan: Plan; index: number }) {
  const firstYear = firstYearPrice(p);
  const dark = p.featured;
  return (
    <article
      data-reveal
      style={rd(index)}
      className={`${st.card} ${dark ? st.cardDark : ""} relative flex flex-col rounded-3xl p-6 sm:p-8 ${
        dark ? "bg-[#0b1230] text-white shadow-2xl shadow-[#0b1230]/25 ring-1 ring-white/10" : "border border-[var(--l-line)] bg-[var(--l-surface)]"
      }`}
    >
      {/* Same badge language as "Who it's for": violet crown for Pro, green tick for Basic. */}
      {dark ? (
        <span
          className={`${st.proBadge} absolute -top-3 right-7 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white`}
        >
          <Crown className="relative size-3.5" aria-hidden />
          <span className="relative">Restaurant + Hotel</span>
        </span>
      ) : (
        <span className="absolute -top-3 right-7 inline-flex items-center gap-1.5 rounded-full bg-[var(--l-surface)] px-3 py-1 text-xs font-semibold text-[var(--l-green-ink)] shadow-sm ring-1 ring-[var(--l-green-ring)]">
          <span className="absolute inset-0 rounded-full bg-[var(--l-green-soft)]" aria-hidden />
          <Check className="relative size-3.5" aria-hidden />
          <span className="relative">Best for restaurants</span>
        </span>
      )}
      <h3 className="text-2xl font-semibold">{p.name}</h3>
      <p className={`mt-1 text-sm ${dark ? "text-white/65" : "text-[var(--l-body)]"}`}>{p.tagline}</p>

      <div className={`mt-5 inline-flex w-fit items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${dark ? "bg-white/10" : "bg-[var(--l-soft)]"}`}>
        <Store className="size-4" aria-hidden />
        {p.tables}
      </div>

      <div className="mt-6">
        {OFFER && (
          <p className={`text-sm ${dark ? "text-white/50" : "text-[var(--l-mute)]"}`}>
            <span className="line-through">{formatRs(p.listPrice)}</span>
            <span className="ml-2 rounded bg-[#f97316] px-1.5 py-0.5 text-[11px] font-semibold text-white">
              Save {formatRs(p.listPrice - p.offerPrice)}
            </span>
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
          <span className="whitespace-nowrap text-4xl font-semibold tracking-tight tabular-nums lg:text-5xl">{formatRs(firstYear)}</span>
          <span className={`text-sm ${dark ? "text-white/60" : "text-[var(--l-mute)]"}`}>/ first year</span>
        </p>
        <p className={`mt-2 text-sm ${dark ? "text-white/70" : "text-[var(--l-body)]"}`}>
          Renews at <strong className="font-semibold">{formatRs(p.renewalPrice)}</strong>/year from year 2
        </p>
        <p className={`mt-1 text-xs ${dark ? "text-white/45" : "text-[var(--l-mute)]"}`}>
          ≈ {formatRs(Math.round(firstYear / 12))} per month in year one
        </p>
      </div>

      <ul className="mt-7 space-y-3 text-sm">
        {p.highlights.map((h) => (
          <li key={h} className="flex gap-2.5">
            <Check className={`mt-0.5 size-4 shrink-0 ${dark ? "text-[#4ade80]" : "text-[var(--l-green)]"}`} aria-hidden />
            <span>{h}</span>
          </li>
        ))}
      </ul>

      <a
        href={whatsappLink(planEnquiry(p))}
        target="_blank"
        rel="noopener noreferrer"
        className={`${st.btn} mt-8 inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-colors ${
          dark ? "bg-[#22c55e] text-[#052e16] hover:bg-[#4ade80]" : "bg-[var(--l-strong-bg)] text-[var(--l-strong-fg)] hover:bg-[var(--l-strong-hover)]"
        }`}
      >
        <MessageCircle className="size-4" aria-hidden /> Get {p.name} on WhatsApp
      </a>
      <p className={`mt-3 text-center text-xs ${dark ? "text-white/50" : "text-[var(--l-mute)]"}`}>Best for: {p.bestFor}</p>
      <p className={`mt-1 text-center text-xs font-medium ${dark ? "text-[#4ade80]" : "text-[var(--l-green)]"}`}>Includes a {TRIAL}</p>
    </article>
  );
}

/** Year-by-year cost, so a buyer sees the full price picture rather than only the first year. */
function CostTable() {
  return (
    <div data-reveal className="mt-12 sm:mt-16">
      <h3 className="mb-4 text-center text-lg font-semibold">What you pay, year by year</h3>
      <div className={`${st.panel} overflow-x-auto rounded-2xl border bg-[var(--l-surface)]`}>
        <table className="w-full text-[13px] sm:text-sm">
          <caption className="sr-only">Yearly cost of the Basic and Pro plans</caption>
          <thead className="bg-[var(--l-soft)] text-left text-[var(--l-body)]">
            <tr>
              <th scope="col" className="px-3 py-3 sm:px-5 font-medium"></th>
              {PLANS.map((p) => (
                <th key={p.id} scope="col" className="px-3 py-3 sm:px-5 font-semibold text-[var(--l-ink)]">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--l-line)] tabular-nums">
            <tr>
              <th scope="row" className="px-3 py-3 sm:px-5 text-left font-medium">
                Year 1 {OFFER ? <span className="block font-normal text-[var(--l-orange)] sm:inline">({OFFER.short})</span> : null}
              </th>
              {PLANS.map((p) => (
                <td key={p.id} className="px-3 py-3 sm:px-5">
                  <strong>{formatRs(firstYearPrice(p))}</strong>
                  {OFFER && <span className="block text-xs text-[var(--l-mute)] line-through sm:ml-2 sm:inline">{formatRs(p.listPrice)}</span>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="px-3 py-3 sm:px-5 text-left font-medium">Year 2 onward (renewal)</th>
              {PLANS.map((p) => (
                <td key={p.id} className="px-3 py-3 sm:px-5">{formatRs(p.renewalPrice)}<span className="text-[var(--l-mute)]"> / year</span></td>
              ))}
            </tr>
            <tr className="bg-[var(--l-green-wash)]">
              <th scope="row" className="px-3 py-3 sm:px-5 text-left font-medium">Total for 2 years</th>
              {PLANS.map((p) => (
                <td key={p.id} className="px-3 py-3 sm:px-5 font-semibold">
                  {formatRs(firstYearPrice(p) + p.renewalPrice)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Comparison() {
  return (
    <div data-reveal className="mt-12 sm:mt-16">
      <h3 className="mb-4 text-center text-lg font-semibold">Compare plans</h3>
      <div className={`${st.panel} overflow-x-auto rounded-2xl border bg-[var(--l-surface)]`}>
        <table className="w-full text-[13px] sm:text-sm">
          <caption className="sr-only">Feature comparison of Basic and Pro</caption>
          <thead className="bg-[var(--l-soft)] text-left">
            <tr>
              <th scope="col" className="px-3 py-3 sm:px-5 font-medium text-[var(--l-body)]">Feature</th>
              <th scope="col" className="w-[72px] px-2 py-3 sm:w-36 sm:px-5 text-center font-semibold">Basic</th>
              <th scope="col" className="w-[72px] px-2 py-3 sm:w-36 sm:px-5 text-center font-semibold">Pro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--l-line)]">
            {COMPARISON.map((row) => (
              <tr key={row.label} className={st.row}>
                <th scope="row" className="px-3 py-3 sm:px-5 text-left font-normal text-[var(--l-body)]">{row.label}</th>
                <CompareCell v={row.basic} />
                <CompareCell v={row.pro} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareCell({ v }: { v: string | boolean }) {
  return (
    <td className="px-3 py-3 sm:px-5 text-center">
      {v === true ? (
        <>
          <Check className="mx-auto size-4 text-[var(--l-green)]" aria-hidden />
          <span className="sr-only">Included</span>
        </>
      ) : v === false ? (
        <>
          <Minus className="mx-auto size-4 text-[var(--l-faint)]" aria-hidden />
          <span className="sr-only">Not included</span>
        </>
      ) : (
        <span className="font-medium">{v}</span>
      )}
    </td>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className={`${st.glow} bg-[var(--l-soft)] px-4 py-14 sm:px-6 sm:py-20`}>
      <div className="mx-auto max-w-5xl">
        <SectionHeading id="how-title" eyebrow="Getting started" title="Up and running in three steps" />
        <ol className="grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.n} data-reveal style={rd(i)} className={`${st.card} rounded-2xl border border-[var(--l-line)] bg-[var(--l-surface)] p-6`}>
              <span className={`${st.icon} flex size-9 items-center justify-center rounded-full bg-[var(--l-strong-bg)] text-sm font-semibold text-[var(--l-strong-fg)]`}>
                {s.n}
              </span>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--l-body)]">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-28 px-4 py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <SectionHeading id="faq-title" eyebrow="FAQ" title="Frequently asked questions" />
        <div data-reveal className={`${st.panel} divide-y divide-[var(--l-line)] overflow-hidden rounded-2xl border bg-[var(--l-surface)]`}>
          {FAQ.map((f) => (
            <details key={f.q} className={`${st.faq} group px-5 py-4 [&_summary::-webkit-details-marker]:hidden`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                <h3 className="text-[15px]">{f.q}</h3>
                <span className="text-xl leading-none text-[var(--l-mute)] transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-[var(--l-body)]">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Contact() {
  const whatsapp = whatsappLink(GENERAL_ENQUIRY);
  const channels = [
    {
      icon: MessageCircle,
      title: "WhatsApp",
      value: CONTACT.phoneDisplay,
      body: "Send us a message and we'll reply with prices, a demo time, or answers to your questions.",
      href: whatsapp,
      cta: "Message on WhatsApp",
      external: true,
      primary: true,
    },
    {
      icon: Phone,
      title: "Call us",
      value: CONTACT.phoneDisplay,
      body: "Talk to us directly about your restaurant or hotel and which plan fits.",
      href: CONTACT.phoneHref,
      cta: "Call now",
    },
    {
      icon: Mail,
      title: "Email",
      value: CONTACT.email,
      body: "Prefer email? Write to us with your details and we'll get back to you.",
      href: `mailto:${CONTACT.email}`,
      cta: "Send an email",
    },
  ];

  return (
    <section id="contact" aria-labelledby="contact-title" className="scroll-mt-28 px-4 py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="contact-title"
          eyebrow="Contact"
          title="Talk to us about your restaurant or hotel"
          body="Ask for a free demo, get help choosing between Basic and Pro, or claim the festive offer. We'll set everything up for you."
        />

        <div className="grid gap-5 md:grid-cols-3">
          {channels.map(({ icon: Icon, title, value, body, href, cta, external, primary }, i) => (
            <article
              key={title}
              data-reveal
              style={rd(i)}
              className={`${st.card} ${primary ? st.cardDark : ""} flex flex-col rounded-2xl p-6 ${
                primary ? "bg-[#0b1230] text-white shadow-2xl shadow-[#0b1230]/20 ring-1 ring-white/10" : "border border-[var(--l-line)] bg-[var(--l-surface)]"
              }`}
            >
              <span
                className={`${st.icon} mb-4 flex size-11 items-center justify-center rounded-xl ${
                  primary ? "bg-[#22c55e] text-[#052e16]" : "bg-[var(--l-green-soft)] text-[var(--l-green)]"
                }`}
              >
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className={`mt-1 break-all font-medium ${primary ? "text-[#4ade80]" : "text-[var(--l-green)]"}`}>{value}</p>
              <p className={`mt-3 flex-1 text-sm leading-relaxed ${primary ? "text-white/70" : "text-[var(--l-body)]"}`}>{body}</p>
              <a
                href={href}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={`${st.btn} mt-6 inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-colors ${
                  primary
                    ? "bg-[#22c55e] text-[#052e16] hover:bg-[#4ade80]"
                    : "border border-[var(--l-line)] text-[var(--l-ink)] hover:bg-[var(--l-soft)]"
                }`}
              >
                {cta}
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--l-line)] bg-[var(--l-soft)] px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <span className="flex items-center gap-2">
            <PlatformLogo size={28} />
            <span className={st.onlyLight}>
              <PlatformWordmark size={17} tone="dark" />
            </span>
            <span className={st.onlyDark}>
              <PlatformWordmark size={17} tone="light" />
            </span>
          </span>
          <p className="mt-3 text-sm text-[var(--l-body)]">
            Restaurant and hotel management software for Nepal — tables, KOT, QR menu, billing, rooms, stock, staff and reports.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm text-[var(--l-body)]">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={`${st.link} w-fit hover:text-[var(--l-ink)]`}>
              {n.label}
            </a>
          ))}
          <Link href="/login" className={`${st.link} w-fit hover:text-[var(--l-ink)]`}>Sign in</Link>
        </nav>
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-col items-center justify-between gap-4 border-t border-[var(--l-line)] pt-6 sm:flex-row">
        <p className="text-xs text-[var(--l-mute)]">
          &copy; {new Date().getFullYear()} HRestroSewa — Hospitality Management Platform
        </p>
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <ThemeSwitch />
          <span className={st.onlyLight}>
            <PoweredBy height={18} />
          </span>
          <span className={st.onlyDark}>
            <PoweredBy height={18} tone="light" />
          </span>
        </div>
      </div>
    </footer>
  );
}
