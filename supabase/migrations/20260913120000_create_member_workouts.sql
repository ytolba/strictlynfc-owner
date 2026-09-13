-- Applied to StrictlyNFC (owedpojalgtkiuthptft) via the Supabase MCP on 2026-09-13.
create table public.member_workouts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  gym_slug text not null,
  gym_name text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  duration_seconds integer generated always as (case when finished_at is null then null else greatest(0, extract(epoch from (finished_at - started_at))::integer) end) stored,
  set_count integer not null default 0 check (set_count >= 0),
  exercise_count integer not null default 0 check (exercise_count >= 0),
  volume_lb numeric not null default 0 check (volume_lb >= 0),
  sets jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_workouts_finish_after_start check (finished_at is null or finished_at >= started_at)
);

comment on table public.member_workouts is 'Member workout sessions from the StrictlyVision app. Started by the first NFC tap, finished from the app.';

create index member_workouts_user_started_idx on public.member_workouts (user_id, started_at desc);

alter table public.member_workouts enable row level security;

create policy "Members read their own workouts" on public.member_workouts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Members create their own workouts" on public.member_workouts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Members update their own workouts" on public.member_workouts
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Members delete their own workouts" on public.member_workouts
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.touch_member_workouts_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger member_workouts_touch_updated_at
  before update on public.member_workouts
  for each row execute function public.touch_member_workouts_updated_at();
