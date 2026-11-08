import { CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { checkDatabase } from "@/server/infrastructure/supabase/db-check";
import { missingConfig, supabaseUrlCheck } from "@/server/infrastructure/config/env";

export const metadata: Metadata = { title: "Setup check", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Shown when required configuration is missing, so a fresh install explains itself. */
export default async function SetupPage() {
  const missing = missingConfig();
  const db = missing.some((m) => m.includes("SUPABASE")) ? null : await checkDatabase().catch(() => null);
  const dbBad = !!db?.some((c) => !c.ok);
  const checks = [
    ["NEXT_PUBLIC_SUPABASE_URL", "Supabase project URL"],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "Supabase anon (public) key"],
    ["SUPABASE_SERVICE_ROLE_KEY", "Supabase service-role key (server only)"],
    ["BRIGHTRAIL_ENCRYPTION_KEY", "Encryption key for stored credentials"],
    ["INNGEST_EVENT_KEY (or INNGEST_DEV=1 locally)", "Inngest workflow engine"],
  ];
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-5 py-10">
      <Logo />
      <div>
        <h1 className="text-2xl font-semibold">{missing.length || dbBad ? "Finish setting up Brightrail" : "Setup complete"}</h1>
        <p className="mt-1 text-fg-muted">{missing.length ? "Add these values to your .env file, then restart the server. SETUP.md walks through each one." : dbBad ? "Your .env is complete. A few database steps are left." : "Everything required is configured."}</p>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {checks.map(([key, label]) => {
          const bad = missing.includes(key!);
          return (
            <li key={key} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {bad ? <XCircle className="size-5 text-danger" aria-hidden /> : <CheckCircle2 className="size-5 text-success" aria-hidden />}
              <span className="flex flex-col"><span className="font-medium">{label}</span><code className="text-sm text-fg-muted">{key}</code></span>
              <span className="ml-auto text-sm">{bad ? (key === "NEXT_PUBLIC_SUPABASE_URL" && supabaseUrlCheck.problem !== "Missing." ? "Invalid" : "Missing") : "Set"}</span>
              {key === "NEXT_PUBLIC_SUPABASE_URL" && supabaseUrlCheck.problem && supabaseUrlCheck.problem !== "Missing." && <span className="basis-full pl-8 text-sm text-fg-muted">{supabaseUrlCheck.problem}</span>}
            </li>
          );
        })}
      </ul>
      {db && (
        <section aria-labelledby="db-h" className="flex flex-col gap-2">
          <h2 id="db-h" className="text-lg font-semibold">Database</h2>
          {dbBad && <p className="text-sm text-fg-muted">In Supabase, open <strong>SQL Editor → New query</strong>, paste each file from <code>supabase/migrations</code> that isn&apos;t done yet, in order, and click <strong>Run</strong>. Then reload this page.</p>}
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {db.map((c) => (
              <li key={c.label} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {c.ok ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-danger" aria-hidden />}
                <span className="flex flex-col"><span className="font-medium">{c.label}</span><span className="text-sm text-fg-muted">{c.detail}</span></span>
                <span className="ml-auto text-sm">{c.ok ? "Done" : "Action needed"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!missing.length && <a className="text-link underline" href="/sign-in">{dbBad ? "Go to sign in (finish the database steps first)" : "Go to sign in"}</a>}
    </main>
  );
}
