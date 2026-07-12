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
};

export default nextConfig;
