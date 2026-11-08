import type { Metadata } from "next";
import { IntegrationDirectory } from "@/features/integrations/integration-directory";
export const metadata: Metadata = { title: "Integrations" };
export default function Page() { return <IntegrationDirectory />; }
