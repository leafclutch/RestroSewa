"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Search, Loader2 } from "lucide-react";
import { searchRestaurants } from "@/app/actions/auth";

/**
 * "Which restaurant do you work at?" — the way back in without a manager.
 *
 * The staff PIN pad is only reachable via `?slug=`, so a staff member on a new device, or
 * one whose device forgot, previously had to track down the manager's link before they
 * could start a shift. They always know the name on the sign board; they never know a
 * 34-character slug. So the name is what we search on.
 *
 * Results are links, not buttons: they navigate to the ordinary staff sign-in URL, so this
 * component adds a way to REACH the existing flow rather than a second copy of it.
 */
export function RestaurantSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ slug: string; name: string }>>([]);
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();

  // Debounced: a restaurant name is typed a character at a time, and one request per
  // keystroke would be both wasteful and out of order on a phone connection.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        setResults(await searchRestaurants(q));
        setSearched(true);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="mt-7">
      <div className="mb-5 flex items-center gap-3 text-xs text-[#64748d]" aria-hidden>
        <span className="h-px flex-1 bg-[#e3e8ee]" />
        or
        <span className="h-px flex-1 bg-[#e3e8ee]" />
      </div>
      <label className="block text-sm font-medium text-[#0d1b33]" htmlFor="rs-restaurant-search">
        Staff sign in
      </label>
      <p className="mb-2.5 mt-0.5 text-xs text-[#64748d]">Find your restaurant, then sign in with your PIN.</p>

      <div className="relative">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--color-ink-mute)" }}
        />
        <input
          id="rs-restaurant-search"
          type="text"
          autoComplete="off"
          placeholder="Search your restaurant's name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 w-full rounded-xl border pl-9 pr-9 text-sm outline-none transition-shadow focus:border-[#22c55e] focus:ring-2 focus:ring-[#22c55e]/20"
          style={{
            borderColor: "var(--color-hairline)",
            background: "var(--color-canvas)",
            color: "var(--color-ink)",
          }}
        />
        {pending && (
          <Loader2
            size={15}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin"
            style={{ color: "var(--color-ink-mute)" }}
          />
        )}
      </div>

      {results.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-hairline)" }}>
          {results.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/login?mode=staff&slug=${encodeURIComponent(r.slug)}`}
                className="block border-b px-3.5 py-3 text-sm transition-colors last:border-b-0 hover:bg-[#f0fdf4]"
                style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
              >
                {r.name}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {searched && !pending && results.length === 0 && (
        <p className="text-xs mt-2" style={{ color: "var(--color-ink-mute)" }}>
          No restaurant found by that name. Check the spelling, or ask your manager for the
          sign-in link.
        </p>
      )}
    </div>
  );
}
