-- Applied to StrictlyNFC (owedpojalgtkiuthptft) via the Supabase MCP on 2026-09-13.
alter table public.member_workouts
  add column avg_heart_rate integer check (avg_heart_rate is null or avg_heart_rate between 20 and 250),
  add column max_heart_rate integer check (max_heart_rate is null or max_heart_rate between 20 and 250),
  add column active_calories integer check (active_calories is null or active_calories >= 0),
  add column health_source text check (health_source is null or health_source in ('watch_workout', 'health_samples'));

comment on column public.member_workouts.health_source is 'watch_workout: stats taken from an overlapping Apple Watch workout. health_samples: heart rate and energy samples Health recorded during the session.';
