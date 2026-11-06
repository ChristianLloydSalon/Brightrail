-- FlowForge: one-time schedules ("run once at a date and time"). Run AFTER 0004. Safe to run more than once.
alter table public.workflow_schedules add column if not exists run_once boolean not null default false;
