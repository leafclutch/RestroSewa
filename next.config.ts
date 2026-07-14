import type { NextConfig } from "next";

// Restaurant logos live in Supabase Storage, so `next/image` has to be told the
// bucket's host is trusted — otherwise every logo throws at render. Derived from
// the project URL rather than hard-coded, so a new Supabase project just works.
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  skipProxyUrlNormalize: true,

  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },

  // `pg` powers the real-time LISTEN connection (lib/realtime/bus.ts). It does
  // dynamic requires (pg-native, TLS shims) that break when bundled, so it must
  // be loaded from node_modules at runtime rather than compiled into the server
  // bundle. Without this the listener silently fails to connect and every
  // dashboard quietly falls back to the slow poll.
  serverExternalPackages: ["pg"],

  experimental: {
    // Both are BARREL packages: `radix-ui` is an umbrella that re-exports every
    // primitive it has, and lucide-react re-exports well over a thousand icons. An
    // `import { Slot } from "radix-ui"` or `import { Bell } from "lucide-react"` is
    // therefore, before tree-shaking, a request for the entire library — and the
    // bundler then has to prove it can drop the rest, which it cannot always do
    // across a barrel.
    //
    // This rewrites those imports to reach for the one module they actually need. It
    // matters most on the customer menu, which is the largest client component in the
    // app AND the one thing a guest downloads over restaurant wifi on their own phone.
    optimizePackageImports: ["lucide-react", "radix-ui"],
  },

  async headers() {
    return [
      {
        // A service worker that gets cached is a service worker you cannot replace:
        // the browser checks /sw.js for an update, a CDN answers from cache with the
        // old bytes, and the old worker keeps serving the app — across reloads, across
        // deploys. Pin it to no-store so a new release is always actually reachable.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        // Generated art, and its name never changes — but the bytes might, when the
        // mark is redrawn. A day is long enough to be free on a phone and short
        // enough that a rebrand lands without asking anyone to clear their cache.
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/splash/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};

export default nextConfig;
