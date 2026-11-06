-- FlowForge: rate limits for sign-up, password-reset and invitation emails sent through Resend.
-- Run AFTER 0001–0006. Safe to run more than once.

create table if not exists public.auth_email_windows (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.auth_email_windows enable row level security; -- no policies: server only
revoke all on public.auth_email_windows from anon, authenticated;
grant select, insert, update, delete on public.auth_email_windows to service_role;

-- One-hour windows. Returns the number of hits in the current window, including this one.
create or replace function public.auth_email_hit(p_key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.auth_email_windows where window_start < date_trunc('hour', now()) - interval '1 day';
  insert into public.auth_email_windows (key, window_start, hits)
  values (left(p_key, 320), date_trunc('hour', now()), 1)
  on conflict (key, window_start) do update set hits = public.auth_email_windows.hits + 1
  returning hits into n;
  return n;
end;
$$;
revoke all on function public.auth_email_hit(text) from public, anon, authenticated;
grant execute on function public.auth_email_hit(text) to service_role;
