import { container } from "@/server/container";
import { authenticateApiKey, errorResponse, jsonObjectBody } from "@/server/presentation/http";

/** POST /api/v1/workflows/:id/runs — manually trigger a workflow with an API key (scope runs:trigger). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(req, "runs:trigger");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const app = container();
  const wf = await app.repos.workflows.runnable(id, auth.workspaceId);
  if (!wf) return Response.json({ code: "NOT_FOUND", message: "Workflow not found." }, { status: 404 });
  const body = await jsonObjectBody(req, 256 * 1024);
  if ("error" in body) return body.error;
  try {
    const run = await app.launcher.start({ workspaceId: auth.workspaceId, workflow: wf, input: body.value, trigger: { source: "manual", detail: `API key ${auth.key.name}` } });
    return Response.json({ runId: run.id, status: run.status }, { status: 202 });
  } catch (e) {
    return errorResponse(e, "Couldn't start the run.");
  }
}
