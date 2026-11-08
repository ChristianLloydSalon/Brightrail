import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((r) => ({
    url: `${SITE.url}${r.path}`,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
