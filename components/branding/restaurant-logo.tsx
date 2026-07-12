import Image from "next/image";

/**
 * RESTAURANT branding — the tenant's own identity.
 *
 * Renders the uploaded logo, falling back to the initials monogram that used to
 * be hard-coded in the customer menu.
 *
 * The fallback is STRUCTURAL, not conditional: the monogram is always painted,
 * and the logo is layered on top of it. So a logo that is missing, still
 * loading, or 404s (a stale `logo_url`, a deleted storage object) simply reveals
 * the initials underneath — no client-side `onError`, no flash of an empty box,
 * and it works in a server component.
 */

export function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export function RestaurantLogo({
  name,
  logoUrl,
  size = 40,
  /** `plain` drops the gradient — for use on an already-tinted surface (the hero). */
  variant = "brand",
  /** The header logo is above the fold; everything else can wait. */
  priority = false,
  className = "",
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  variant?: "brand" | "plain";
  priority?: boolean;
  className?: string;
}) {
  const radius = Math.max(8, Math.round(size * 0.28));

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background:
          variant === "brand"
            ? "linear-gradient(135deg, var(--color-primary), var(--color-brand-dark))"
            : "rgba(255,255,255,0.16)",
        color: "#fff",
        fontWeight: 600,
        fontSize: Math.round(size * 0.36),
        letterSpacing: "-0.5px",
      }}
    >
      {/* Always painted — this is what shows through if the logo never arrives. */}
      <span aria-hidden={logoUrl ? "true" : undefined}>{initialsOf(name)}</span>

      {logoUrl && (
        <Image
          src={logoUrl}
          alt={name}
          fill
          // The slot is square but a logo rarely is: `contain` shows the whole
          // mark rather than cropping it, on a white plate so a transparent PNG
          // designed for light backgrounds stays legible on our dark gradient.
          sizes={`${size}px`}
          priority={priority}
          style={{ objectFit: "contain", background: "#fff" }}
        />
      )}
    </div>
  );
}
