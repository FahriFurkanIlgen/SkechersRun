-- Hexagon cell model (design: "Harita katmanı" — mine / others / empty cells).
--
-- The map is divided into a fixed grid of flat-topped hexagons in Web Mercator
-- (EPSG:3857), addressed by axial coordinates (q, r). The same maths lives in
-- mobile/src/domain/hex.ts so the app draws exactly the cells the server uses.
--
--   centre(q, r) = (1.5·s·q, √3·s·(r + q/2)),  s = hex_size (circumradius, mercator metres)
--
-- Mercator inflates lengths by 1/cos(latitude): with s = 130 a cell edge is ≈ 98 m
-- in Istanbul (41°N) and ≈ 115 m at 28°N. Cells are equal within a city, which is
-- where people compete; global rankings compare cell counts.
--
-- Claim rule per activity (≥ 400 m, after all integrity checks):
--   * route cells: hexagons the path runs through for ≥ 30 m
--   * loop bonus:  hexagons whose centre is inside a route that returns ≤ 75 m from its start
--   * at most 300 cells per activity
-- Each cell has exactly one owner. Claiming a cell someone else owns captures it;
-- cells you already own add nothing (repeating a route gains 0).

create or replace function public.rule(name text)
returns double precision language sql immutable as $$
  select case name
    when 'max_accuracy_m' then 30
    when 'min_claim_distance_m' then 400
    when 'loop_close_m' then 75
    when 'hex_size' then 130
    when 'min_cell_path_m' then 30
    when 'max_claim_cells' then 300
    when 'public_trim_m' then 300
    when 'max_points' then 20000
    when 'max_age_days' then 7
  end;
$$;

-- ---------------------------------------------------------------------------
-- Hex grid maths (EPSG:3857)
-- ---------------------------------------------------------------------------
create or replace function public.hex_center_3857(q int, r int)
returns geometry language sql immutable set search_path = public, extensions as $$
  select ST_SetSRID(ST_MakePoint(rule('hex_size') * 1.5 * q, rule('hex_size') * sqrt(3) * (r + q / 2.0)), 3857);
$$;

create or replace function public.hex_cell_3857(q int, r int)
returns geometry language sql immutable set search_path = public, extensions as $$
  select ST_SetSRID(ST_MakePolygon(ST_MakeLine(array(
    select ST_MakePoint(cx + s * cos(radians(60 * (k % 6))), cy + s * sin(radians(60 * (k % 6))))
    from (select rule('hex_size') as s,
                 rule('hex_size') * 1.5 * q as cx,
                 rule('hex_size') * sqrt(3) * (r + q / 2.0) as cy) c,
         generate_series(0, 6) k
    order by k))), 3857);
$$;

-- Every cell whose centre could fall inside the bounding box of `g` (3857), with its polygon.
create or replace function public.hex_candidates(g geometry)
returns table (q int, r int, cell geometry)
language sql stable set search_path = public, extensions as $$
  with b as (
    select ST_XMin(g) as x0, ST_XMax(g) as x1, ST_YMin(g) as y0, ST_YMax(g) as y1, rule('hex_size') as s
  ), qs as (
    select generate_series(floor(x0 / (1.5 * s))::int - 1, ceil(x1 / (1.5 * s))::int + 1) as q, b.* from b
  )
  select qs.q, rr.r, hex_cell_3857(qs.q, rr.r)
  from qs,
       generate_series(floor(qs.y0 / (qs.s * sqrt(3)) - qs.q / 2.0)::int - 1,
                       ceil(qs.y1 / (qs.s * sqrt(3)) - qs.q / 2.0)::int + 1) as rr(r);
$$;

-- ---------------------------------------------------------------------------
-- Tables: per-cell ownership replaces the per-player polygon
-- ---------------------------------------------------------------------------
drop function if exists public.territories_in_bbox(double precision, double precision, double precision, double precision);
drop table public.territories;

create table public.territory_cells (
  q integer not null,
  r integer not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  activity_id uuid references public.activities (id) on delete set null,
  claimed_at timestamptz not null default now(),
  center geography (point, 4326) not null,
  geom geometry (polygon, 4326) not null,
  primary key (q, r)
);
create index territory_cells_owner_idx on public.territory_cells (owner_id);
create index territory_cells_geom_idx on public.territory_cells using gist (geom);
create index territory_cells_center_idx on public.territory_cells using gist (center);
alter table public.territory_cells enable row level security;
-- No direct select policy: cells are read through cells_in_bbox() (anonymises private players).

alter table public.activities
  drop column claimed_area_m2,
  drop column net_gain_m2,
  add column claimed_cells integer not null default 0,
  add column net_gain_cells integer not null default 0,
  add column captured_cells integer not null default 0;

alter table public.territory_events
  drop column area_m2,
  add column cells integer not null default 0;

-- ---------------------------------------------------------------------------
-- Claim logic (validation unchanged from 0002; geometry + ownership per cell)
-- ---------------------------------------------------------------------------
create or replace function public.submit_activity_core(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  v_type public.activity_type := (payload ->> 'type')::public.activity_type;
  v_client uuid := (payload ->> 'client_id')::uuid;
  v_started timestamptz := to_timestamp((payload ->> 'started_at')::double precision / 1000);
  v_ended timestamptz := to_timestamp((payload ->> 'ended_at')::double precision / 1000);
  v_moving double precision := greatest(0, (payload ->> 'moving_time_s')::double precision);
  v_visibility public.visibility := coalesce((payload ->> 'visibility')::public.visibility, 'followers');
  v_title text := left(coalesce(payload ->> 'title', ''), 80);
  existing public.activities;
  n_raw int;
  n int;
  v_distance double precision;
  v_jumps int;
  v_backwards int;
  v_mocked int;
  v_fast_m double precision;
  v_max_ts timestamptz;
  v_hash text;
  reasons text[] := '{}';
  notes text[] := '{}';
  v_status text;
  v_route geometry;           -- multilinestring, 4326
  v_full_line geometry;       -- single line through all points, 4326
  v_route_m geometry;         -- route in EPSG:3857 (hex grid space)
  v_loop geometry;            -- closed loop polygon in EPSG:3857
  v_cells int := 0;           -- cells claimed by this activity
  v_net int := 0;             -- of which not owned by this player before
  v_captured_cells int := 0;  -- of which taken from other players
  v_public geometry;
  v_len double precision;
  v_activity_id uuid;
  v_captured int := 0;
  rec record;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Idempotency: a retried upload returns the original result.
  select * into existing from public.activities where user_id = uid and client_id = v_client;
  if found then
    return jsonb_build_object(
      'activity_id', existing.id, 'status', existing.status,
      'reasons', to_jsonb(existing.rejection_reasons || existing.claim_notes),
      'distance_m', existing.distance_m, 'claimed_cells', existing.claimed_cells,
      'net_gain_cells', existing.net_gain_cells, 'captured_cells', existing.captured_cells,
      'captured_from_users', 0);
  end if;

  n_raw := jsonb_array_length(coalesce(payload -> 'points', '[]'));
  if n_raw > rule('max_points') then
    raise exception 'too_many_points' using errcode = '22023';
  end if;

  drop table if exists _pts;
  create temp table _pts on commit drop as
  select
    (e.ordinality - 1)::int as seq,
    (e.value ->> 4)::int as segment,
    to_timestamp((e.value ->> 3)::double precision / 1000) as ts,
    ST_SetSRID(ST_MakePoint((e.value ->> 1)::double precision, (e.value ->> 0)::double precision), 4326) as geom,
    (e.value ->> 2)::real as accuracy_m,
    nullif(e.value ->> 5, '')::real as speed_mps,
    nullif(e.value ->> 6, '')::real as altitude_m,
    coalesce((e.value ->> 7)::boolean, false) as mocked
  from jsonb_array_elements(coalesce(payload -> 'points', '[]')) with ordinality e
  where abs((e.value ->> 0)::double precision) <= 90
    and abs((e.value ->> 1)::double precision) <= 180;

  -- Server applies the accuracy threshold again; clients cannot opt out.
  delete from _pts where accuracy_m > rule('max_accuracy_m');
  select count(*) into n from _pts;

  -- Per-step metrics within pause segments.
  with steps as (
    select
      ST_Distance(geom::geography, lag(geom) over w::geography) as d,
      extract(epoch from ts - lag(ts) over w) as dt
    from _pts
    window w as (partition by segment order by seq)
  )
  select
    coalesce(sum(d), 0),
    count(*) filter (where dt > 0 and d / dt > max_speed_mps(v_type) * 1.5 and d > 30),
    count(*) filter (where dt <= 0),
    coalesce(sum(d) filter (where dt > 0 and d / dt > max_speed_mps(v_type)), 0)
  into v_distance, v_jumps, v_backwards, v_fast_m
  from steps where d is not null;

  select count(*) filter (where mocked), max(ts) into v_mocked, v_max_ts from _pts;

  select md5(string_agg(
      round(ST_Y(geom)::numeric, 5) || ',' || round(ST_X(geom)::numeric, 5) || ',' ||
      extract(epoch from ts)::bigint, ';' order by seq))
    into v_hash from _pts;
  v_hash := coalesce(v_hash, md5(v_client::text));

  -- ---- Integrity checks (reject) --------------------------------------
  if n < 10 then reasons := reasons || 'not_enough_points'::text; end if;
  if v_mocked > 0 then reasons := reasons || 'mock_location'::text; end if;
  if v_backwards > 0 then reasons := reasons || 'non_monotonic_time'::text; end if;
  if v_max_ts > now() + interval '5 minutes' or v_ended > now() + interval '5 minutes' then
    reasons := reasons || 'future_timestamp'::text;
  end if;
  if v_started < now() - make_interval(days => rule('max_age_days')::int) then
    reasons := reasons || 'too_old'::text;
  end if;
  if v_moving > 0 and v_distance / v_moving > max_speed_mps(v_type) then
    reasons := reasons || 'impossible_average_speed'::text;
  end if;
  if v_distance > 0 and v_fast_m / v_distance > 0.15 then
    reasons := reasons || 'impossible_speed_segments'::text;
  end if;
  if v_jumps > greatest(3, n * 0.02) then
    reasons := reasons || 'route_jumps'::text;
  end if;
  if exists (
    select 1 from public.activities a
    where a.user_id = uid and a.status = 'accepted'
      and tstzrange(a.started_at, a.ended_at) && tstzrange(v_started, v_ended)
  ) then
    reasons := reasons || 'overlapping_activity'::text;
  end if;
  if exists (select 1 from public.activities a where a.trace_hash = v_hash) then
    reasons := reasons || 'duplicate_trace'::text;
  end if;

  v_status := case when cardinality(reasons) = 0 then 'accepted' else 'rejected' end;

  -- ---- Geometry ----------------------------------------------------------
  select ST_Multi(ST_Collect(line order by segment)) into v_route
  from (
    select segment, ST_MakeLine(geom order by seq) as line
    from _pts group by segment having count(*) >= 2
  ) s;

  select ST_MakeLine(geom order by seq) into v_full_line from _pts;

  drop table if exists _claim;
  create temp table _claim (q int, r int, primary key (q, r)) on commit drop;

  if v_status = 'accepted' and v_route is not null then
    if v_distance < rule('min_claim_distance_m') then
      notes := notes || 'below_min_distance'::text;
    else
      v_route_m := ST_Transform(v_route, 3857);
      -- Route cells: every hexagon the path runs through for at least min_cell_path_m
      -- (real metres). Pause gaps are not part of the route, so they claim nothing.
      insert into _claim
      select c.q, c.r from hex_candidates(v_route_m) c
      where ST_Intersects(c.cell, v_route_m)
        and ST_Length(ST_Transform(ST_Intersection(c.cell, v_route_m), 4326)::geography) >= rule('min_cell_path_m')
      on conflict do nothing;
      -- Loop bonus: cells whose centre lies inside the closed route.
      if n >= 4 and ST_Distance(ST_StartPoint(v_full_line)::geography, ST_EndPoint(v_full_line)::geography)
           <= rule('loop_close_m') then
        v_loop := ST_MakeValid(
          ST_MakePolygon(ST_AddPoint(ST_Transform(v_full_line, 3857), ST_Transform(ST_StartPoint(v_full_line), 3857))),
          'method=structure');
        insert into _claim
        select c.q, c.r from hex_candidates(v_loop) c
        where ST_Intersects(v_loop, hex_center_3857(c.q, c.r))
        on conflict do nothing;
        notes := notes || 'loop'::text;
      else
        notes := notes || 'corridor'::text;
      end if;
      select count(*) into v_cells from _claim;
      if v_cells > rule('max_claim_cells') then
        notes := notes || 'claim_too_large'::text;
        delete from _claim;
        v_cells := 0;
      end if;
    end if;
  end if;

  -- ---- Public route: trim ends, cut privacy zones, simplify --------------
  if v_status = 'accepted' and v_full_line is not null then
    v_len := ST_Length(v_full_line::geography);
    if v_len > 2 * rule('public_trim_m') + 50 then
      v_public := ST_LineSubstring(v_full_line, rule('public_trim_m') / v_len, 1 - rule('public_trim_m') / v_len);
      select coalesce(ST_Difference(v_public, ST_Union(ST_Buffer(z.center, z.radius_m)::geometry)), v_public)
        into v_public
      from public.privacy_zones z where z.user_id = uid;
      v_public := ST_Simplify(v_public, 0.00002);
      if ST_IsEmpty(v_public) then v_public := null; end if;
    end if;
  end if;

  insert into public.activities (
    user_id, client_id, type, title, visibility, started_at, ended_at, moving_time_s,
    distance_m, status, rejection_reasons, claim_notes, trace_hash, public_route)
  values (
    uid, v_client, v_type, v_title, v_visibility, v_started, v_ended, v_moving,
    v_distance, v_status, reasons, notes, v_hash, v_public)
  returning id into v_activity_id;

  insert into public.route_points (activity_id, seq, segment, recorded_at, geom, accuracy_m, speed_mps, altitude_m, mocked)
  select v_activity_id, seq, segment, ts, geom, accuracy_m, speed_mps, altitude_m, mocked from _pts;

  if v_route is not null then
    insert into public.activity_routes (activity_id, user_id, route) values (v_activity_id, uid, v_route);
  end if;

  -- ---- Ownership (per cell) ---------------------------------------------
  if v_cells > 0 then
    -- Lock the affected cells in a stable order to avoid deadlocks between claims.
    perform 1 from public.territory_cells t join _claim c on c.q = t.q and c.r = t.r
      order by t.q, t.r for update of t;

    for rec in
      select t.owner_id, count(*)::int as cnt
      from public.territory_cells t join _claim c on c.q = t.q and c.r = t.r
      where t.owner_id <> uid
      group by t.owner_id
    loop
      insert into public.territory_events (activity_id, user_id, from_user_id, kind, cells)
        values (v_activity_id, uid, rec.owner_id, 'captured', rec.cnt);
      perform notify(rec.owner_id, 'territory_lost', jsonb_build_object('cells', rec.cnt, 'by_user_id', uid));
      v_captured := v_captured + 1;
      v_captured_cells := v_captured_cells + rec.cnt;
    end loop;

    select count(*) into v_net from _claim c
    where not exists (
      select 1 from public.territory_cells t where t.q = c.q and t.r = c.r and t.owner_id = uid);

    insert into public.territory_cells as t (q, r, owner_id, activity_id, claimed_at, center, geom)
    select c.q, c.r, uid, v_activity_id, now(),
           ST_Transform(hex_center_3857(c.q, c.r), 4326)::geography,
           ST_Transform(hex_cell_3857(c.q, c.r), 4326)
    from _claim c
    on conflict (q, r) do update
      set owner_id = excluded.owner_id, activity_id = excluded.activity_id, claimed_at = excluded.claimed_at;

    insert into public.territory_events (activity_id, user_id, kind, cells)
      values (v_activity_id, uid, 'claimed', v_net);

    update public.activities
      set claimed_cells = v_cells, net_gain_cells = v_net, captured_cells = v_captured_cells
      where id = v_activity_id;
  end if;

  -- ---- Feed + notifications ----------------------------------------------
  if v_status = 'accepted' then
    if v_visibility <> 'private' then
      insert into public.feed_posts (activity_id, user_id) values (v_activity_id, uid);
    end if;
    perform notify(uid, 'activity_completed',
      jsonb_build_object('activity_id', v_activity_id, 'distance_m', round(v_distance)));
    if v_net > 0 then
      perform notify(uid, 'territory_gained',
        jsonb_build_object('activity_id', v_activity_id, 'cells', v_net));
    end if;
  end if;

  return jsonb_build_object(
    'activity_id', v_activity_id,
    'status', v_status,
    'reasons', to_jsonb(reasons || notes),
    'distance_m', v_distance,
    'claimed_cells', v_cells,
    'net_gain_cells', v_net,
    'captured_cells', v_captured_cells,
    'captured_from_users', v_captured);
end $$;

-- ---------------------------------------------------------------------------
-- Map: cells in a bounding box. The client builds the hexagon from (q, r).
-- ---------------------------------------------------------------------------
create or replace function public.cells_in_bbox(
  min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision)
returns table (q int, r int, owner_id uuid, username text, is_mine boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  -- Too far zoomed out: the client asks the user to zoom in.
  if max_lng - min_lng > 0.3 or max_lat - min_lat > 0.3 then
    return;
  end if;
  return query
  select t.q, t.r, t.owner_id,
         case when t.owner_id = auth.uid() or p.profile_visibility <> 'private' then p.username end,
         t.owner_id = auth.uid()
  from public.territory_cells t
  join public.profiles p on p.id = t.owner_id
  where t.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
  limit 3000;
end $$;

-- ---------------------------------------------------------------------------
-- Functions that read territory or gains
-- ---------------------------------------------------------------------------
drop function public.get_feed(timestamptz, int);
create or replace function public.get_feed(p_before timestamptz default null, p_limit int default 20)
returns table (
  id uuid, activity_id uuid, user_id uuid, username text, avatar_url text,
  activity_type public.activity_type, title text, distance_m double precision,
  moving_time_s double precision, net_gain_cells integer, public_route jsonb,
  like_count bigint, liked_by_me boolean, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select f.id, a.id, a.user_id, p.username, p.avatar_url, a.type, a.title, a.distance_m,
         a.moving_time_s, a.net_gain_cells,
         case when a.public_route is null then null else ST_AsGeoJSON(a.public_route, 5)::jsonb end,
         (select count(*) from public.post_likes l where l.post_id = f.id),
         exists (select 1 from public.post_likes l where l.post_id = f.id and l.user_id = auth.uid()),
         f.created_at
  from public.feed_posts f
  join public.activities a on a.id = f.activity_id
  join public.profiles p on p.id = a.user_id
  where (a.user_id = auth.uid() or public.is_follower(a.user_id, auth.uid()))
    and public.can_view_activity(a, auth.uid())
    and (p_before is null or f.created_at < p_before)
  order by f.created_at desc
  limit least(coalesce(p_limit, 20), 50);
$$;

create or replace function public.profile_stats(p_user uuid)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'activity_count', count(a.*),
    'total_distance_m', coalesce(sum(a.distance_m), 0),
    'total_time_s', coalesce(sum(a.moving_time_s), 0),
    'territory_cells', (select count(*) from public.territory_cells where owner_id = p_user),
    'total_gain_cells', coalesce(sum(a.net_gain_cells), 0),
    'longest_m', coalesce(max(a.distance_m), 0)
  )
  from public.activities a
  where a.user_id = p_user and a.status = 'accepted'
    and (p_user = auth.uid() or public.can_view_activity(a, auth.uid()));
$$;

-- Leaderboard values are cell counts ('area' = cells held now, inside the circle for 'nearby').
create or replace function public.leaderboard(
  p_scope text, p_metric text, p_level public.athlete_level default null,
  p_lat double precision default null, p_lng double precision default null,
  p_radius_km double precision default 10, p_limit int default 50, p_who text default 'all')
returns table (rank bigint, user_id uuid, username text, avatar_url text, value double precision,
               weekly_activities bigint, is_me boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  origin geography;
  radius double precision := least(coalesce(p_radius_km, 10), 50) * 1000;
begin
  if p_scope = 'nearby' then
    if p_lat is null or p_lng is null then raise exception 'location_required'; end if;
    origin := ST_MakePoint(p_lng, p_lat)::geography;
  end if;

  return query
  with players as (
    select p.* from public.profiles p
    where ((p.profile_visibility <> 'private' and p.show_in_leaderboards) or p.id = auth.uid())
      and (p_level is null or p.level = p_level)
      and (p_who <> 'friends' or p.id = auth.uid() or exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid() and f.followee_id = p.id and f.status = 'accepted'))
      and (origin is null or exists (
        select 1 from public.territory_cells t where t.owner_id = p.id and ST_DWithin(t.center, origin, radius)))
  ),
  scores as (
    select pl.id,
      case p_metric
        when 'area' then (
          select count(*)::double precision from public.territory_cells t
          where t.owner_id = pl.id and (origin is null or ST_DWithin(t.center, origin, radius)))
        when 'weekly_gain' then (
          select sum(a.net_gain_cells)::double precision from public.activities a
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

create or replace function public.delete_my_location_data()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.route_points rp using public.activities a
    where a.id = rp.activity_id and a.user_id = auth.uid();
  delete from public.activity_routes where user_id = auth.uid();
  update public.activities set public_route = null where user_id = auth.uid();
  delete from public.privacy_zones where user_id = auth.uid();
  delete from public.territory_cells where owner_id = auth.uid();
end $$;

revoke execute on function
  public.hex_center_3857(int, int), public.hex_cell_3857(int, int), public.hex_candidates(geometry),
  public.submit_activity_core(jsonb),
  public.cells_in_bbox(double precision, double precision, double precision, double precision),
  public.get_feed(timestamptz, int)
from anon, public;
grant execute on function
  public.cells_in_bbox(double precision, double precision, double precision, double precision),
  public.get_feed(timestamptz, int)
to authenticated;
