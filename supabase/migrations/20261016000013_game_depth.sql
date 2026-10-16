-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- Game depth:
--  * Decay / defence: a cell its owner has not run through for decay_weak_days
--    is "weak" (shown faded); after decay_free_days it is abandoned and freed.
--    Running through your own cells keeps them alive.
--  * Protection: a newly acquired cell cannot be taken for capture_protection_h.
--  * Landmarks ("kale"): notable places whose cells give season bonus points.
--  * Seasons: monthly points (cells gained + cells taken + landmark bonus).
--  * Club rankings and club pages.

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
    when 'synthetic_speed_cv' then 0.02
    when 'synthetic_min_steps' then 30
    when 'decay_weak_days' then 21
    when 'decay_free_days' then 42
    when 'capture_protection_h' then 12
    when 'landmark_bonus' then 5
  end;
$$;

alter table public.territory_cells
  add column last_visited_at timestamptz not null default now(),
  add column protected_until timestamptz;
update public.territory_cells set last_visited_at = claimed_at;
create index territory_cells_visited_idx on public.territory_cells (last_visited_at);

alter table public.activities add column landmark_cells integer not null default 0;

-- The cell containing a point (same cube rounding as the app, src/domain/hex.ts).
create or replace function public.hex_at(lat double precision, lng double precision, out q int, out r int)
language plpgsql immutable set search_path = public, extensions as $$
declare
  p geometry := ST_Transform(ST_SetSRID(ST_MakePoint(lng, lat), 4326), 3857);
  s double precision := rule('hex_size');
  fq double precision := (2.0 / 3.0) * ST_X(p) / s;
  fr double precision := ((-1.0 / 3.0) * ST_X(p) + (sqrt(3) / 3.0) * ST_Y(p)) / s;
  fs double precision := -fq - fr;
  rq double precision := sign(fq) * floor(abs(fq) + 0.5);
  rr double precision := sign(fr) * floor(abs(fr) + 0.5);
  rs double precision := sign(fs) * floor(abs(fs) + 0.5);
begin
  if abs(rq - fq) > abs(rr - fr) and abs(rq - fq) > abs(rs - fs) then
    rq := -rr - rs;
  elsif abs(rr - fr) > abs(rs - fs) then
    rr := -rq - rs;
  end if;
  q := rq::int;
  r := rr::int;
end $$;

create table public.landmarks (
  q int not null,
  r int not null,
  name text not null check (length(name) between 2 and 48),
  city text,
  primary key (q, r)
);
alter table public.landmarks enable row level security;
create policy landmarks_read on public.landmarks for select to authenticated using (true);
grant select on public.landmarks to authenticated;

-- First landmarks (İstanbul parks and shores). More can be added with one insert each.
insert into public.landmarks (q, r, name, city)
select h.q, h.r, l.name, 'İstanbul'
from (values
  ('Moda Sahili', 40.9806, 29.0248),
  ('Kadıköy Rıhtım', 40.9925, 29.0230),
  ('Fenerbahçe Parkı', 40.9686, 29.0395),
  ('Yoğurtçu Parkı', 40.9850, 29.0330),
  ('Göztepe 60. Yıl Parkı', 40.9760, 29.0570),
  ('Caddebostan Sahili', 40.9640, 29.0640),
  ('Validebağ Korusu', 41.0230, 29.0420),
  ('Maçka Parkı', 41.0450, 28.9940),
  ('Yıldız Parkı', 41.0490, 29.0130),
  ('Bebek Sahili', 41.0770, 29.0435),
  ('Emirgan Korusu', 41.1080, 29.0530),
  ('Gülhane Parkı', 41.0130, 28.9810),
  ('Florya Atatürk Ormanı', 40.9730, 28.7900),
  ('Belgrad Ormanı Neşetsuyu', 41.1700, 28.9850)
) as l(name, lat, lng)
cross join lateral public.hex_at(l.lat, l.lng) h
on conflict do nothing;

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
  v_protected int := 0;       -- recently captured by someone else: not claimable yet
  v_landmarks int := 0;       -- landmark cells newly gained (season bonus)
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
  -- Checks added after 0005 live in activity_extra_checks().
  reasons := reasons || public.activity_extra_checks(payload);

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
  -- Recently captured cells of other players are protected for a while.
  if v_cells > 0 then
    with gone as (
      delete from _claim c using public.territory_cells t
      where t.q = c.q and t.r = c.r and t.owner_id <> uid and t.protected_until > now()
        and t.last_visited_at >= now() - make_interval(days => rule('decay_free_days')::int)
      returning 1
    ) select count(*) into v_protected from gone;
    if v_protected > 0 then
      notes := notes || 'protected_cells'::text;
      v_cells := v_cells - v_protected;
    end if;
  end if;
  if v_cells > 0 then
    -- Lock the affected cells in a stable order to avoid deadlocks between claims.
    perform 1 from public.territory_cells t join _claim c on c.q = t.q and c.r = t.r
      order by t.q, t.r for update of t;

    for rec in
      select t.owner_id, count(*)::int as cnt
      from public.territory_cells t join _claim c on c.q = t.q and c.r = t.r
      where t.owner_id <> uid
        -- Abandoned cells (not visited for decay_free_days) are free, not "taken".
        and t.last_visited_at >= now() - make_interval(days => rule('decay_free_days')::int)
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
    select count(*) into v_landmarks from _claim c
    join public.landmarks l on l.q = c.q and l.r = c.r
    where not exists (
      select 1 from public.territory_cells t where t.q = c.q and t.r = c.r and t.owner_id = uid);

    -- Visiting a cell (own or new) refreshes it; a newly acquired cell is protected.
    insert into public.territory_cells as t (q, r, owner_id, activity_id, claimed_at, center, geom,
                                             last_visited_at, protected_until)
    select c.q, c.r, uid, v_activity_id, now(),
           ST_Transform(hex_center_3857(c.q, c.r), 4326)::geography,
           ST_Transform(hex_cell_3857(c.q, c.r), 4326),
           now(), now() + make_interval(hours => rule('capture_protection_h')::int)
    from _claim c
    on conflict (q, r) do update
      set owner_id = excluded.owner_id,
          activity_id = excluded.activity_id,
          claimed_at = case when t.owner_id = excluded.owner_id then t.claimed_at else excluded.claimed_at end,
          last_visited_at = excluded.last_visited_at,
          protected_until = case when t.owner_id = excluded.owner_id then t.protected_until else excluded.protected_until end;

    insert into public.territory_events (activity_id, user_id, kind, cells)
      values (v_activity_id, uid, 'claimed', v_net);

    update public.activities
      set claimed_cells = v_cells, net_gain_cells = v_net, captured_cells = v_captured_cells,
          landmark_cells = v_landmarks
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
    'landmark_cells', v_landmarks,
    'protected_cells', v_protected,
    'captured_from_users', v_captured);
end $$;

-- Map cells: abandoned cells are hidden; weak / protected / landmark are flagged.
drop function public.cells_in_bbox(double precision, double precision, double precision, double precision);
create function public.cells_in_bbox(
  min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision)
returns table (q int, r int, owner_id uuid, username text, is_mine boolean, weak boolean, protected boolean, landmark text)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  if max_lng - min_lng > 0.3 or max_lat - min_lat > 0.3 then
    return;
  end if;
  return query
  select t.q, t.r, t.owner_id,
         case when t.owner_id = auth.uid() or p.profile_visibility <> 'private' then p.username end,
         t.owner_id = auth.uid(),
         t.last_visited_at < now() - make_interval(days => rule('decay_weak_days')::int),
         coalesce(t.protected_until > now(), false),
         l.name
  from public.territory_cells t
  join public.profiles p on p.id = t.owner_id
  left join public.landmarks l on l.q = t.q and l.r = t.r
  where t.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    and t.last_visited_at >= now() - make_interval(days => rule('decay_free_days')::int)
  limit 3000;
end $$;

-- Landmarks in view (owned or not), for the map markers.
create or replace function public.landmarks_in_bbox(
  min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision)
returns table (q int, r int, name text, owner_username text, is_mine boolean)
language sql stable security definer set search_path = public, extensions as $$
  select l.q, l.r, l.name,
         case when t.owner_id = auth.uid() or p.profile_visibility <> 'private' then p.username end,
         coalesce(t.owner_id = auth.uid(), false)
  from public.landmarks l
  left join public.territory_cells t on t.q = l.q and t.r = l.r
    and t.last_visited_at >= now() - make_interval(days => rule('decay_free_days')::int)
  left join public.profiles p on p.id = t.owner_id
  where ST_Intersects(ST_Transform(hex_center_3857(l.q, l.r), 4326), ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326))
  limit 200;
$$;

-- Frees abandoned cells and tells their owners. Run daily (pg_cron below).
create or replace function public.expire_territory()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  rec record;
  total int := 0;
begin
  for rec in
    with gone as (
      delete from public.territory_cells t
      where t.last_visited_at < now() - make_interval(days => rule('decay_free_days')::int)
      returning t.owner_id
    ) select owner_id, count(*)::int as cnt from gone group by owner_id
  loop
    perform notify(rec.owner_id, 'territory_lost', jsonb_build_object('cells', rec.cnt, 'reason', 'decay'));
    total := total + rec.cnt;
  end loop;
  return total;
end $$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('runner-expire-territory', '17 3 * * *', 'select public.expire_territory()');
exception when others then
  raise notice 'pg_cron not available (%); abandoned cells are still hidden and claimable', sqlerrm;
end $$;

-- Season = calendar month (UTC). Points: cells gained + cells taken from others + landmark bonus.
create or replace function public.season_points(p_user uuid, p_at timestamptz)
returns double precision language sql stable security definer set search_path = public, extensions as $$
  select coalesce(sum(a.net_gain_cells + a.captured_cells + a.landmark_cells * rule('landmark_bonus')), 0)::double precision
  from public.activities a
  where a.user_id = p_user and a.status = 'accepted'
    and a.started_at >= date_trunc('month', p_at) and a.started_at < date_trunc('month', p_at) + interval '1 month';
$$;

create or replace function public.my_season()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with me as (select public.season_points(auth.uid(), now()) as pts)
  select jsonb_build_object(
    'points', me.pts,
    'season_start', date_trunc('month', now()),
    'season_end', date_trunc('month', now()) + interval '1 month',
    'landmarks', (select count(*) from public.territory_cells t join public.landmarks l on l.q = t.q and l.r = t.r
                  where t.owner_id = auth.uid()
                    and t.last_visited_at >= now() - make_interval(days => rule('decay_free_days')::int)),
    'weak_cells', (select count(*) from public.territory_cells t where t.owner_id = auth.uid()
                   and t.last_visited_at < now() - make_interval(days => rule('decay_weak_days')::int)
                   and t.last_visited_at >= now() - make_interval(days => rule('decay_free_days')::int)),
    'position', (select count(*) + 1 from public.profiles p
                 where p.id <> auth.uid() and p.show_in_leaderboards and p.profile_visibility <> 'private'
                   and public.season_points(p.id, now()) > me.pts)
  ) from me;
$$;

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
        when 'season' then public.season_points(pl.id, now())
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

-- Clubs ranked by their members' gains this week (and cells owned now).
create or replace function public.club_leaderboard(p_limit int default 50)
returns table (rank bigint, club_id uuid, name text, member_count bigint, weekly_gain bigint, cells bigint, is_member boolean)
language sql stable security definer set search_path = public, extensions as $$
  with stats as (
    select c.id, c.name,
      (select count(*) from public.club_members m where m.club_id = c.id) as member_count,
      (select coalesce(sum(a.net_gain_cells), 0) from public.activities a
         join public.club_members m on m.user_id = a.user_id and m.club_id = c.id
        where a.status = 'accepted' and a.started_at >= date_trunc('week', now())) as weekly_gain,
      (select count(*) from public.territory_cells t join public.club_members m on m.user_id = t.owner_id and m.club_id = c.id
        where t.last_visited_at >= now() - make_interval(days => rule('decay_free_days')::int)) as cells,
      exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid()) as is_member
    from public.clubs c
    where not c.is_private
       or exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid())
  )
  select rank() over (order by s.weekly_gain desc, s.cells desc), s.id, s.name, s.member_count,
         s.weekly_gain::bigint, s.cells, s.is_member
  from stats s
  order by s.weekly_gain desc, s.cells desc
  limit least(coalesce(p_limit, 50), 100);
$$;

-- One club: summary and members (private clubs only for members).
create or replace function public.club_detail(p_club uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  c public.clubs;
  member boolean;
begin
  select * into c from public.clubs where id = p_club;
  if not found then return null; end if;
  member := exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid());
  if c.is_private and not member then return null; end if;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description, 'is_private', c.is_private,
    'is_member', member, 'is_owner', c.owner_id = auth.uid(),
    'invite_code', case when member then c.invite_code end,
    'members', coalesce((
      select jsonb_agg(x order by x.weekly_gain desc, x.cells desc) from (
        select p.id as user_id,
               case when p.id = auth.uid() or p.profile_visibility <> 'private' then p.username else 'Gizli oyuncu' end as username,
               m.role,
               (select coalesce(sum(a.net_gain_cells), 0) from public.activities a
                 where a.user_id = p.id and a.status = 'accepted' and a.started_at >= date_trunc('week', now())) as weekly_gain,
               (select count(*) from public.territory_cells t where t.owner_id = p.id
                 and t.last_visited_at >= now() - make_interval(days => rule('decay_free_days')::int)) as cells,
               p.id = auth.uid() as is_me
        from public.club_members m join public.profiles p on p.id = m.user_id
        where m.club_id = c.id
      ) x), '[]'::jsonb)
  );
end $$;

revoke execute on function public.hex_at(double precision, double precision), public.expire_territory(),
  public.season_points(uuid, timestamptz), public.submit_activity_core(jsonb) from anon, public, authenticated;
revoke execute on function public.cells_in_bbox(double precision, double precision, double precision, double precision),
  public.landmarks_in_bbox(double precision, double precision, double precision, double precision),
  public.my_season(), public.club_leaderboard(int), public.club_detail(uuid) from anon, public;
grant execute on function public.cells_in_bbox(double precision, double precision, double precision, double precision),
  public.landmarks_in_bbox(double precision, double precision, double precision, double precision),
  public.my_season(), public.club_leaderboard(int), public.club_detail(uuid) to authenticated;
grant execute on function public.leaderboard(text, text, public.athlete_level, double precision, double precision,
  double precision, int, text) to authenticated;
