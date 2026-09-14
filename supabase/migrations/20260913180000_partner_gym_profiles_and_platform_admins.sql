-- Applied to StrictlyNFC (owedpojalgtkiuthptft) via the Supabase MCP on 2026-09-13.
-- Gym listing fields let the member app show partner gyms, maps, and branding from data instead of code.
alter table public.gyms
  add column if not exists timezone text not null default 'America/Los_Angeles',
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists logo_url text,
  add column if not exists accent_color text,
  add column if not exists background_color text,
  add column if not exists hours_label text,
  add column if not exists public_visible boolean not null default false;

alter table public.gyms
  add constraint gyms_latitude_range check (latitude is null or latitude between -90 and 90),
  add constraint gyms_longitude_range check (longitude is null or longitude between -180 and 180),
  add constraint gyms_accent_color_hex check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint gyms_background_color_hex check (background_color is null or background_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint gyms_logo_url_https check (logo_url is null or logo_url ~ '^https://'),
  add constraint gyms_hours_label_length check (hours_label is null or char_length(hours_label) <= 40);

comment on column public.gyms.public_visible is 'Shown to members in the app Gyms tab and map when true.';

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
comment on table public.platform_admins is 'Strictly staff who can create partner gyms from the owner portal. Read by the worker with the service role only.';

insert into public.gyms (slug, name, status, timezone, address, city, region, latitude, longitude, accent_color, background_color, hours_label, public_visible)
values ('vault-fitness-club', 'Vault Fitness Club', 'active', 'America/Los_Angeles', '1850 S 120th St', 'Seattle', 'WA', 47.495842, -122.308036, '#F2C44D', '#090909', 'Open 24/7', true)
on conflict (slug) do update set
  address = excluded.address, city = excluded.city, region = excluded.region,
  latitude = excluded.latitude, longitude = excluded.longitude,
  accent_color = excluded.accent_color, background_color = excluded.background_color,
  hours_label = excluded.hours_label, public_visible = true;

update public.gyms set public_visible = false where slug = 'strictly-demo-gym';

insert into public.platform_admins (user_id)
select id from auth.users where email = 'yaseen.atolba@gmail.com'
on conflict (user_id) do nothing;
