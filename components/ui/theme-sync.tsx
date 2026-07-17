"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function ThemeSync() {
  const pathname = usePathname();

  useEffect(() => {
    const isDashboard = pathname.startsWith("/admin") || pathname.startsWith("/employee");

    if (isDashboard) {
      const cookies = document.cookie.split("; ");
      const themeCookie = cookies.find((c) => c.startsWith("theme="));
      const theme = themeCookie ? themeCookie.split("=")[1] : "light";

      if (theme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    } else {
      // Ensure customer/marketing pages are ALWAYS light mode
      document.documentElement.classList.remove("dark");
    }
  }, [pathname]);

  return null;
}
