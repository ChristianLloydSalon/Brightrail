import { ApiError } from "@/lib/api-error";
import { validateEmail, validateNewPassword } from "@/lib/validators";
import type { AppConfig, AuthMailer, IdentityAdmin } from "../ports/services";
import { assertNoFieldErrors, fieldError } from "../shared/errors";

/**
 * Sign-up confirmations and password resets sent through Brightrail's own email key. Responses never
 * reveal whether an address already has an account, so these forms can't be used to discover who uses
 * Brightrail.
 */
export class AuthEmailService {
  constructor(
    private readonly identity: IdentityAdmin,
    private readonly mailer: AuthMailer,
    private readonly config: AppConfig,
  ) {}

  /** Whether the browser should use the server-side sign-up/reset (true when the email key is configured). */
  get viaServer(): boolean {
    return this.mailer.enabled();
  }

  private assertEnabled() {
    if (!this.mailer.enabled()) throw new ApiError("NOT_CONFIGURED", "Email sending isn't configured on the server.");
  }

  /** Same response whether or not the email exists; an existing person gets a "you already have an account" email. */
  async signUp(input: { name: string; email: string; password: string }) {
    this.assertEnabled();
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const errors: Record<string, string> = {};
    if (name.length < 2) errors.name = "Enter your name.";
    // The name goes into an email sent to the address given, so keep it short and free of links.
    else if (name.length > 80) errors.name = "Use 80 characters or fewer.";
    else if (/https?:|www\.|[<>]|\.[a-z]{2,}\//i.test(name)) errors.name = "Enter just your name, without links.";
    const emailErr = validateEmail(email);
    const pwErr = validateNewPassword(input.password);
    if (emailErr) errors.email = emailErr;
    if (pwErr) errors.password = pwErr;
    assertNoFieldErrors(errors);
    await this.mailer.throttle("signup", email);

    const app = this.config.appUrl;
    const binding = await this.mailer.bindLinkToThisBrowser();
    const gen = await this.identity.generateLink("signup", email, { password: input.password, data: { name }, redirectTo: `${app}/auth/callback?next=/onboarding` });
    if (gen.error) {
      if (/already|exists|registered/i.test(gen.error)) {
        const rec = await this.identity.generateLink("recovery", email);
        await this.mailer.send(email, "You already have a Brightrail account", ["Someone (hopefully you) tried to create a Brightrail account with this email address, but you already have one.", "Sign in as usual, or use the button below to choose a new password."],
          { label: "Reset my password", url: rec.hashedToken ? this.mailer.callbackLink(rec.hashedToken, "recovery", undefined, binding) : `${app}/forgot-password` }, `exists-${email}-${Math.floor(Date.now() / 600_000)}`);
        return { needsConfirmation: true };
      }
      console.error("[brightrail] generateLink(signup) failed", gen.error);
      throw new ApiError("INTERNAL", "Couldn't create the account. Try again in a minute.");
    }
    const first = name.split(" ")[0];
    // Projects with "Confirm email" turned off confirm immediately. Answer exactly as for an existing
    // address (and still send an email), so the response never reveals whether an account existed.
    if (gen.emailConfirmed) {
      await this.mailer.send(email, "Your Brightrail account is ready", [`Hi ${first},`, "Your Brightrail account has been created. Sign in with the email and password you chose."],
        { label: "Sign in to Brightrail", url: `${app}/sign-in` }, `welcome-${gen.userId}`);
      return { needsConfirmation: true };
    }
    const token = gen.hashedToken ?? "";
    await this.mailer.send(email, "Confirm your Brightrail account", [`Hi ${first},`, "Confirm your email address to finish creating your Brightrail account. The link works for one hour."],
      { label: "Confirm my email", url: this.mailer.callbackLink(token, "signup", "/onboarding", binding) }, `signup-${gen.userId}-${token.slice(0, 12)}`);
    return { needsConfirmation: true };
  }

  /** Always reports success so it can't reveal which emails have accounts. */
  async requestPasswordReset(emailInput: string) {
    this.assertEnabled();
    const email = emailInput.trim().toLowerCase();
    const emailErr = validateEmail(email);
    if (emailErr) throw fieldError({ email: emailErr });
    await this.mailer.throttle("recovery", email);
    const binding = await this.mailer.bindLinkToThisBrowser();
    const gen = await this.identity.generateLink("recovery", email);
    if (!gen.error && gen.hashedToken) {
      await this.mailer.send(email, "Reset your Brightrail password", ["We received a request to reset the password for your Brightrail account.", "Use the button below to choose a new one. The link works for one hour and can be used once."],
        { label: "Choose a new password", url: this.mailer.callbackLink(gen.hashedToken, "recovery", undefined, binding) }, `recovery-${gen.userId}-${gen.hashedToken.slice(0, 12)}`);
    }
    return { sent: true as const };
  }
}
