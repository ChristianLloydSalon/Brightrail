import "server-only";
import { ApiError } from "@/lib/api-error";
import type { ApiKeyScope, WorkflowRun } from "@/lib/domain/types";
import type { ApiKey } from "@/lib/domain/types";
import { container } from "../container";

/** Authenticates an API-key request; on failure returns the HTTP response to send. */
export async function authenticateApiKey(req: Request, scope: ApiKeyScope): Promise<{ key: ApiKey; workspaceId: string } | { error: Response }> {
  const auth = await container().apiKeys.authenticate(req.headers.get("authorization"), scope);
  if ("rejected" in auth) return { error: Response.json({ code: auth.rejected.code, message: auth.rejected.message }, { status: auth.rejected.status }) };
  return auth;
}

/** Public API representation of a run (snake_case, stable for API clients). */
export const runResource = (r: WorkflowRun) => ({
  id: r.id, workflow_id: r.workflowId, workflow_name: r.workflowName, version: r.version, status: r.status, started_at: r.startedAt, ended_at: r.endedAt ?? null, steps: r.steps,
});

/** HTTP status for an ApiError returned by the public API. */
export function errorResponse(e: unknown, fallback: string): Response {
  const err = e instanceof ApiError ? e : new ApiError("INTERNAL", fallback);
  return Response.json(err.toJSON(), { status: err.code === "CONFLICT" ? 409 : err.code === "RATE_LIMITED" ? 429 : 500 });
}

/** Reads a JSON-object body of at most `maxBytes`, or returns the error response. */
export async function jsonObjectBody(req: Request, maxBytes: number): Promise<{ value: Record<string, unknown> } | { error: Response }> {
  try {
    const text = await req.text();
    if (Buffer.byteLength(text) > maxBytes) return { error: Response.json({ code: "VALIDATION", message: `Body exceeds ${Math.round(maxBytes / 1024)} KB.` }, { status: 413 }) };
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: Response.json({ code: "VALIDATION", message: "Body must be a JSON object." }, { status: 400 }) };
    return { value: parsed as Record<string, unknown> };
  } catch {
    return { error: Response.json({ code: "VALIDATION", message: "Body must be JSON." }, { status: 400 }) };
  }
}
