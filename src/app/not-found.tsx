import { Compass } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState
        icon={<Compass aria-hidden />}
        title="Page not found"
        description="The page you're looking for doesn't exist or you don't have access to it in this workspace."
        action={<Button asChild><Link href="/dashboard">Go to dashboard</Link></Button>}
      />
    </main>
  );
}
