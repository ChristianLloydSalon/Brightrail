import type { Metadata } from "next";
import { Suspense } from "react";
import { MfaForm } from "@/features/auth/mfa-form";

export const metadata: Metadata = { title: "Two-factor code", robots: { index: false, follow: false } };

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
