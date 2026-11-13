import type { MetadataRoute } from "next";

const pages = [
  "",
  "about",
  "company",
  "pricing",
  "terms",
  "privacy",
  "acceptable-use",
  "help",
  "contact",
  "changelog",
  "xyroaidetect",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.map((page) => ({
    url: `https://xyro.ai${page ? `/${page}` : ""}`,
    lastModified: new Date("2026-11-13"),
    changeFrequency: page ? "monthly" : "weekly",
    priority: page ? 0.6 : 1,
  }));
}
