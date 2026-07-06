import Link from "next/link";

const FEATURES = [
  {
    title: "Table & Session Management",
    description: "Open tables, track active sessions, and manage walk-ins from one clean interface.",
  },
  {
    title: "Multi-Role Access",
    description: "Separate dashboards for restaurant admins, staff, and platform super admins.",
  },
  {
    title: "Menu & Workstation Control",
    description: "Manage menu categories, items, and workstation queues in real time.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--color-canvas)" }}>
      {/* Nav */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-4 sm:px-8 py-3 border-b"
        style={{
          background: "rgba(15,13,7,0.92)",
          borderColor: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(10px)",
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 300,
            letterSpacing: "-0.4px",
            color: "#fff",
          }}
        >
          Restro<span style={{ color: "var(--color-lemon)", fontWeight: 500 }}>Sewa</span>
        </span>
        <Link
          href="/login"
          className="text-sm px-4 py-1.5 rounded-full transition-all"
          style={{
            background: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.8)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section
        className="flex flex-col items-center justify-center px-4 sm:px-6 py-16 sm:py-24 text-center"
        style={{
          background: "linear-gradient(135deg, #0f0d07 0%, #1c1a0e 50%, #100c06 100%)",
          minHeight: "60vh",
        }}
      >
        <div className="mb-5 sm:mb-6">
          <span
            style={{
              fontSize: "clamp(30px, 8vw, 48px)",
              fontWeight: 300,
              letterSpacing: "-0.8px",
              color: "#fff",
              lineHeight: 1,
            }}
          >
            Restro
            <span style={{ color: "var(--color-lemon)", fontWeight: 500 }}>Sewa</span>
          </span>
        </div>

        <p
          className="mb-4 max-w-sm sm:max-w-md"
          style={{
            color: "rgba(255,255,255,0.65)",
            fontSize: "clamp(15px, 4vw, 18px)",
            fontWeight: 300,
            lineHeight: 1.5,
          }}
        >
          Hospitality management for modern restaurants, cafés &amp; lodges.
        </p>

        <p
          className="mb-8 sm:mb-10 max-w-xs sm:max-w-sm px-4"
          style={{ color: "rgba(255,255,255,0.35)", fontSize: 14 }}
        >
          Manage tables, menus, orders, staff and payments — all in one place.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-xs sm:max-w-none sm:w-auto px-4 sm:px-0">
          <Link
            href="/login"
            className="w-full sm:w-auto px-6 py-3 sm:py-2.5 rounded-full text-sm font-medium transition-all text-center"
            style={{
              background: "var(--color-primary)",
              color: "#fff",
              letterSpacing: "-0.1px",
            }}
          >
            Admin / Employee Login
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="flex-1 px-4 sm:px-6 py-12 sm:py-20">
        <div className="max-w-3xl mx-auto">
          <p
            className="text-center mb-8 sm:mb-12 text-xs sm:text-sm uppercase tracking-widest"
            style={{ color: "var(--color-ink-mute)", letterSpacing: "0.12em" }}
          >
            Everything you need
          </p>

          <div className="grid grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border px-5 py-5"
                style={{
                  background: "var(--color-canvas-soft)",
                  borderColor: "var(--color-hairline)",
                }}
              >
                <h3
                  className="text-sm font-medium mb-2"
                  style={{ color: "var(--color-ink)", letterSpacing: "-0.2px" }}
                >
                  {f.title}
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-mute)" }}>
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="border-t px-4 sm:px-6 py-5 sm:py-6 text-center"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          &copy; {new Date().getFullYear()} RestroSewa &mdash; Hospitality Management Platform
        </p>
      </footer>
    </div>
  );
}
