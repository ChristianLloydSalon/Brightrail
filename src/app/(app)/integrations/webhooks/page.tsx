import type { Metadata } from "next";
import { Suspense } from "react";
import { WebhookList } from "@/features/integrations/webhooks";
export const metadata: Metadata = { title: "Webhooks" };
export default function Page() { return <Suspense><WebhookList /></Suspense>; }
