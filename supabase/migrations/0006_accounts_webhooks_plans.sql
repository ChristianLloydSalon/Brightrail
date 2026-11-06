-- FlowForge: account deletion, secret-link webhooks, social sign-in names.
-- Run AFTER 0001–0005. Safe to run more than once.

-- ---------------------------------------------------------------- account deletion
-- Records that only *mention* a person (who created/published/decided something) keep working after
-- that person deletes their account: the reference becomes NULL instead of blocking the deletion.
do $$
declare
  r record;
  con text;
begin
  for r in select * from (values
    ('workspaces', 'created_by'),
    ('workspace_members', 'invited_by'),
    ('workflows', 'owner_id'),
    ('workflow_versions', 'published_by'),
    ('connections', 'created_by'),
    ('ai_analyses', 'created_by'),
    ('approval_requests', 'decided_by'),
    ('api_keys', 'created_by')
  ) as t(tbl, col) loop
    select c.conname into con
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conrelid = format('public.%I', r.tbl)::regclass and c.contype = 'f' and a.attname = r.col
     limit 1;
    if con is not null then
      execute format('alter table public.%I drop constraint %I', r.tbl, con);
    end if;
    execute format('alter table public.%I alter column %I drop not null', r.tbl, r.col);
    execute format('alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null', r.tbl, r.tbl || '_' || r.col || '_fkey', r.col);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- webhooks without code
-- "hmac": senders sign each request. "url_key": the secret is part of the URL (form tools, no-code apps).
alter table public.webhook_endpoints add column if not exists verification text not null default 'hmac';
alter table public.webhook_endpoints drop constraint if exists webhook_endpoints_verification_check;
alter table public.webhook_endpoints add constraint webhook_endpoints_verification_check check (verification in ('hmac', 'url_key'));

-- ---------------------------------------------------------------- Google / GitHub sign-in
-- Social providers put the person's name in different metadata fields.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'user_name', ''), '')
  )
  on conflict (id) do nothing;
  -- Link pending invitations addressed to this email.
  update public.workspace_members set user_id = new.id
  where lower(email) = lower(new.email) and user_id is null;
  return new;
end; $$;
