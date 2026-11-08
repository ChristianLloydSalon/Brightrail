import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkflowList } from "@/features/workflows/workflow-list";

export const metadata: Metadata = { title: "Workflows" };
export default function Page() {
  return <Suspense><WorkflowList /></Suspense>;
}
