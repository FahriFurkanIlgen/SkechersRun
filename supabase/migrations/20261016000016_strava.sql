-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- Strava import.
-- 1) New activity source 'strava'. Strava activities are fetched by the
--    `strava` Edge Function and submitted from the device like Health imports,
--    so they go through exactly the same validation (speed, synthetic route…).
-- 2) strava_connections: the player's Strava OAuth tokens. Only the Edge
--    Function (service role) reads or writes them; clients see whether they are
--    connected through strava_status() and never the tokens.

alter table public.activities drop constraint if exists activities_source_check;
alter table public.activities add constraint activities_source_check
  check (source in ('phone', 'apple_health', 'health_connect', 'runner_watch', 'strava'));

create or replace function public.submit_activity(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  res jsonb;
  mode text := coalesce(payload ->> 'route_share', 'trimmed');
  v_source text := coalesce(payload ->> 'source', 'phone');
  v_external text := nullif(payload ->> 'external_id', '');
  aid uuid;
  existing uuid;
begin
  if mode not in ('trimmed', 'stats_only', 'full') then
    raise exception 'invalid_route_share' using errcode = '22023';
  end if;
  if v_source not in ('phone', 'apple_health', 'health_connect', 'runner_watch', 'strava') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  -- Re-importing an already imported workout returns the original result.
  if v_external is not null then
    select a.id into existing from public.activities a
      where a.user_id = auth.uid() and a.source = v_source and a.external_id = v_external;
    if existing is not null then
      return jsonb_build_object(
        'activity_id', existing, 'status', 'rejected', 'reasons', jsonb_build_array('duplicate_import'),
        'distance_m', 0, 'claimed_cells', 0, 'net_gain_cells', 0, 'captured_cells', 0, 'captured_from_users', 0);
    end if;
  end if;

  res := public.submit_activity_core(payload);
  aid := (res ->> 'activity_id')::uuid;

  update public.activities a
    set source = v_source,
        external_id = v_external,
        source_device = left(nullif(payload ->> 'source_device', ''), 64)
    where a.id = aid and a.user_id = auth.uid() and a.external_id is null and v_source <> 'phone';

  -- Where it happened (reverse-geocoded on the device from the route's centre).
  -- Only labels: used for district rankings, never for validation.
  if nullif(payload ->> 'district', '') is not null then
    update public.activities a
      set city = left(nullif(payload ->> 'city', ''), 64), district = left(payload ->> 'district', 64)
      where a.id = aid and a.user_id = auth.uid();
    update public.territory_cells t
      set city = left(nullif(payload ->> 'city', ''), 64), district = left(payload ->> 'district', 64)
      where t.activity_id = aid and t.owner_id = auth.uid();
  end if;

  -- The core already built the default 'trimmed' route.
  update public.activities a
    set route_share = mode,
        public_route = case when a.status = 'accepted'
          then public.compute_public_route(a.user_id, (select public.route_as_line(r.route) from public.activity_routes r where r.activity_id = a.id), mode)
          end
    where a.id = aid and a.user_id = auth.uid() and a.route_share <> mode;
  return res;
end $$;

revoke execute on function public.submit_activity(jsonb) from anon, public;
grant execute on function public.submit_activity(jsonb) to authenticated;

create table public.strava_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  athlete_id bigint not null,
  athlete_name text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.strava_connections enable row level security;
revoke all on public.strava_connections from anon, authenticated, public;

-- Connected or not, and as whom (no tokens).
create or replace function public.strava_status()
returns table (connected boolean, athlete_name text, connected_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select true, c.athlete_name, c.created_at from public.strava_connections c where c.user_id = auth.uid()
$$;
revoke execute on function public.strava_status() from anon, public;
grant execute on function public.strava_status() to authenticated;
-- auto_expose_new_tables = false: the Edge Function's role needs an explicit grant.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.strava_connections to service_role;
  end if;
end $$;
