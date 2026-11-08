import "server-only";
import type { AuthMailer, EmailLinkType } from "@/server/application/ports/services";
import { authEmailsEnabled, bindLinkToThisBrowser, callbackLink, sendEmail, throttleAuthEmail } from "./auth-emails";

/** Adapter: the AuthMailer port over the Resend-backed auth email helpers. */
export class ResendAuthMailer implements AuthMailer {
  enabled() {
    return authEmailsEnabled();
  }

  send(to: string, subject: string, lines: string[], button: { label: string; url: string }, idempotencyKey: string) {
    return sendEmail(to, subject, lines, button, idempotencyKey);
  }

  callbackLink(tokenHash: string, type: EmailLinkType, next?: string, binding?: string) {
    return callbackLink(tokenHash, type, next, binding);
  }

  bindLinkToThisBrowser() {
    return bindLinkToThisBrowser();
  }

  throttle(kind: string, email: string) {
    return throttleAuthEmail(kind, email);
  }
}
