import { ApiError } from "@/lib/api-error";
import { authenticateApiKey } from "@/server/api-keys";
import { startRun } from "@/server/engine/runs";

/** POST /api/v1/workflows/:id/runs — manually trigger a workflow with an API key (scope runs:trigger). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(req, "runs:trigger");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const { data: wf } = await auth.db.from("workflows").select("id, name, status, current_version_id, workspace_id").eq("id", id).eq("workspace_id", auth.workspaceId).maybeSingle();
  if (!wf) return Response.json({ code: "NOT_FOUND", message: "Workflow not found." }, { status: 404 });
  let input: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (Buffer.byteLength(text) > 256 * 1024) return Response.json({ code: "VALIDATION", message: "Body exceeds 256 KB." }, { status: 413 });
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ code: "VALIDATION", message: "Body must be a JSON object." }, { status: 400 });
    input = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ code: "VALIDATION", message: "Body must be JSON." }, { status: 400 });
  }
  try {
    const run = await startRun({ workspaceId: auth.workspaceId, workflow: wf, input, trigger: { source: "manual", detail: `API key ${auth.key.name}` } });
    return Response.json({ runId: run.id, status: run.status }, { status: 202 });
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError("INTERNAL", "Couldn't start the run.");
    return Response.json(err.toJSON(), { status: err.code === "CONFLICT" ? 409 : err.code === "RATE_LIMITED" ? 429 : 500 });
  }
}
