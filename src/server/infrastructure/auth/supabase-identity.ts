import "server-only";
import { ApiError } from "@/lib/api-error";
import type { EmailLinkType, GeneratedLink, IdentityAdmin } from "@/server/application/ports/services";
import { dbError } from "../supabase/errors";
import type { DbProvider } from "../supabase/repositories/base";

/** Supabase Auth admin API behind the IdentityAdmin port. */
export class SupabaseIdentityAdmin implements IdentityAdmin {
  constructor(private readonly db: DbProvider) {}

  async confirmedEmail(userId: string): Promise<string | null> {
    const { data } = await this.db().auth.admin.getUserById(userId);
    return data.user?.email_confirmed_at ? (data.user.email ?? null) : null;
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.db().auth.admin.deleteUser(userId);
    if (!error) return;
    console.error("[brightrail] deleteUser failed", error.message);
    if (/database error/i.test(error.message)) throw new ApiError("NOT_CONFIGURED", "Couldn't delete your account: the database still links records to it. Run supabase/migrations/0006_accounts_webhooks_plans.sql, then try again.");
    throw dbError({ code: (error as { code?: string }).code, message: error.message }, "delete your account");
  }

  async generateLink(type: EmailLinkType, email: string, options?: { password?: string; data?: Record<string, unknown>; redirectTo?: string }): Promise<GeneratedLink> {
    const admin = this.db().auth.admin;
    const opts = options ? { data: options.data, redirectTo: options.redirectTo } : undefined;
    // Each link type has its own parameter shape in supabase-js.
    const { data, error } =
      type === "signup" ? await admin.generateLink({ type, email, password: options?.password ?? "", options: opts })
      : type === "invite" ? await admin.generateLink({ type, email, options: opts })
      : await admin.generateLink({ type, email, ...(opts ? { options: opts } : {}) });
    return { userId: data?.user?.id ?? null, hashedToken: data?.properties?.hashed_token ?? null, emailConfirmed: !!data?.user?.email_confirmed_at, ...(error ? { error: error.message } : {}) };
  }

  async inviteUserByEmail(email: string, options: { redirectTo: string; data: Record<string, unknown> }) {
    const { data, error } = await this.db().auth.admin.inviteUserByEmail(email, options);
    return { userId: data?.user?.id ?? null, ...(error ? { error: error.message } : {}) };
  }
}
