import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { emailLinkType } from "@/server/auth-links";

export const metadata: Metadata = { title: "Continue from your email" };

const ACTIONS: Record<string, { title: string; body: string; cta: string }> = {
  signup: { title: "Confirm your email", body: "You opened a link to confirm a new Brightrail account.", cta: "Confirm and continue" },
  recovery: { title: "Reset your password", body: "You opened a link to choose a new password for a Brightrail account.", cta: "Continue to reset" },
  invite: { title: "Accept your invitation", body: "You opened a link to join a Brightrail workspace.", cta: "Continue" },
  magiclink: { title: "Sign in", body: "You opened a one-time sign-in link for a Brightrail account.", cta: "Sign in" },
  email: { title: "Sign in", body: "You opened a one-time sign-in link for a Brightrail account.", cta: "Sign in" },
  email_change: { title: "Confirm your new email", body: "You opened a link to confirm a change of email address.", cta: "Confirm" },
};

/**
 * Shown when an email link is opened in a different browser from the one that asked for it (or for links
 * nobody in this browser asked for, like invitations). Continuing is a deliberate click that posts back
 * to /auth/callback, which only accepts same-site posts — so another site can't complete it for you.
 */
export default async function ConfirmEmailLinkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const type = emailLinkType(one("type"));
  const tokenHash = one("token_hash");
  if (!type || !tokenHash) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">This link isn't complete</h1>
        <p className="text-fg-muted">Open the link from your email again, or request a new one.</p>
        <Link href="/sign-in" className="text-link hover:underline">Back to sign in</Link>
      </div>
    );
  }
  const a = ACTIONS[type]!;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{a.title}</h1>
        <p className="text-fg-muted">{a.body}</p>
        <p className="text-fg-muted">Continue only if you asked for this email yourself. If someone sent you this link, close this page.</p>
      </div>
      <form method="post" action="/auth/callback" className="flex flex-col gap-3">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={one("next")} />
        <Button type="submit" className="w-full">{a.cta}</Button>
      </form>
      <Link href="/sign-in" className="text-sm text-link hover:underline">Cancel</Link>
    </div>
  );
}
