-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- District play: activities and cells carry the city/district they were run in,
-- players pick a home district ("ilçe takımı"), and districts compete weekly.
-- The labels come from the device's reverse geocoding; they only affect the
-- district views (rankings), never cell ownership or validation.

alter table public.activities
  add column city text check (length(city) <= 64),
  add column district text check (length(district) <= 64);
alter table public.territory_cells
  add column city text check (length(city) <= 64),
  add column district text check (length(district) <= 64);
create index territory_cells_district_idx on public.territory_cells (city, district);
create index activities_district_idx on public.activities (city, district, started_at);

alter table public.profiles
  add column home_city text check (length(home_city) <= 64),
  add column home_district text check (length(home_district) <= 64);
grant update (home_city, home_district) on public.profiles to authenticated;

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
  if v_source not in ('phone', 'apple_health', 'health_connect', 'runner_watch') then
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

-- Players ranked inside one district: cells they own there, or cells gained there this week.
create or replace function public.district_leaderboard(
  p_city text, p_district text, p_metric text default 'area', p_limit int default 50)
returns table (rank bigint, user_id uuid, username text, avatar_url text, value double precision, is_me boolean)
language sql stable security definer set search_path = public, extensions as $$
  with players as (
    select p.* from public.profiles p
    where (p.profile_visibility <> 'private' and p.show_in_leaderboards) or p.id = auth.uid()
  ), scores as (
    select pl.id,
      case p_metric
        when 'weekly_gain' then (
          select sum(a.net_gain_cells)::double precision from public.activities a
          where a.user_id = pl.id and a.status = 'accepted' and a.city = p_city and a.district = p_district
            and a.started_at >= date_trunc('week', now()))
        else (
          select count(*)::double precision from public.territory_cells t
          where t.owner_id = pl.id and t.city = p_city and t.district = p_district)
      end as value
    from players pl
  )
  select rank() over (order by s.value desc), p.id, p.username, p.avatar_url, s.value, p.id = auth.uid()
  from scores s join public.profiles p on p.id = s.id
  where coalesce(s.value, 0) > 0
  order by s.value desc
  limit least(coalesce(p_limit, 50), 100);
$$;

-- District battle in a city: each district's team (players who chose it as home)
-- and its weekly gain, plus cells currently owned inside the district.
create or replace function public.district_battle(p_city text)
returns table (rank bigint, district text, team_size bigint, weekly_gain bigint, cells bigint, is_mine boolean)
language sql stable security definer set search_path = public, extensions as $$
  with districts as (
    select distinct t.district from public.territory_cells t where t.city = p_city and t.district is not null
    union
    select distinct p.home_district from public.profiles p where p.home_city = p_city and p.home_district is not null
  ), stats as (
    select d.district,
      (select count(*) from public.profiles p where p.home_city = p_city and p.home_district = d.district) as team_size,
      (select coalesce(sum(a.net_gain_cells), 0) from public.activities a
         join public.profiles p on p.id = a.user_id
        where p.home_city = p_city and p.home_district = d.district
          and a.status = 'accepted' and a.started_at >= date_trunc('week', now())) as weekly_gain,
      (select count(*) from public.territory_cells t where t.city = p_city and t.district = d.district) as cells
    from districts d
  )
  select rank() over (order by s.weekly_gain desc, s.cells desc), s.district, s.team_size, s.weekly_gain::bigint, s.cells,
         exists (select 1 from public.profiles p where p.id = auth.uid() and p.home_city = p_city and p.home_district = s.district)
  from stats s
  order by s.weekly_gain desc, s.cells desc
  limit 100;
$$;

-- Where the signed-in user has been active, most frequent first (home district suggestions).
create or replace function public.my_districts()
returns table (city text, district text, activities bigint)
language sql stable security definer set search_path = public, extensions as $$
  select a.city, a.district, count(*) from public.activities a
  where a.user_id = auth.uid() and a.district is not null
  group by a.city, a.district
  order by count(*) desc
  limit 20;
$$;

revoke execute on function public.district_leaderboard(text, text, text, int), public.district_battle(text),
  public.my_districts() from anon, public;
grant execute on function public.district_leaderboard(text, text, text, int), public.district_battle(text),
  public.my_districts() to authenticated;
revoke execute on function public.submit_activity(jsonb) from anon, public;
grant execute on function public.submit_activity(jsonb) to authenticated;
