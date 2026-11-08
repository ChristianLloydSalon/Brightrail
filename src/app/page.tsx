import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LandingPage } from "@/features/landing/landing-page";
import { publicPageMetadata, SITE } from "@/lib/site";

export const metadata: Metadata = publicPageMetadata({ title: SITE.title, description: SITE.description, path: "/", absoluteTitle: true });

export default async function Home() {
  // Only picks the header's button label, so a cookie check is enough (no auth round trip).
  // A stale cookie at worst shows "Go to dashboard", and the proxy then sends the visitor to sign-in.
  const signedIn = (await cookies()).getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
  return <LandingPage signedIn={signedIn} />;
}
