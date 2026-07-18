"use client";

import { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";

export function OfflineScreen() {
  // `navigator.onLine` can't be read during render — the server has no such thing,
  // and reading it in the first client pass would disagree with the server's HTML.
  const [online, setOnline] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // The moment the network is back, leave. Staff should not have to notice a
  // button: the app simply resumes.
  //
  // `online` is the browser's opinion, and its opinion is only that a network
  // interface exists — a captive portal or a dead uplink still reads as online. So
  // this is a reload (which either lands on the real page or bounces us right back
  // here), never a claim that we're connected.
  useEffect(() => {
    if (!online) return;
    setRetrying(true);
    const t = setTimeout(() => location.reload(), 600);
    return () => clearTimeout(t);
  }, [online]);

  return (
    <main
      className="min-h-dvh flex items-center justify-center p-6"
      style={{ background: "var(--color-canvas-soft)" }}
    >
      <div className="w-full max-w-sm text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{ background: "var(--color-canvas)", border: "1px solid var(--color-hairline)" }}
        >
          <WifiOff size={26} style={{ color: "var(--color-ink-mute)" }} />
        </div>

        <h1
          className="text-xl mb-2"
          style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
        >
          {online ? "Back online" : "You're offline"}
        </h1>

        <p className="text-sm leading-relaxed mb-8" style={{ color: "var(--color-ink-mute)" }}>
          {online
            ? "Reconnecting you now…"
            : "HRestroSewa needs a connection to show live tables, orders and billing. " +
              "Rather than show you a stale floor plan, it waits."}
        </p>

        <button
          type="button"
          onClick={() => {
            setRetrying(true);
            location.reload();
          }}
          disabled={retrying}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl text-sm font-medium disabled:opacity-60"
          style={{ background: "var(--color-primary)", color: "#fff" }}
        >
          <RefreshCw size={15} className={retrying ? "animate-spin" : undefined} />
          {retrying ? "Reconnecting…" : "Try again"}
        </button>

        <p className="text-xs mt-8" style={{ color: "var(--color-ink-mute)" }}>
          This screen will clear on its own as soon as the connection returns.
        </p>
      </div>
    </main>
  );
}
