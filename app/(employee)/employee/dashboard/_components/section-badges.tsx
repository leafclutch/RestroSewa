"use client";

import { createContext, useContext, useEffect } from "react";

/**
 * The "8 total · 3 active · 5 free" counts in a section card's HEADER.
 *
 * The counts are live — the grids refetch on every realtime event — but the header is
 * drawn by `SectionCard`, one level above the grid. So the grid publishes them upward
 * through this context instead of drawing its own pill row inside the body.
 *
 * Outside a SectionCard (the session screen's compact rail) there is no provider and
 * publishing is a no-op, so a grid can call the hook unconditionally.
 */
export type SectionBadge = {
  n: number;
  label: string;
  /** "solid" = the section's fixed fill (the busy count), "soft" = section tint, "muted" = grey. */
  variant: "solid" | "soft" | "muted";
  /** Override colours, e.g. the cross-cutting orange for "cleaning". */
  tone?: { color: string; soft: string };
  /** The constant `--fill-*` behind a "solid" badge — the same fill its busy cards use. */
  fill?: string;
};

type Publish = (badges: SectionBadge[] | null) => void;

export const SectionBadgesContext = createContext<Publish | null>(null);

export function usePublishSectionBadges(badges: SectionBadge[] | null) {
  const publish = useContext(SectionBadgesContext);
  // Keyed on the content, not the array: the grids rebuild it every render.
  const key = JSON.stringify(badges);
  useEffect(() => {
    if (!publish) return;
    publish(badges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publish, key]);
  useEffect(() => () => publish?.(null), [publish]);
}
