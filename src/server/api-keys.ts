import "server-only";
import type { ApiKeyScope } from "@/lib/domain/types";
import { sha256 } from "./crypto";
import { adminClient } from "./supabase";

/** Resolves `Authorization: Bearer br_live_…` (or a pre-rename `ff_live_…` key) to a workspace, checking status, expiry and scope. */
export async function authenticateApiKey(req: Request, scope: ApiKeyScope) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("br_live_") && !token.startsWith("ff_live_")) return { error: Response.json({ code: "UNAUTHENTICATED", message: "Missing API key." }, { status: 401 }) };
  const db = adminClient();
  const { data: key } = await db.from("api_keys").select("*").eq("key_hash", sha256(token)).maybeSingle();
  if (!key || key.status !== "active" || (key.expires_at && new Date(key.expires_at) < new Date()))
    return { error: Response.json({ code: "UNAUTHENTICATED", message: "Invalid or expired API key." }, { status: 401 }) };
  if (!(key.scopes as string[]).includes(scope)) return { error: Response.json({ code: "FORBIDDEN", message: `This key lacks the ${scope} scope.` }, { status: 403 }) };
  // A key works only while the person who created it is still an active member of the workspace
  // (removed or suspended members' keys stop working; reinstating the member restores them).
  const { data: creator } = key.created_by
    ? await db.from("workspace_members").select("id").eq("workspace_id", key.workspace_id).eq("user_id", key.created_by).eq("status", "active").maybeSingle()
    : { data: null };
  if (!creator) return { error: Response.json({ code: "UNAUTHENTICATED", message: "This key's creator is no longer an active member of the workspace. Create a new key." }, { status: 401 }) };
  await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
  return { key, workspaceId: key.workspace_id as string, db };
}
