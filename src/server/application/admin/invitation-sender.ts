import { ApiError } from "@/lib/api-error";
import { ROLE_LABELS } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/types";
import type { AppConfig, AuthMailer, IdentityAdmin } from "../ports/services";
import type { RequestContext } from "../shared/context";

/**
 * Emails an invitation. New people get a link that creates their account and asks them to set a password;
 * people who already have an account get a link to sign in (the invitation is waiting in Brightrail).
 * Strategy: Brightrail's Resend key when configured, otherwise Supabase's built-in invite email.
 */
export class InvitationSender {
  constructor(
    private readonly identity: IdentityAdmin,
    private readonly mailer: AuthMailer,
    private readonly config: AppConfig,
  ) {}

  /** Returns the invited person's user id when an account exists or was created. */
  async send(ctx: RequestContext, email: string, existingUserId: string | null, role: Role): Promise<string | null> {
    const ws = ctx.workspace;
    const lines = [`${ctx.user.name} invited you to join “${ws.name}” on Brightrail as ${/^[aeiou]/i.test(ROLE_LABELS[role]) ? "an" : "a"} ${ROLE_LABELS[role]}.`];
    const redirectTo = `${this.config.appUrl}/auth/callback?next=/reset-password?invited=1`;
    const subject = `You're invited to ${ws.name} on Brightrail`;

    if (!this.mailer.enabled()) {
      if (existingUserId) return existingUserId; // they'll see it in the app's workspace switcher
      const res = await this.identity.inviteUserByEmail(email, { redirectTo, data: { invited_to: ws.name, name: "" } });
      if (res.error && !/already/i.test(res.error)) throw new ApiError("INTERNAL", `Couldn't send the invitation to ${email}: ${res.error}`);
      return res.userId;
    }
    if (existingUserId) {
      await this.mailer.send(email, subject, [...lines, "Sign in to accept: the invitation is waiting in the workspace menu."], { label: "Sign in to Brightrail", url: `${this.config.appUrl}/sign-in` }, `invite-${ws.id}-${email}-${Math.floor(Date.now() / 60_000)}`);
      return existingUserId;
    }
    let gen = await this.identity.generateLink("invite", email, { data: { invited_to: ws.name, name: "" }, redirectTo });
    let type: "invite" | "magiclink" = "invite";
    if (gen.error && /already|exists|registered/i.test(gen.error)) {
      // Invited before but never finished: a one-time sign-in link lands on the same "set your password" page.
      gen = await this.identity.generateLink("magiclink", email);
      type = "magiclink";
    }
    if (gen.error || !gen.hashedToken) throw new ApiError("INTERNAL", `Couldn't create the invitation for ${email}.`);
    await this.mailer.send(email, subject, [...lines, "Accept to create your account and choose a password. The link works for 24 hours."],
      { label: "Accept invitation", url: this.mailer.callbackLink(gen.hashedToken, type, "/reset-password?invited=1") }, `invite-${gen.userId}-${gen.hashedToken.slice(0, 12)}`);
    return gen.userId;
  }
}
