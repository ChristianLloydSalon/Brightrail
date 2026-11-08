import { WebhookDetail } from "@/features/integrations/webhooks";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WebhookDetail id={id} />;
}
