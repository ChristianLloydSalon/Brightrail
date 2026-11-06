import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanUsageView } from "@/features/admin/plan-usage";
export const metadata: Metadata = { title: "Plan & usage" };
export default function Page() { return <Suspense><PlanUsageView /></Suspense>; }
