-- Shared planner state. All writes are made by an authenticated Edge Function
-- through service-only RPCs; members cannot read or mutate other users' plans.
create table public.planner_gym_catalogs (
  gym_slug text primary key references public.gyms (slug) on delete cascade,
  payload jsonb not null default '[]'::jsonb check (jsonb_typeof(payload) = 'array'),
  refreshed_at timestamptz,
  refresh_token uuid,
  refresh_until timestamptz
);

create table public.planner_daily_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  quota_day date not null,
  generations smallint not null default 0 check (generations between 0 and 5),
  primary key (user_id, quota_day)
);

create table public.planner_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  gym_slug text not null references public.gyms (slug) on delete cascade,
  plan_day date not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending', 'ready', 'failed')),
  lease_token uuid,
  lease_until timestamptz,
  plan jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, gym_slug, plan_day, request_hash),
  constraint planner_ready_has_plan check (status <> 'ready' or (plan is not null and jsonb_typeof(plan) = 'object'))
);

create index planner_requests_today_idx on public.planner_requests (user_id, gym_slug, plan_day, updated_at desc)
  where status = 'ready';
create index planner_requests_expired_lease_idx on public.planner_requests (lease_until)
  where status = 'pending';

alter table public.planner_gym_catalogs enable row level security;
alter table public.planner_daily_usage enable row level security;
alter table public.planner_requests enable row level security;
revoke all on public.planner_gym_catalogs, public.planner_daily_usage, public.planner_requests from public, anon, authenticated;
grant select, insert, update, delete on public.planner_gym_catalogs, public.planner_daily_usage, public.planner_requests to service_role;

-- Only one Edge instance refreshes a gym catalog at a time. A stale catalog
-- remains usable while another instance is refreshing it.
create or replace function public.reserve_planner_catalog(p_gym_slug text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.planner_gym_catalogs%rowtype;
  v_token uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.gyms g where g.slug = p_gym_slug and g.status = 'active' and g.public_visible) then
    return jsonb_build_object('state', 'invalid_gym');
  end if;
  insert into public.planner_gym_catalogs (gym_slug) values (p_gym_slug) on conflict do nothing;
  update public.planner_gym_catalogs
    set refresh_token = v_token, refresh_until = now() + interval '45 seconds'
    where gym_slug = p_gym_slug
      and (refreshed_at is null or refreshed_at < now() - interval '1 hour')
      and (refresh_until is null or refresh_until < now())
    returning * into v_row;
  if found then
    return jsonb_build_object('state', 'claimed', 'token', v_token, 'catalog', v_row.payload);
  end if;
  select * into v_row from public.planner_gym_catalogs where gym_slug = p_gym_slug;
  if v_row.refreshed_at >= now() - interval '1 hour' then
    return jsonb_build_object('state', 'fresh', 'catalog', v_row.payload);
  end if;
  if jsonb_array_length(v_row.payload) > 0 and v_row.refreshed_at >= now() - interval '24 hours' then
    return jsonb_build_object('state', 'stale', 'catalog', v_row.payload);
  end if;
  return jsonb_build_object('state', 'waiting');
end;
$$;

create or replace function public.finish_planner_catalog(p_gym_slug text, p_token uuid, p_catalog jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_updated integer;
begin
  if jsonb_typeof(p_catalog) <> 'array' then return false; end if;
  update public.planner_gym_catalogs
    set payload = p_catalog, refreshed_at = now(), refresh_token = null, refresh_until = null
    where gym_slug = p_gym_slug and refresh_token = p_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- A short transaction serializes quota allocation for one user only. The
-- external AI call happens after this function returns, with no DB lock held.
create or replace function public.reserve_planner_request(
  p_user_id uuid, p_gym_slug text, p_request_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_timezone text;
  v_gym_name text;
  v_plan_day date;
  v_quota_day date := (now() at time zone 'UTC')::date;
  v_valid_until timestamptz;
  v_existing public.planner_requests%rowtype;
  v_generations smallint;
  v_token uuid := gen_random_uuid();
  v_id uuid;
begin
  if p_user_id is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('state', 'invalid_request');
  end if;
  select g.timezone, g.name into v_timezone, v_gym_name from public.gyms g
    where g.slug = p_gym_slug and g.status = 'active' and g.public_visible;
  if not found then return jsonb_build_object('state', 'invalid_gym'); end if;
  v_plan_day := (now() at time zone v_timezone)::date;
  v_valid_until := ((v_plan_day + 1)::timestamp at time zone v_timezone);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || v_quota_day::text, 0));
  select * into v_existing from public.planner_requests
    where user_id = p_user_id and gym_slug = p_gym_slug and plan_day = v_plan_day and request_hash = p_request_hash;
  if found and v_existing.status = 'ready' then
    return jsonb_build_object('state', 'ready', 'plan', v_existing.plan);
  end if;
  if found and v_existing.status = 'pending' and v_existing.lease_until > now() then
    return jsonb_build_object('state', 'pending', 'retryAfterSeconds', 3);
  end if;

  insert into public.planner_daily_usage (user_id, quota_day) values (p_user_id, v_quota_day) on conflict do nothing;
  update public.planner_daily_usage set generations = generations + 1
    where user_id = p_user_id and quota_day = v_quota_day and generations < 5
    returning generations into v_generations;
  if not found then return jsonb_build_object('state', 'quota'); end if;

  if v_existing.id is null then
    insert into public.planner_requests (user_id, gym_slug, plan_day, request_hash, status, lease_token, lease_until)
    values (p_user_id, p_gym_slug, v_plan_day, p_request_hash, 'pending', v_token, now() + interval '90 seconds')
    returning id into v_id;
  else
    update public.planner_requests set status = 'pending', plan = null, lease_token = v_token,
      lease_until = now() + interval '90 seconds', updated_at = now()
      where id = v_existing.id returning id into v_id;
  end if;
  return jsonb_build_object('state', 'reserved', 'id', v_id, 'token', v_token, 'validUntil', v_valid_until, 'gymName', v_gym_name);
end;
$$;

create or replace function public.finish_planner_request(
  p_id uuid, p_user_id uuid, p_token uuid, p_plan jsonb, p_success boolean
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_updated integer;
begin
  if p_success and jsonb_typeof(p_plan) <> 'object' then return false; end if;
  update public.planner_requests set
    status = case when p_success then 'ready' else 'failed' end,
    plan = case when p_success then p_plan else null end,
    lease_token = null, lease_until = null, updated_at = now()
    where id = p_id and user_id = p_user_id and lease_token = p_token and status = 'pending';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.get_planner_today(p_user_id uuid, p_gym_slug text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select r.plan from public.planner_requests r
  join public.gyms g on g.slug = r.gym_slug
  where r.user_id = p_user_id and r.gym_slug = p_gym_slug and r.status = 'ready'
    and r.plan_day = (now() at time zone g.timezone)::date
    and g.status = 'active' and g.public_visible
  order by r.updated_at desc limit 1;
$$;

revoke all on function public.reserve_planner_catalog(text) from public, anon, authenticated;
revoke all on function public.finish_planner_catalog(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.reserve_planner_request(uuid, text, text) from public, anon, authenticated;
revoke all on function public.finish_planner_request(uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.get_planner_today(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_planner_catalog(text) to service_role;
grant execute on function public.finish_planner_catalog(text, uuid, jsonb) to service_role;
grant execute on function public.reserve_planner_request(uuid, text, text) to service_role;
grant execute on function public.finish_planner_request(uuid, uuid, uuid, jsonb, boolean) to service_role;
grant execute on function public.get_planner_today(uuid, text) to service_role;
