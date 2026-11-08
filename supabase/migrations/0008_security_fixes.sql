-- Brightrail: security fixes from the November 2026 audit.
-- Run AFTER 0001–0007 (SQL Editor → New query → paste → Run). Safe to run more than once.

-- 1. Audit log: only owners/admins (audit.view) may read it, through the server. The browser never
--    reads audit_events (it isn't in the Realtime publication), so the membership-only RLS read path
--    that let viewers/editors/operators pull the full history through the Data API is removed.
drop policy if exists "members read" on public.audit_events;
revoke select on public.audit_events from authenticated, anon;

-- 2. Webhook idempotency: the event-id header isn't covered by the HMAC signature, so accepted
--    deliveries are also deduplicated on a hash of what was signed (timestamp + body).
alter table public.webhook_deliveries add column if not exists signature_key text;
create unique index if not exists webhook_deliveries_sig_idem
  on public.webhook_deliveries(endpoint_id, signature_key)
  where status = 'accepted' and signature_key is not null;

-- 3. Deliveries whose run couldn't start (paused workflow, quota) are logged as 'not_started' and no
--    longer hold the idempotency slot, so the sender's retry is accepted once the cause is fixed.
alter table public.webhook_deliveries drop constraint if exists webhook_deliveries_status_check;
alter table public.webhook_deliveries add constraint webhook_deliveries_status_check
  check (status in ('accepted','duplicate','rejected_signature','rejected_replay','rejected_size','rejected_rate','not_started'));

-- 4. Generic fixed-window counter (server only), used for the webhook flood guard and the AI-analysis budget.
create table if not exists public.rate_windows (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_windows enable row level security; -- no policies: server only
revoke all on public.rate_windows from anon, authenticated;
grant select, insert, update, delete on public.rate_windows to service_role;

create or replace function public.rate_hit(p_key text, p_window_sec int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec);
begin
  delete from public.rate_windows where key = p_key and window_start < w - make_interval(secs => p_window_sec * 5);
  insert into public.rate_windows (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = public.rate_windows.hits + 1
  returning hits into n;
  return n;
end;
$$;
revoke all on function public.rate_hit(text, int) from public, anon, authenticated;
grant execute on function public.rate_hit(text, int) to service_role;

-- 5. At most one pending approval per run (closes the check-then-insert race in requestApproval).
--    Older duplicates, if any, are expired first so the index can be created.
update public.approval_requests a set status = 'expired', decision_reason = 'Superseded by a newer request.'
 where a.status = 'pending'
   and exists (select 1 from public.approval_requests b
                where b.run_id = a.run_id and b.status = 'pending' and b.requested_at > a.requested_at);
create unique index if not exists approval_requests_one_pending
  on public.approval_requests(run_id) where status = 'pending';

-- 6. Profiles: members can see other people's profiles only while both are active in a shared workspace.
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.workspace_members m1 join public.workspace_members m2 on m1.workspace_id = m2.workspace_id
    where m1.user_id = auth.uid() and m1.status = 'active' and m2.user_id = profiles.id and m2.status = 'active'
  )
);

-- 7. Keep profiles.email in sync with the sign-in email, so email-based lookups (invitations) never
--    match an address the account no longer holds.
create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- 8. Secret-link webhooks can require the key in the X-Brightrail-Key header instead of the URL,
--    since URLs (and their ?key=…) are often written to access logs.
alter table public.webhook_endpoints add column if not exists header_key_only boolean not null default false;
