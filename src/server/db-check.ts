import "server-only";
import { env } from "./env";
import { adminClient } from "./supabase";

export interface DbCheck { label: string; ok: boolean; detail: string }

/**
 * Probes the database with the server key so /setup can say exactly which SQL file is missing.
 * Reads one row id at most; never returns data.
 */
export async function checkDatabase(): Promise<DbCheck[] | null> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  const db = adminClient();
  const probe = async (table: string) => (await db.from(table).select("*", { head: true, count: "exact" }).limit(1)).error;
  const [core, extra, sched] = await Promise.all([probe("workspaces"), probe("notification_reads"), probe("workflow_schedules")]);
  const onceCol = sched ? null : (await db.from("workflow_schedules").select("run_once").limit(1)).error;
  const verifCol = core ? null : (await db.from("webhook_endpoints").select("verification").limit(1)).error;
  const emailWin = await probe("auth_email_windows");

  const keyBad = (e: typeof core) => !!e && /invalid api key|no api key|jwt|jws|unauthori/i.test(e.message);
  const missing = (e: typeof core) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /could not find the table|does not exist/i.test(e.message));
  const denied = (e: typeof core) => !!e && (e.code === "42501" || /permission denied/i.test(e.message));

  if (keyBad(core)) return [{ label: "Database connection", ok: false, detail: "Supabase rejected SUPABASE_SERVICE_ROLE_KEY. Use the service_role (secret) key, not the anon key." }];
  if (core && !missing(core) && !denied(core)) return [{ label: "Database connection", ok: false, detail: `Couldn't reach the database: ${core.message}` }];
  return [
    { label: "Tables — 0001_init.sql", ok: !missing(core), detail: missing(core) ? "Not run yet." : "Created." },
    { label: "Live updates & limits — 0002_live_limits_reads.sql", ok: !missing(extra), detail: missing(extra) ? "Not run yet." : "Created." },
    { label: "Table permissions — 0003_grants.sql", ok: !denied(core) && !denied(extra) && !missing(core), detail: denied(core) || denied(extra) ? "Not run yet — Supabase no longer grants access to new tables automatically." : missing(core) ? "Run 0001 first." : "Granted." },
    { label: "Schedules, retention & preferences — 0004_schedules_retention_prefs.sql", ok: !missing(sched) && !denied(sched), detail: missing(sched) ? "Not run yet." : denied(sched) ? "Created, but permissions are missing — run 0004 again." : "Created." },
    { label: "One-time schedules — 0005_schedule_once.sql", ok: !sched && !onceCol, detail: sched ? "Run 0004 first." : onceCol ? "Not run yet." : "Added." },
    { label: "Accounts, secret-link webhooks & sign-in — 0006_accounts_webhooks_plans.sql", ok: !core && !verifCol, detail: core ? "Run 0001 first." : verifCol ? "Not run yet." : "Added." },
    { label: "Email rate limits — 0007_auth_emails.sql", ok: !missing(emailWin) && !denied(emailWin), detail: missing(emailWin) ? "Not run yet." : "Created." },
  ];
}
