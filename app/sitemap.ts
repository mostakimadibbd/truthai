import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { articles } from "@/lib/public-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "verify-image", ...Object.keys(articles)];
  return pages.map((page) => ({
    url: `${siteUrl}${page ? `/${page}` : ""}`,
    lastModified: new Date("2026-11-15"),
    changeFrequency: page ? "monthly" : "weekly",
    priority: page ? 0.6 : 1,
  }));
}
