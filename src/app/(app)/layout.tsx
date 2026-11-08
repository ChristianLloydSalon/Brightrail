import { AppShell } from "@/components/layout/app-shell";
import type { Metadata } from "next";
import { AuthGuard } from "@/components/layout/auth-guard";

// Signed-in workspace pages are private: keep them out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  );
}
