import { container } from "@/server/container";
import { authenticateApiKey, runResource } from "@/server/presentation/http";

/** GET /api/v1/runs/:id — run status and step summaries (scope runs:read). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(req, "runs:read");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const run = await container().repos.runs.findInWorkspace(auth.workspaceId, id);
  if (!run) return Response.json({ code: "NOT_FOUND", message: "Run not found." }, { status: 404 });
  return Response.json(runResource(run));
}
