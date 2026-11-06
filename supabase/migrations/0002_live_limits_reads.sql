-- FlowForge v2.1: webhook rate limits, per-person notification read state, Realtime.
-- Safe to run more than once. Run AFTER 0001_init.sql (SQL Editor → New query → paste → Run).

-- ---------------------------------------------------------------- webhook rate limiting
-- Fixed one-minute windows, counted atomically in Postgres (no Redis needed).
create table if not exists public.webhook_rate_windows (
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (endpoint_id, window_start)
);
alter table public.webhook_rate_windows enable row level security; -- no policies: server only

create or replace function public.webhook_rate_hit(p_endpoint uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.webhook_rate_windows
   where endpoint_id = p_endpoint and window_start < date_trunc('minute', now()) - interval '5 minutes';
  insert into public.webhook_rate_windows (endpoint_id, window_start, hits)
  values (p_endpoint, date_trunc('minute', now()), 1)
  on conflict (endpoint_id, window_start) do update set hits = public.webhook_rate_windows.hits + 1
  returning hits into n;
  return n;
end;
$$;
revoke all on function public.webhook_rate_hit(uuid) from public, anon, authenticated;
grant execute on function public.webhook_rate_hit(uuid) to service_role;

alter table public.webhook_deliveries drop constraint if exists webhook_deliveries_status_check;
alter table public.webhook_deliveries add constraint webhook_deliveries_status_check
  check (status in ('accepted','duplicate','rejected_signature','rejected_replay','rejected_size','rejected_rate'));

-- ---------------------------------------------------------------- per-person notification reads
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);
create index if not exists notification_reads_user on public.notification_reads(user_id, workspace_id);
alter table public.notification_reads enable row level security;
drop policy if exists "own reads" on public.notification_reads;
create policy "own reads" on public.notification_reads for select using (user_id = auth.uid());

-- Unread = notifications in the workspace created since the person joined that they haven't read.
create or replace function public.unread_notification_count(p_ws uuid, p_user uuid, p_since timestamptz)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.notifications n
   where n.workspace_id = p_ws
     and n.created_at >= p_since
     and not exists (select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = p_user);
$$;

create or replace function public.mark_all_notifications_read(p_ws uuid, p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notification_reads (notification_id, user_id, workspace_id)
  select n.id, p_user, p_ws from public.notifications n where n.workspace_id = p_ws
  on conflict do nothing;
$$;
revoke all on function public.unread_notification_count(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.unread_notification_count(uuid, uuid, timestamptz) to service_role;
grant execute on function public.mark_all_notifications_read(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- Realtime
-- Change events are delivered only to members who can read the row (RLS "members read" policies).
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['workflow_runs','workflows','approval_requests','notifications','webhook_deliveries','connections'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
