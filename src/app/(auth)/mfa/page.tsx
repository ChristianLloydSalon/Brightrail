import type { Metadata } from "next";
import { Suspense } from "react";
import { MfaForm } from "@/features/auth/mfa-form";

export const metadata: Metadata = { title: "Two-factor code" };

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
