import { API_KEY_SCOPES, type ApiKey, type ApiKeyScope } from "@/lib/domain/types";
import type { ApiKeyRepository, MemberRepository, ProfileRepository } from "../ports/repositories";
import type { Hasher } from "../ports/services";
import type { AuditLog } from "../shared/audit-log";
import type { RequestContext } from "../shared/context";
import { assertNoFieldErrors } from "../shared/errors";

const KEY_PREFIXES = ["br_live_", "ff_live_"]; // ff_live_ keys were issued before the rename

/** A failed API-key check, with the HTTP status the public API should answer with. */
export interface ApiKeyRejection { status: 401 | 403; code: "UNAUTHENTICATED" | "FORBIDDEN"; message: string }
export type ApiKeyAuth = { key: ApiKey; workspaceId: string } | { rejected: ApiKeyRejection };

/** Workspace API keys: issuing them (shown once, stored hashed) and authenticating requests made with them. */
export class ApiKeyService {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly members: MemberRepository,
    private readonly profiles: ProfileRepository,
    private readonly hasher: Hasher,
    private readonly audit: AuditLog,
  ) {}

  async list(ctx: RequestContext): Promise<Array<ApiKey & { createdByName: string }>> {
    const keys = await this.keys.list(ctx.workspaceId);
    const people = await this.profiles.names(keys.map((k) => k.createdBy));
    return keys
      .map((k) => ({ ...k, createdByName: people.get(k.createdBy)?.name || "Unknown" }))
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1));
  }

  async create(ctx: RequestContext, input: { name: string; scopes: ApiKeyScope[]; expiresInDays: number | null }): Promise<{ key: ApiKey; secret: string }> {
    const errors: Record<string, string> = {};
    if (input.name.trim().length < 3) errors.name = "Use at least 3 characters.";
    if (!Array.isArray(input.scopes) || !input.scopes.length) errors.scopes = "Choose at least one scope.";
    else if (!input.scopes.every((s) => (API_KEY_SCOPES as readonly string[]).includes(s))) errors.scopes = "Choose scopes from the list.";
    if (input.expiresInDays !== null && (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 365)) errors.expiresInDays = "Use between 1 and 365 days, or no expiry.";
    assertNoFieldErrors(errors);
    const secret = this.hasher.randomToken("br_live_", 24);
    const key = await this.keys.insert({
      workspaceId: ctx.workspaceId, name: input.name.trim(), prefix: secret.slice(0, 12), hint: `••••${secret.slice(-4)}`, keyHash: this.hasher.sha256(secret), scopes: input.scopes,
      createdBy: ctx.user.id, expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000).toISOString() : null,
    });
    await this.audit.record(ctx, { action: "apikey.created", category: "apikey", resourceType: "api_key", resourceId: key.id, resourceName: key.name, metadata: { scopes: input.scopes.join(",") } });
    return { key, secret };
  }

  async revoke(ctx: RequestContext, id: string): Promise<ApiKey> {
    const key = await this.keys.revoke(ctx.workspaceId, id);
    await this.audit.record(ctx, { action: "apikey.revoked", category: "apikey", resourceType: "api_key", resourceId: id, resourceName: key.name, metadata: {} });
    return key;
  }

  /** Resolves `Authorization: Bearer br_live_…` to a workspace, checking status, expiry and scope. */
  async authenticate(authorization: string | null, scope: ApiKeyScope): Promise<ApiKeyAuth> {
    const header = authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!KEY_PREFIXES.some((p) => token.startsWith(p))) return { rejected: { status: 401, code: "UNAUTHENTICATED", message: "Missing API key." } };
    const key = await this.keys.findByHash(this.hasher.sha256(token));
    if (!key || key.status !== "active" || (key.expiresAt && new Date(key.expiresAt) < new Date())) return { rejected: { status: 401, code: "UNAUTHENTICATED", message: "Invalid or expired API key." } };
    if (!key.scopes.includes(scope)) return { rejected: { status: 403, code: "FORBIDDEN", message: `This key lacks the ${scope} scope.` } };
    // A key works only while the person who created it is still an active member of the workspace
    // (removed or suspended members' keys stop working; reinstating the member restores them).
    if (!key.createdBy || !(await this.members.isActiveMember(key.createdBy, key.workspaceId)))
      return { rejected: { status: 401, code: "UNAUTHENTICATED", message: "This key's creator is no longer an active member of the workspace. Create a new key." } };
    await this.keys.touch(key.id, new Date().toISOString());
    return { key, workspaceId: key.workspaceId };
  }
}
