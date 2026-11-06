import { authenticateApiKey } from "@/server/api-keys";

/** GET /api/v1/runs/:id — run status and step summaries (scope runs:read). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(req, "runs:read");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const { data: run } = await auth.db.from("workflow_runs").select("id, workflow_id, workflow_name, version, status, started_at, ended_at, steps").eq("id", id).eq("workspace_id", auth.workspaceId).maybeSingle();
  if (!run) return Response.json({ code: "NOT_FOUND", message: "Run not found." }, { status: 404 });
  return Response.json(run);
}
