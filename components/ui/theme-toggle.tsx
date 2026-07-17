"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Read initial theme from document class
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);

    // Update document class
    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // Set cookie (valid for 1 year)
    document.cookie = `theme=${nextTheme};path=/;max-age=${60 * 60 * 24 * 365}`;
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="w-9 h-9 rounded-lg flex items-center justify-center border hover:bg-[rgba(255,255,255,0.06)] active:bg-[rgba(255,255,255,0.1)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
      style={{
        background: "rgba(255, 255, 255, 0.05)",
        borderColor: "rgba(255, 255, 255, 0.12)",
        color: "rgba(255, 255, 255, 0.8)",
      }}
      title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
      aria-label="Toggle dark mode"
    >
      {theme === "light" ? (
        <Moon size={15} strokeWidth={1.5} className="transition-transform duration-300 hover:rotate-12" />
      ) : (
        <Sun size={15} strokeWidth={1.5} className="transition-transform duration-300 hover:rotate-45" />
      )}
    </button>
  );
}
