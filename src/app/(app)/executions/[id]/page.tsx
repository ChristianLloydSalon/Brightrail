import { RunDetailView } from "@/features/executions/run-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunDetailView id={id} />;
}
