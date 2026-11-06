import { NewConnectionForm } from "@/features/integrations/connection-forms";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NewConnectionForm integrationId={id} />;
}
