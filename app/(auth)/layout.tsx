import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { PlatformLogo, PlatformWordmark } from "@/components/branding/platform-logo";

/**
 * Sign-in shell, in the marketing site's visual language: a navy brand panel beside the form on
 * large screens, a compact navy header above it on phones. Purely presentational — every auth
 * decision stays in the login page and its components.
 */
const POINTS = [
  "Table orders, KOT & billing",
  "Rooms & guest stays (Pro)",
  "Stock, staff & salary tracking",
  "Daily sales reports",
];

const TILES = ["busy", "free", "bill", "busy", "free", "busy", "busy", "free"] as const;
const TILE_TONE = {
  free: "border-white/10 bg-white/[0.03]",
  busy: "border-[#4ade80]/40 bg-[#22c55e]/15",
  bill: "border-[#fb923c]/40 bg-[#f97316]/15",
} as const;

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f9fc] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Brand panel — desktop */}
      <aside className="relative hidden overflow-hidden bg-[#0b1230] text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 90% 0%, rgba(83,58,253,0.35) 0%, transparent 70%), radial-gradient(50% 45% at 0% 100%, rgba(34,197,94,0.2) 0%, transparent 70%)",
          }}
        />
        <Link href="/" className="relative flex w-fit items-center gap-2.5" aria-label="HRestroSewa home">
          <PlatformLogo size={40} priority />
          <PlatformWordmark size={22} />
        </Link>

        <div className="relative max-w-md">
          <h2 className="text-[clamp(30px,3vw,42px)] font-light leading-[1.08] tracking-[-0.03em]">
            Your restaurant &amp; hotel,{" "}
            <span className="font-semibold text-[#4ade80]">all in one place.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/65">
            Sign in to take orders, send KOTs, print bills and see today&apos;s sales — from any phone, tablet or PC.
          </p>
          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-white/80">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-[#4ade80]" aria-hidden />
                {p}
              </li>
            ))}
          </ul>

          {/* A sliver of the floor screen, for recognition — decorative. */}
          <div aria-hidden className="mt-10 grid w-fit grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-[#111a3d] p-3">
            {TILES.map((s, i) => (
              <span
                key={i}
                className={`flex size-12 flex-col items-center justify-center rounded-lg border text-[11px] font-semibold text-white/80 ${TILE_TONE[s]}`}
              >
                T{i + 1}
                <span className="text-[8px] font-normal uppercase tracking-wide opacity-70">{s}</span>
              </span>
            ))}
          </div>
        </div>

        <Link
          href="/"
          className="relative flex w-fit items-center gap-2 text-sm text-white/60 transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to website
        </Link>
      </aside>

      {/* Phone / tablet header */}
      <header className="flex items-center justify-between bg-[#0b1230] px-4 py-3 sm:px-6 lg:hidden">
        <Link href="/" className="flex items-center gap-2" aria-label="HRestroSewa home">
          <PlatformLogo size={32} priority />
          <PlatformWordmark size={18} />
        </Link>
        <Link href="/" className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> Website
        </Link>
      </header>

      {/* Form column */}
      <main className="flex min-h-[calc(100vh-56px)] items-start justify-center px-4 py-10 sm:items-center sm:px-6 lg:min-h-screen lg:py-12">
        {children}
      </main>
    </div>
  );
}
