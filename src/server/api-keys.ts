import "server-only";
import type { ApiKeyScope } from "@/lib/domain/types";
import { sha256 } from "./crypto";
import { adminClient } from "./supabase";

/** Resolves `Authorization: Bearer ff_live_…` to a workspace, checking status, expiry and scope. */
export async function authenticateApiKey(req: Request, scope: ApiKeyScope) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("ff_live_")) return { error: Response.json({ code: "UNAUTHENTICATED", message: "Missing API key." }, { status: 401 }) };
  const db = adminClient();
  const { data: key } = await db.from("api_keys").select("*").eq("key_hash", sha256(token)).maybeSingle();
  if (!key || key.status !== "active" || (key.expires_at && new Date(key.expires_at) < new Date()))
    return { error: Response.json({ code: "UNAUTHENTICATED", message: "Invalid or expired API key." }, { status: 401 }) };
  if (!(key.scopes as string[]).includes(scope)) return { error: Response.json({ code: "FORBIDDEN", message: `This key lacks the ${scope} scope.` }, { status: 403 }) };
  await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
  return { key, workspaceId: key.workspace_id as string, db };
}
