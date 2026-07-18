import Image from "next/image";

/**
 * PLATFORM branding — HRestroSewa, the application's own identity (H = Hotel, R = Restaurant).
 *
 * The wordmark was hand-rolled in several places with slightly different sizes and accent colours.
 * It lives here now so every surface renders the same mark; if the brand ever changes, it changes
 * once. There is also an emblem image (`public/hrestrosewa-logo.png`, rendered by `<PlatformLogo />`)
 * used on the login, super-admin and marketing surfaces; this text wordmark is the compact form.
 *
 * `public/logo.png` is a SEPARATE asset — the Leafclutch Technologies mark, the company behind the
 * product — and appears only as the `<PoweredBy />` credit below.
 */

type Tone = "light" | "dark";

// The accent falls on "Sewa", in the brand green taken from the logo. On a dark background the light
// logo green (#76d38b) sits right; on a light one it would be too pale (~1.7:1), so drop to a
// readable forest green.
const ACCENT: Record<Tone, string> = {
  light: "#76d38b", // on a dark background — the logo's own light green
  dark: "#15803d", // on a light background — legible green
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
      HRestro
      <span style={{ color: accent ?? ACCENT[tone], fontWeight: 500 }}>Sewa</span>
    </span>
  );
}

/**
 * The HRestroSewa emblem — the navy tile with the house-H, cloche and fork/spoon. A self-contained
 * square badge (it carries its own background), so it reads on any surface; used on the login,
 * super-admin and marketing pages. `public/hrestrosewa-logo.png` is the one canonical emblem asset
 * (1024², ~100 KB, space-free name) — shared with the PWA icon generator.
 */
export function PlatformLogo({
  size = 48,
  className = "",
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/hrestrosewa-logo.png"
      alt="HRestroSewa"
      width={size}
      height={size}
      priority={priority}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
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
  const onDark = tone === "light";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}
      // The Leafclutch lockup is navy text + a green leaf on transparent, designed for a LIGHT
      // background. On a dark surface it used to be flattened to a white silhouette
      // (`brightness(0) invert(1)`), which threw its own colours away. Instead the WHOLE credit —
      // "Powered by" text + logo — becomes one white sticker so the mark keeps its real colours and
      // reads as a deliberate badge, not a logo floating on a stray white patch. The text colour is
      // a FIXED slate (not the ink-mute token) because the sticker is always white, even when the
      // surrounding app is in dark mode (where ink-mute flips light and would wash out on white).
      style={
        onDark
          ? {
              background: "#fff",
              color: "#64748b",
              borderRadius: 9999,
              padding: "3px 8px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }
          : { color: "var(--color-ink-mute)" }
      }
    >
      <span style={{ fontSize: 9, letterSpacing: "0.04em" }}>Powered by</span>
      <Image
        src="/logo.png"
        alt="Leafclutch Technologies Pvt. Ltd."
        width={width}
        height={height}
        // The credit is never above the fold on any screen that matters, so it
        // must never compete with the page for bandwidth.
        loading="lazy"
        style={{ height, width: "auto" }}
      />
    </span>
  );
}
