import "server-only";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeLocalPath } from "@/lib/navigation";
import { userClient } from "../supabase/clients";

export const EMAIL_LINK_TYPES = ["signup", "email", "invite", "recovery", "magiclink", "email_change"] as const;

export function emailLinkType(raw: string | null): EmailOtpType | undefined {
  return EMAIL_LINK_TYPES.find((t) => t === raw) as EmailOtpType | undefined;
}

/** Where to send the person after an email link or OAuth code was accepted (or failed). */
export function destinationAfterLink(ok: boolean, type: EmailOtpType | undefined, next: string | null): string {
  if (!ok) return "/sign-in?error=link";
  if (type === "invite") return "/reset-password?invited=1";
  if (type === "recovery") return "/reset-password";
  return safeLocalPath(next);
}

/** Verifies an emailed token_hash and starts the session in this browser. */
export async function completeEmailLink(tokenHash: string, type: EmailOtpType): Promise<boolean> {
  const sb = await userClient();
  return !(await sb.auth.verifyOtp({ token_hash: tokenHash, type })).error;
}
