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
    <div className="mt-6 pt-5 border-t" style={{ borderColor: "var(--color-hairline)" }}>
      <label
        className="block text-sm mb-2"
        style={{ color: "var(--color-ink)" }}
        htmlFor="rs-restaurant-search"
      >
        Staff sign in
      </label>

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
          className="w-full text-sm pl-9 pr-9 py-2.5 rounded-lg border"
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
        <ul className="mt-2 rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
          {results.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/login?mode=staff&slug=${encodeURIComponent(r.slug)}`}
                className="block px-3 py-2.5 text-sm border-b last:border-b-0"
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
