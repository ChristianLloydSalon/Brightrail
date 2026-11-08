import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
