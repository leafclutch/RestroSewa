import Image from "next/image";

/**
 * PLATFORM branding — RestroSewa, the application's own identity.
 *
 * The wordmark was hand-rolled in five places with slightly different sizes and
 * accent colours. It lives here now so every surface renders the same mark; if
 * the brand ever changes, it changes once.
 *
 * RestroSewa is a TEXT wordmark by design — there is no RestroSewa image asset.
 * The logo in `public/logo.png` belongs to Leafclutch Technologies, the company
 * behind the product, and appears only as the `<PoweredBy />` credit below.
 */

type Tone = "light" | "dark";

// The accent falls on "Sewa". Light surfaces need the deeper brand colour to
// stay legible; dark surfaces use the soft tint.
const ACCENT: Record<Tone, string> = {
  light: "var(--color-primary-soft)", // on a dark background
  dark: "var(--color-primary)", // on a light background
};

const BASE: Record<Tone, string> = {
  light: "#fff",
  dark: "var(--color-ink)",
};

export function PlatformWordmark({
  size = 16,
  tone = "light",
  accent,
  letterSpacing,
  className = "",
}: {
  /**
   * Font size. A number is px; a string passes through, so the marketing hero can
   * stay fluid (`clamp(30px, 8vw, 48px)`) instead of being hand-rolled again.
   */
  size?: number | string;
  /** `light` = white text for a dark background; `dark` = ink text for a light one. */
  tone?: Tone;
  /** Overrides the accent on "Sewa" (the marketing hero uses lemon). */
  accent?: string;
  letterSpacing?: string;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        fontSize: size,
        fontWeight: 300,
        letterSpacing:
          letterSpacing ?? (typeof size === "number" && size > 30 ? "-0.8px" : "-0.3px"),
        color: BASE[tone],
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      Restro
      <span style={{ color: accent ?? ACCENT[tone], fontWeight: 500 }}>Sewa</span>
    </span>
  );
}

/**
 * The Leafclutch Technologies credit. `public/logo.png` is a 500×138 horizontal
 * lockup that already contains the company's name, so it is sized by HEIGHT and
 * never cropped into a square avatar slot.
 */
export function PoweredBy({
  height = 20,
  tone = "dark",
  className = "",
}: {
  height?: number;
  tone?: Tone;
  className?: string;
}) {
  const width = Math.round(height * (500 / 138));
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      style={{ color: tone === "light" ? "rgba(255,255,255,0.45)" : "var(--color-ink-mute)" }}
    >
      <span style={{ fontSize: 10, letterSpacing: "0.06em" }}>Powered by</span>
      <Image
        src="/logo.png"
        alt="Leafclutch Technologies Pvt. Ltd."
        width={width}
        height={height}
        // The credit is never above the fold on any screen that matters, so it
        // must never compete with the page for bandwidth.
        loading="lazy"
        style={{
          height,
          width: "auto",
          // The mark is dark navy on transparent; on a dark surface it would
          // disappear, so lift it.
          filter: tone === "light" ? "brightness(0) invert(1) opacity(0.55)" : undefined,
        }}
      />
    </span>
  );
}
