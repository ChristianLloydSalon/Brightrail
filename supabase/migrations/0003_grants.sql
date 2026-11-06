-- FlowForge: explicit table permissions.
--
-- Supabase no longer grants API roles access to new tables automatically (new projects since
-- 30 May 2026, all projects from 30 Oct 2026). Without these grants the server gets
-- "permission denied for table …" (42501) and nothing can be created — e.g. "Couldn't create the workspace".
--
-- Run AFTER 0001_init.sql and 0002_live_limits_reads.sql. Safe to run more than once.
--
--   service_role   (FlowForge server only)  → full read/write; it checks roles in code first.
--   authenticated  (signed-in browser)       → read-only, and RLS limits rows to the member's workspaces.
--                                              Needed for Realtime live updates. Secret tables get nothing.
--   anon           (signed-out browser)      → nothing.

grant usage on schema public to service_role, authenticated;

grant select, insert, update, delete on
  public.profiles, public.workspaces, public.workspace_members,
  public.workflows, public.workflow_versions, public.workflow_runs, public.run_contexts,
  public.connections, public.connection_secrets,
  public.webhook_endpoints, public.webhook_secrets, public.webhook_deliveries, public.webhook_rate_windows,
  public.ai_analyses, public.approval_requests, public.api_keys,
  public.notifications, public.notification_reads
to service_role;

-- Audit trail is append-only (a trigger also blocks update/delete).
grant select, insert on public.audit_events to service_role;

grant select on
  public.profiles, public.workspaces, public.workspace_members,
  public.workflows, public.workflow_versions, public.workflow_runs,
  public.connections, public.webhook_endpoints, public.webhook_deliveries,
  public.ai_analyses, public.approval_requests, public.audit_events,
  public.notifications, public.notification_reads
to authenticated;

-- Never reachable from the browser: secrets, raw run data, key hashes, rate counters.
revoke all on public.connection_secrets, public.webhook_secrets, public.run_contexts, public.api_keys, public.webhook_rate_windows from anon, authenticated;

-- Older projects gave anon/authenticated full access by default (RLS still blocked writes); tighten it.
revoke all on
  public.profiles, public.workspaces, public.workspace_members,
  public.workflows, public.workflow_versions, public.workflow_runs,
  public.connections, public.webhook_endpoints, public.webhook_deliveries,
  public.ai_analyses, public.approval_requests, public.audit_events,
  public.notifications, public.notification_reads
from anon;
revoke insert, update, delete, truncate on
  public.profiles, public.workspaces, public.workspace_members,
  public.workflows, public.workflow_versions, public.workflow_runs,
  public.connections, public.webhook_endpoints, public.webhook_deliveries,
  public.ai_analyses, public.approval_requests, public.audit_events,
  public.notifications, public.notification_reads
from authenticated;
