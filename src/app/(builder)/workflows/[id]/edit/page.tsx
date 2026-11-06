import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthGuard } from "@/components/layout/auth-guard";
import { WorkflowBuilder } from "@/features/builder/builder";

export const metadata: Metadata = { title: "Workflow editor" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthGuard>
      <Suspense>
        <WorkflowBuilder id={id} />
      </Suspense>
    </AuthGuard>
  );
}
