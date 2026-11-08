import type { Metadata } from "next";

/** Public identity of the site, shared by page metadata, robots.txt, the sitemap, the manifest and OG images. */

function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  // Vercel sets this on every deployment, so previews still produce absolute OG/canonical URLs.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE = {
  name: "Brightrail",
  title: "Brightrail: workflow automation with durable execution",
  description:
    "Build automation workflows visually, run them on a durable engine with retries and approvals, inspect every step of every run, and recover failures with AI-assisted analysis.",
  url: siteUrl(),
  author: "Christian Salon",
  brandColor: "#ad3209",
  keywords: [
    "workflow automation",
    "visual workflow builder",
    "durable execution",
    "webhooks",
    "scheduled workflows",
    "run inspection",
    "human approvals",
    "AI failure analysis",
    "Slack automation",
    "Google Sheets automation",
  ],
} as const;

/** Routes a search engine may index. Everything else is either signed-in only or a one-off flow. */
export const PUBLIC_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "monthly" },
  { path: "/sign-up", priority: 0.8, changeFrequency: "monthly" },
  { path: "/sign-in", priority: 0.8, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
] as const;

/** Paths crawlers should skip: the signed-in app, APIs and single-use auth steps. */
export const PRIVATE_PATHS = [
  "/api/",
  "/auth/",
  "/dashboard",
  "/workflows",
  "/executions",
  "/approvals",
  "/integrations",
  "/settings",
  "/onboarding",
  "/setup",
  "/mfa",
  "/reset-password",
  "/forgot-password",
];

const SHARE_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: SITE.title };

/**
 * Full metadata for an indexable page. Next.js merges `openGraph` and `twitter` shallowly, so a page that sets
 * either would otherwise lose the site name and share image inherited from the root layout.
 */
export function publicPageMetadata({
  title,
  description,
  path,
  type = "website",
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  /** Use the title as-is, without the " · Brightrail" suffix (the home page). */
  absoluteTitle?: boolean;
}): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} · ${SITE.name}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { type, siteName: SITE.name, locale: "en_US", url: path, title: fullTitle, description, images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [SHARE_IMAGE] },
  };
}
