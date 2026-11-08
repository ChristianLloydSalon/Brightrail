import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { Suspense } from "react";
import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = publicPageMetadata({
  title: "Sign in",
  description: "Sign in to Brightrail to build, run and monitor your automation workflows, review failed runs and approve AI-suggested recoveries.",
  path: "/sign-in",
});

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
