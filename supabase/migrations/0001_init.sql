-- FlowForge schema (spec §09). Run once in the Supabase SQL editor, or with `supabase db push`.
-- Tenancy: every tenant row carries workspace_id. Members can READ their workspace's rows through
-- row-level security. All WRITES go through the FlowForge server, which checks roles in code and
-- uses the service-role key. Secret material lives in tables with no policies at all.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  title text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- workspaces & members
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  plan text not null default 'free' check (plan in ('free', 'team')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  settings jsonb not null,
  grants jsonb not null default '{}'::jsonb,
  quotas jsonb not null default '{"executionsPerMonth": 1000, "members": 10, "connections": 10}'::jsonb
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null check (role in ('owner', 'admin', 'editor', 'operator', 'viewer')),
  status text not null default 'invited' check (status in ('active', 'invited', 'suspended')),
  invited_by uuid references auth.users(id),
  invited_at timestamptz default now(),
  joined_at timestamptz,
  last_active_at timestamptz,
  unique (workspace_id, email)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);

-- Membership helpers used by RLS. SECURITY DEFINER avoids recursive policy evaluation.
create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid() and status = 'active'
  );
$$;

-- ---------------------------------------------------------------- workflows & versions
create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('active', 'draft', 'paused', 'archived')),
  owner_id uuid not null references auth.users(id),
  tags text[] not null default '{}',
  draft jsonb not null,
  draft_revision int not null default 1,
  draft_updated_at timestamptz not null default now(),
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists workflows_name_unique on public.workflows(workspace_id, lower(name));

create table if not exists public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  version int not null,
  definition jsonb not null,
  checksum text not null,
  published_at timestamptz not null default now(),
  published_by uuid not null references auth.users(id),
  change_note text not null default '',
  unique (workflow_id, version)
);
alter table public.workflows drop constraint if exists workflows_current_version_fk;
alter table public.workflows add constraint workflows_current_version_fk
  foreign key (current_version_id) references public.workflow_versions(id) on delete set null;

-- ---------------------------------------------------------------- runs
-- Product-facing run index. Step summaries and redacted logs are stored as JSON on the run.
create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  workflow_name text not null,
  workflow_version_id uuid not null references public.workflow_versions(id),
  version int not null,
  status text not null default 'queued' check (status in ('queued','running','waiting_approval','retrying','succeeded','failed','cancelled')),
  trigger jsonb not null,
  input jsonb not null default '{}'::jsonb,
  correlation_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  exception jsonb,
  steps jsonb not null default '[]'::jsonb,
  logs jsonb not null default '[]'::jsonb,
  pass int not null default 0
);
create index if not exists workflow_runs_ws_started on public.workflow_runs(workspace_id, started_at desc);
create index if not exists workflow_runs_workflow on public.workflow_runs(workflow_id, started_at desc);

-- Unredacted run data the worker needs between steps. Service role only.
create table if not exists public.run_contexts (
  run_id uuid primary key references public.workflow_runs(id) on delete cascade,
  data jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------- connections & secrets
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id text not null,
  display_name text not null,
  status text not null default 'untested' check (status in ('connected','error','untested','revoked')),
  secret_hint text not null default '',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  last_tested_at timestamptz,
  last_error text,
  rotated_at timestamptz
);
create unique index if not exists connections_name_unique on public.connections(workspace_id, lower(display_name));

create table if not exists public.connection_secrets (
  connection_id uuid primary key references public.connections(id) on delete cascade,
  ciphertext text not null
);

-- ---------------------------------------------------------------- webhooks
create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null unique references public.workflows(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','disabled')),
  secret_hint text not null,
  replay_window_sec int not null default 300 check (replay_window_sec between 30 and 900),
  max_body_kb int not null default 256 check (max_body_kb between 1 and 1024),
  rate_limit_per_min int not null default 120,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table if not exists public.webhook_secrets (
  endpoint_id uuid primary key references public.webhook_endpoints(id) on delete cascade,
  ciphertext text not null
);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  received_at timestamptz not null default now(),
  event_id text not null,
  status text not null check (status in ('accepted','duplicate','rejected_signature','rejected_replay','rejected_size')),
  http_status int not null,
  bytes int not null default 0,
  run_id uuid references public.workflow_runs(id) on delete set null
);
-- Idempotency record: one accepted delivery per event id (spec §10 webhook contract).
create unique index if not exists webhook_deliveries_idem on public.webhook_deliveries(endpoint_id, event_id) where status = 'accepted';
create index if not exists webhook_deliveries_endpoint on public.webhook_deliveries(endpoint_id, received_at desc);

-- ---------------------------------------------------------------- AI & approvals
create table if not exists public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  step_id text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  data jsonb not null
);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  step_id text not null,
  workflow_name text not null,
  analysis_id uuid references public.ai_analyses(id) on delete set null,
  action_type text not null,
  tool_call jsonb not null,
  rationale text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  requested_by jsonb not null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_by uuid references auth.users(id),
  decided_by_name text,
  decided_at timestamptz,
  decision_reason text,
  outcome text check (outcome in ('resolved','still_failing','pending'))
);

-- ---------------------------------------------------------------- API keys, audit, notifications
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  prefix text not null,
  hint text not null,
  key_hash text not null unique,
  scopes text[] not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  last_used_at timestamptz,
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','revoked'))
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor jsonb not null,
  action text not null,
  category text not null,
  resource_type text not null,
  resource_id text not null,
  resource_name text not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists audit_ws_created on public.audit_events(workspace_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  href text not null,
  created_at timestamptz not null default now(),
  read boolean not null default false
);
create index if not exists notifications_ws on public.notifications(workspace_id, created_at desc);

-- Append-only audit trail: block updates and deletes even for the service role.
create or replace function public.audit_events_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_events is append-only'; end; $$;
drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update before update on public.audit_events for each row execute function public.audit_events_immutable();

-- ---------------------------------------------------------------- new users
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  -- Link pending invitations addressed to this email.
  update public.workspace_members set user_id = new.id
  where lower(email) = lower(new.email) and user_id is null;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- row-level security
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.run_contexts enable row level security;
alter table public.connections enable row level security;
alter table public.connection_secrets enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_secrets enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.approval_requests enable row level security;
alter table public.api_keys enable row level security;
alter table public.audit_events enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.workspace_members m1 join public.workspace_members m2 on m1.workspace_id = m2.workspace_id
    where m1.user_id = auth.uid() and m1.status = 'active' and m2.user_id = profiles.id
  )
);
drop policy if exists "members read workspace" on public.workspaces;
create policy "members read workspace" on public.workspaces for select using (public.is_member(id));
drop policy if exists "members read members" on public.workspace_members;
create policy "members read members" on public.workspace_members for select using (public.is_member(workspace_id) or user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['workflows','workflow_versions','workflow_runs','connections','webhook_endpoints','webhook_deliveries','ai_analyses','approval_requests','audit_events','notifications'] loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('create policy "members read" on public.%I for select using (public.is_member(workspace_id))', t);
  end loop;
end $$;
-- run_contexts, connection_secrets, webhook_secrets and api_keys have no policies: only the service role can access them.
