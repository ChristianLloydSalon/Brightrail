import { ManageConnection } from "@/features/integrations/connection-forms";
export default async function Page({ params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  return <ManageConnection connectionId={connectionId} />;
}
