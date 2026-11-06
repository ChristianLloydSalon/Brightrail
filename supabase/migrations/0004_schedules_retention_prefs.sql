-- FlowForge: schedule trigger, run-history retention, per-person notification preferences.
-- Run AFTER 0001–0003. Safe to run more than once.

-- ---------------------------------------------------------------- schedules
create table if not exists public.workflow_schedules (
  workflow_id uuid primary key references public.workflows(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cron text not null,
  timezone text not null,
  description text not null,
  enabled boolean not null default true,
  -- Bumped on every change; pending timers carrying an older version exit without running.
  version int not null default 1,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_id uuid references public.workflow_runs(id) on delete set null,
  last_error text,
  updated_at timestamptz not null default now()
);
create index if not exists workflow_schedules_due on public.workflow_schedules(next_run_at) where enabled;
create index if not exists workflow_schedules_ws on public.workflow_schedules(workspace_id);
alter table public.workflow_schedules enable row level security;
drop policy if exists "members read" on public.workflow_schedules;
create policy "members read" on public.workflow_schedules for select using (public.is_member(workspace_id));

grant select, insert, update, delete on public.workflow_schedules to service_role;
grant select on public.workflow_schedules to authenticated;
revoke all on public.workflow_schedules from anon;
revoke insert, update, delete, truncate on public.workflow_schedules from authenticated;

-- ---------------------------------------------------------------- notification preferences
alter table public.profiles add column if not exists notification_prefs jsonb not null
  default '{"runFailures":{"inApp":true,"email":false},"approvals":{"inApp":true,"email":true}}'::jsonb;

-- ---------------------------------------------------------------- retention
-- Deletes up to 5,000 finished runs older than each workspace's settings.retentionDays (default 30).
-- Step data, logs, AI analyses and approvals go with them (ON DELETE CASCADE). Also trims webhook
-- delivery records (same window) and notifications (90 days). The audit log is never purged.
create or replace function public.purge_expired_runs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  with doomed as (
    select r.id
      from public.workflow_runs r
      join public.workspaces w on w.id = r.workspace_id
     where r.status in ('succeeded', 'failed', 'cancelled')
       and coalesce(r.ended_at, r.started_at) < now() - make_interval(days => greatest(1, coalesce((w.settings->>'retentionDays')::int, 30)))
     limit 5000
  )
  delete from public.workflow_runs where id in (select id from doomed);
  get diagnostics n = row_count;

  delete from public.webhook_deliveries d
   using public.workspaces w
   where w.id = d.workspace_id
     and d.received_at < now() - make_interval(days => greatest(1, coalesce((w.settings->>'retentionDays')::int, 30)));

  delete from public.notifications where created_at < now() - interval '90 days';
  return n;
end;
$$;
revoke all on function public.purge_expired_runs() from public, anon, authenticated;
grant execute on function public.purge_expired_runs() to service_role;

-- ---------------------------------------------------------------- Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflow_schedules') then
    alter publication supabase_realtime add table public.workflow_schedules;
  end if;
end;
$$;
