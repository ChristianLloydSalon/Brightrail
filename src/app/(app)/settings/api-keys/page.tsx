import type { Metadata } from "next";
import { Suspense } from "react";
import { ApiKeysView } from "@/features/admin/api-keys";
export const metadata: Metadata = { title: "API keys" };
export default function Page() { return <Suspense><ApiKeysView /></Suspense>; }
