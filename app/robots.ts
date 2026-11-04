import type { MetadataRoute } from "next";
import { SITE_URL } from "./(marketing)/_content";

// Only the marketing landing page is public. Dashboards, logins and the per-restaurant guest
// menus stay out of search results (the root layout also sends `noindex` on every app page).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/employee", "/superadmin", "/dashboard", "/login", "/c/", "/api/", "/offline"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
