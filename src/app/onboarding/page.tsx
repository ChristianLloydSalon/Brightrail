import type { Metadata } from "next";
import { AuthGuard } from "@/components/layout/auth-guard";
import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Get started", robots: { index: false, follow: false } };

export default function OnboardingPage() {
  return (
    <AuthGuard requireWorkspace={false}>
      <OnboardingWizard />
    </AuthGuard>
  );
}
