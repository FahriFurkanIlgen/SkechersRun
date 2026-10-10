-- Additions required by the v0.1 UI design:
--   * per-activity route sharing mode (hide ends / stats only / full route)
--   * "show me in leaderboards" preference
--   * friends-only leaderboard filter and weekly activity counts
--   * public routes hide the first/last 300 m (was 200 m)

create or replace function public.rule(name text)
returns double precision language sql immutable as $$
  select case name
    when 'max_accuracy_m' then 30
    when 'min_claim_distance_m' then 400
    when 'loop_close_m' then 75
    when 'corridor_half_width_m' then 15
    when 'max_claim_area_m2' then 5000000
    when 'public_trim_m' then 300
    when 'max_points' then 20000
    when 'max_age_days' then 7
  end;
$$;

alter table public.profiles add column show_in_leaderboards boolean not null default true;
grant update (show_in_leaderboards) on public.profiles to authenticated;

alter table public.activities add column route_share text not null default 'trimmed'
  check (route_share in ('trimmed', 'stats_only', 'full'));

-- Builds the route other people may see. Privacy zones are always removed,
-- even in 'full' mode; 'trimmed' also cuts the first and last 300 m.
create or replace function public.compute_public_route(owner uuid, line geometry, mode text)
returns geometry language plpgsql stable security definer set search_path = public, extensions as $$
declare
  len double precision;
  g geometry := line;
begin
  if line is null or mode = 'stats_only' then
    return null;
  end if;
  if mode = 'trimmed' then
    len := ST_Length(line::geography);
    if len <= 2 * rule('public_trim_m') + 50 then
      return null;
    end if;
    g := ST_LineSubstring(line, rule('public_trim_m') / len, 1 - rule('public_trim_m') / len);
  end if;
  select coalesce(ST_Difference(g, ST_Union(ST_Buffer(z.center, z.radius_m)::geometry)), g)
    into g from public.privacy_zones z where z.user_id = owner;
  g := ST_Simplify(g, 0.00002);
  return case when g is null or ST_IsEmpty(g) then null else g end;
end $$;

-- Ordered single line from the stored (multi)line route.
create or replace function public.route_as_line(route geometry)
returns geometry language sql immutable set search_path = public, extensions as $$
  select ST_MakeLine(d.geom order by d.path) from ST_DumpPoints(route) d;
$$;

-- submit_activity stays the entry point; it now honours payload.route_share.
-- Implemented as a wrapper so the validated core in 0002 is unchanged.
alter function public.submit_activity(jsonb) rename to submit_activity_core;
revoke execute on function public.submit_activity_core(jsonb) from authenticated, anon, public;

create or replace function public.submit_activity(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  res jsonb;
  mode text := coalesce(payload ->> 'route_share', 'trimmed');
  aid uuid;
begin
  if mode not in ('trimmed', 'stats_only', 'full') then
    raise exception 'invalid_route_share' using errcode = '22023';
  end if;
  res := public.submit_activity_core(payload);
  aid := (res ->> 'activity_id')::uuid;
  update public.activities a
    set route_share = mode,
        public_route = case when a.status = 'accepted'
          then public.compute_public_route(a.user_id, (select public.route_as_line(r.route) from public.activity_routes r where r.activity_id = a.id), mode)
          end
    -- The core already built the default 'trimmed' route.
    where a.id = aid and a.user_id = auth.uid() and a.route_share <> mode;
  return res;
end $$;

-- Owner edits now include the sharing mode.
drop function public.update_activity(uuid, text, public.visibility);
create or replace function public.update_activity(
  p_id uuid, p_title text, p_visibility public.visibility, p_route_share text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.activities a
    set title = left(coalesce(p_title, ''), 80),
        visibility = p_visibility,
        route_share = coalesce(p_route_share, a.route_share),
        public_route = case when p_route_share is null then a.public_route
          else public.compute_public_route(a.user_id, (select public.route_as_line(r.route) from public.activity_routes r where r.activity_id = a.id), p_route_share) end,
        updated_at = now()
    where a.id = p_id and a.user_id = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_visibility = 'private' then
    delete from public.feed_posts where activity_id = p_id;
  else
    insert into public.feed_posts (activity_id, user_id)
    select id, user_id from public.activities where id = p_id and status = 'accepted'
    on conflict (activity_id) do nothing;
  end if;
end $$;

-- Leaderboard: opt-out preference, friends filter, weekly activity count.
drop function public.leaderboard(text, text, public.athlete_level, double precision, double precision, double precision, int);
create or replace function public.leaderboard(
  p_scope text, p_metric text, p_level public.athlete_level default null,
  p_lat double precision default null, p_lng double precision default null,
  p_radius_km double precision default 10, p_limit int default 50, p_who text default 'all')
returns table (rank bigint, user_id uuid, username text, avatar_url text, value double precision,
               weekly_activities bigint, is_me boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  area geography;
begin
  if p_scope = 'nearby' then
    if p_lat is null or p_lng is null then raise exception 'location_required'; end if;
    area := ST_Buffer(ST_MakePoint(p_lng, p_lat)::geography, least(p_radius_km, 50) * 1000);
  end if;

  return query
  with players as (
    select p.* from public.profiles p
    where ((p.profile_visibility <> 'private' and p.show_in_leaderboards) or p.id = auth.uid())
      and (p_level is null or p.level = p_level)
      and (p_who <> 'friends' or p.id = auth.uid() or exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid() and f.followee_id = p.id and f.status = 'accepted'))
      and (area is null or exists (
        select 1 from public.territories t where t.user_id = p.id and ST_Intersects(t.geom, area::geometry)))
  ),
  scores as (
    select pl.id,
      case p_metric
        when 'area' then (
          select case when area is null then t.area_m2
                      else ST_Area(ST_Intersection(t.geom, area::geometry)::geography) end
          from public.territories t where t.user_id = pl.id)
        when 'weekly_gain' then (
          select sum(a.net_gain_m2) from public.activities a
          where a.user_id = pl.id and a.status = 'accepted' and a.started_at >= date_trunc('week', now()))
        when 'active_days' then (
          select count(distinct (a.started_at at time zone 'UTC')::date)::double precision
          from public.activities a
          where a.user_id = pl.id and a.status = 'accepted' and a.distance_m >= 1000
            and a.started_at >= now() - interval '28 days')
      end as value,
      (select count(*) from public.activities a
        where a.user_id = pl.id and a.status = 'accepted' and a.started_at >= date_trunc('week', now())) as weekly
    from players pl
  )
  select rank() over (order by s.value desc), p.id, p.username, p.avatar_url, s.value, s.weekly, p.id = auth.uid()
  from scores s join public.profiles p on p.id = s.id
  where coalesce(s.value, 0) > 0
  order by s.value desc
  limit least(coalesce(p_limit, 50), 100);
end $$;

revoke execute on function
  public.compute_public_route(uuid, geometry, text), public.route_as_line(geometry),
  public.submit_activity(jsonb),
  public.update_activity(uuid, text, public.visibility, text),
  public.leaderboard(text, text, public.athlete_level, double precision, double precision, double precision, int, text)
from anon, public;
grant execute on function
  public.submit_activity(jsonb),
  public.update_activity(uuid, text, public.visibility, text),
  public.leaderboard(text, text, public.athlete_level, double precision, double precision, double precision, int, text)
to authenticated;
