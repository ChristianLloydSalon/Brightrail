import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { SignUpForm } from "@/features/auth/sign-up-form";

export const metadata: Metadata = publicPageMetadata({
  title: "Create a free account",
  description: "Create a free Brightrail account: build workflows visually, trigger them from webhooks or schedules, and watch every step run with retries, approvals and AI-assisted failure analysis.",
  path: "/sign-up",
});

export default function SignUpPage() {
  return <SignUpForm />;
}
