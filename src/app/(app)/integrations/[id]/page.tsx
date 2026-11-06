import { IntegrationDetail } from "@/features/integrations/integration-detail";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IntegrationDetail id={id} />;
}
