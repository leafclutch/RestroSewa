import type { MetadataRoute } from "next";
import { SITE_URL } from "./(marketing)/_content";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 }];
}
