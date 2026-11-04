"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_KEY } from "../_content";

/**
 * Landing-page theme. By default the page follows the device (pure CSS, prefers-color-scheme), so
 * there is no flash and nothing to store. Choosing Light or Dark pins it via `data-theme` on the
 * page root and remembers it in localStorage; the inline script in page.tsx re-applies a stored
 * choice before first paint. "System" clears the choice.
 */
export type ThemeChoice = "system" | "light" | "dark";
const EVENT = "hrs-landing-theme";

function root() {
  return document.querySelector<HTMLElement>("[data-landing-root]");
}
function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}
function effective(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function apply(choice: ThemeChoice) {
  const el = root();
  if (el) {
    if (choice === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", choice);
  }
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* storage blocked — the choice still applies for this visit */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Tracks the stored choice and the resulting light/dark, live across both controls. */
function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [mode, setMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    const sync = () => {
      const c = readChoice();
      setChoice(c);
      setMode(effective(c));
    };
    sync();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    window.addEventListener(EVENT, sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  return { choice, mode };
}

/** Navbar sun/moon button: flips between light and dark. */
export function ThemeToggle() {
  const { mode } = useTheme();
  const next = mode === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => apply(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="flex size-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
    >
      {mode === "dark" ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
    </button>
  );
}

/** Footer segmented control: System / Light / Dark. */
export function ThemeSwitch() {
  const { choice } = useTheme();
  const opts: { v: ThemeChoice; label: string; Icon: typeof Sun }[] = [
    { v: "system", label: "System", Icon: Monitor },
    { v: "light", label: "Light", Icon: Sun },
    { v: "dark", label: "Dark", Icon: Moon },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex rounded-full border border-[var(--l-line)] bg-[var(--l-surface)] p-1"
    >
      {opts.map(({ v, label, Icon }) => {
        const on = choice === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => apply(v)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              on
                ? "bg-[var(--l-strong-bg)] text-[var(--l-strong-fg)]"
                : "text-[var(--l-mute)] hover:text-[var(--l-ink)]"
            }`}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
