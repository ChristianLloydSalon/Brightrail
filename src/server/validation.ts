import "server-only";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import type { RequestContext } from "./context";
import { toConnection } from "./rows";

export async function validationContext(ctx: RequestContext) {
  const { data } = await ctx.db.from("connections").select("*").eq("workspace_id", ctx.workspace.id);
  return { connections: (data ?? []).map(toConnection), integrations: INTEGRATIONS };
}
