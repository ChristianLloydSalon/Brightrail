import type { Metadata } from "next";
import { Suspense } from "react";
import { ExecutionsPage } from "@/features/executions/executions-page";

export const metadata: Metadata = { title: "Executions" };
export default function Page() {
  return <Suspense><ExecutionsPage /></Suspense>;
}
