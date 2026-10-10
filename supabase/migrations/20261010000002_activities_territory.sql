-- Activities, raw GPS points, territories and the authoritative claim logic.
--
-- Clients never write these tables directly: they call submit_activity(),
-- which validates the raw points, computes the claimable area with PostGIS
-- and applies ownership changes in one transaction.

-- ---------------------------------------------------------------------------
-- Game rules (keep in sync with mobile/src/domain/rules.ts)
-- ---------------------------------------------------------------------------
create or replace function public.rule(name text)
returns double precision language sql immutable as $$
  select case name
    when 'max_accuracy_m' then 30
    when 'min_claim_distance_m' then 400
    when 'loop_close_m' then 75
    when 'corridor_half_width_m' then 15
    when 'max_claim_area_m2' then 5000000
    when 'public_trim_m' then 200
    when 'max_points' then 20000
    when 'max_age_days' then 7
  end;
$$;

create or replace function public.max_speed_mps(t public.activity_type)
returns double precision language sql immutable as $$
  select case t when 'walk' then 3.5 when 'run' then 8.0 when 'ride' then 22.0 end;
$$;

-- UTM zone for metric operations near a geometry.
create or replace function public.utm_srid(g geometry)
returns integer language sql immutable set search_path = public, extensions as $$
  select case when ST_Y(ST_Centroid(g)) >= 0 then 32600 else 32700 end
         + least(60, greatest(1, floor((ST_X(ST_Centroid(g)) + 180) / 6)::int + 1));
$$;

-- Normalises any geometry to a valid MultiPolygon in EPSG:4326.
create or replace function public.as_area(g geometry)
returns geometry language sql immutable set search_path = public, extensions as $$
  select ST_Multi(ST_CollectionExtract(ST_MakeValid(coalesce(g, 'GEOMETRYCOLLECTION EMPTY'::geometry)), 3));
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null,
  type public.activity_type not null,
  title text not null default '' check (length(title) <= 80),
  visibility public.visibility not null default 'followers',
  started_at timestamptz not null,
  ended_at timestamptz not null check (ended_at >= started_at),
  moving_time_s double precision not null check (moving_time_s >= 0),
  distance_m double precision not null default 0,   -- server-computed
  status text not null check (status in ('accepted', 'rejected')),
  rejection_reasons text[] not null default '{}',
  claim_notes text[] not null default '{}',
  claimed_area_m2 double precision not null default 0,
  net_gain_m2 double precision not null default 0,
  trace_hash text not null,
  -- Trimmed + privacy-zone-filtered + simplified route that may be shown to others.
  public_route geometry (geometry, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index activities_user_time_idx on public.activities (user_id, started_at desc);
create index activities_trace_hash_idx on public.activities (trace_hash);

-- Full-resolution route, owner-only.
create table public.activity_routes (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  route geometry (multilinestring, 4326) not null
);

-- Raw fixes as submitted. Owner-only; purged after a retention period.
create table public.route_points (
  activity_id uuid not null references public.activities (id) on delete cascade,
  seq integer not null,
  segment integer not null,
  recorded_at timestamptz not null,
  geom geometry (point, 4326) not null,
  accuracy_m real not null,
  speed_mps real,
  altitude_m real,
  mocked boolean not null default false,
  primary key (activity_id, seq)
);

-- One (multi)polygon per player.
create table public.territories (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  geom geometry (multipolygon, 4326) not null,
  area_m2 double precision not null default 0,
  updated_at timestamptz not null default now()
);
create index territories_geom_idx on public.territories using gist (geom);

create table public.territory_events (
  id bigint generated always as identity primary key,
  activity_id uuid references public.activities (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_user_id uuid references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('claimed', 'captured')),
  area_m2 double precision not null,
  created_at timestamptz not null default now()
);
create index territory_events_user_idx on public.territory_events (user_id, created_at desc);

create table public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null unique references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index feed_posts_user_idx on public.feed_posts (user_id, created_at desc);

create table public.post_likes (
  post_id uuid not null references public.feed_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Visibility helper
-- ---------------------------------------------------------------------------
create or replace function public.can_view_activity(a public.activities, viewer uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select a.user_id = viewer or (
    a.status = 'accepted' and (
      (a.visibility = 'public'
        and (select profile_visibility from public.profiles where id = a.user_id) <> 'private')
      or (a.visibility in ('public', 'followers') and public.is_follower(a.user_id, viewer))
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- submit_activity
-- payload: {
--   client_id, type, started_at (ms), ended_at (ms), moving_time_s, title, visibility,
--   points: [[lat, lng, accuracy_m, ts_ms, segment, speed_mps|null, altitude_m|null, mocked], ...]
-- }
-- ---------------------------------------------------------------------------
create or replace function public.submit_activity(payload jsonb)
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
  v_srid int;
  v_claim geometry;           -- multipolygon, 4326
  v_claim_area double precision := 0;
  v_net_gain double precision := 0;
  v_before geometry;
  v_public geometry;
  v_len double precision;
  v_activity_id uuid;
  v_captured int := 0;
  r record;
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
      'distance_m', existing.distance_m, 'claimed_area_m2', existing.claimed_area_m2,
      'net_gain_m2', existing.net_gain_m2, 'captured_from_users', 0);
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

  if v_status = 'accepted' and v_route is not null then
    if v_distance < rule('min_claim_distance_m') then
      notes := notes || 'below_min_distance'::text;
    else
      v_srid := utm_srid(v_route);
      -- Corridor around the travelled path (pause gaps are not bridged).
      v_claim := ST_Buffer(ST_Transform(v_route, v_srid), rule('corridor_half_width_m'), 'quad_segs=4');
      -- Loop bonus: enclosed area if the route returns near its start.
      if n >= 4 and ST_Distance(ST_StartPoint(v_full_line)::geography, ST_EndPoint(v_full_line)::geography)
           <= rule('loop_close_m') then
        v_claim := ST_Union(
          v_claim,
          ST_MakeValid(
            ST_MakePolygon(ST_AddPoint(ST_Transform(v_full_line, v_srid), ST_Transform(ST_StartPoint(v_full_line), v_srid))),
            'method=structure'));
        notes := notes || 'loop'::text;
      else
        notes := notes || 'corridor'::text;
      end if;
      v_claim_area := ST_Area(v_claim);
      if v_claim_area > rule('max_claim_area_m2') then
        notes := notes || 'claim_too_large'::text;
        v_claim := null;
        v_claim_area := 0;
      else
        v_claim := as_area(ST_ReducePrecision(ST_Transform(v_claim, 4326), 0.0000001));
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
    distance_m, status, rejection_reasons, claim_notes, claimed_area_m2, trace_hash, public_route)
  values (
    uid, v_client, v_type, v_title, v_visibility, v_started, v_ended, v_moving,
    v_distance, v_status, reasons, notes, 0, v_hash, v_public)
  returning id into v_activity_id;

  insert into public.route_points (activity_id, seq, segment, recorded_at, geom, accuracy_m, speed_mps, altitude_m, mocked)
  select v_activity_id, seq, segment, ts, geom, accuracy_m, speed_mps, altitude_m, mocked from _pts;

  if v_route is not null then
    insert into public.activity_routes (activity_id, user_id, route) values (v_activity_id, uid, v_route);
  end if;

  -- ---- Ownership ----------------------------------------------------------
  if v_claim is not null and not ST_IsEmpty(v_claim) then
    v_claim_area := ST_Area(v_claim::geography);

    -- Lock every affected territory in a stable order to avoid deadlocks.
    perform 1 from public.territories t
    where t.user_id = uid or ST_Intersects(t.geom, v_claim)
    order by t.user_id for update;

    for r in
      select t.user_id, t.geom from public.territories t
      where t.user_id <> uid and ST_Intersects(t.geom, v_claim)
    loop
      declare
        taken double precision := ST_Area(ST_Intersection(r.geom, v_claim)::geography);
        remaining geometry := as_area(ST_Difference(r.geom, v_claim));
      begin
        if taken >= 1 then
          update public.territories
            set geom = remaining, area_m2 = coalesce(ST_Area(remaining::geography), 0), updated_at = now()
            where user_id = r.user_id;
          insert into public.territory_events (activity_id, user_id, from_user_id, kind, area_m2)
            values (v_activity_id, uid, r.user_id, 'captured', taken);
          perform notify(r.user_id, 'territory_lost',
            jsonb_build_object('area_m2', round(taken), 'by_user_id', uid));
          v_captured := v_captured + 1;
        end if;
      end;
    end loop;

    select geom into v_before from public.territories where user_id = uid;
    v_net_gain := case when v_before is null then v_claim_area
                       else coalesce(ST_Area(ST_Difference(v_claim, v_before)::geography), 0) end;

    insert into public.territories as t (user_id, geom, area_m2)
    values (uid, v_claim, v_claim_area)
    on conflict (user_id) do update
      set geom = as_area(ST_SimplifyPreserveTopology(ST_Union(t.geom, excluded.geom), 0.000005)),
          updated_at = now();
    update public.territories set area_m2 = ST_Area(geom::geography) where user_id = uid;

    insert into public.territory_events (activity_id, user_id, kind, area_m2)
      values (v_activity_id, uid, 'claimed', v_net_gain);

    update public.activities
      set claimed_area_m2 = v_claim_area, net_gain_m2 = v_net_gain
      where id = v_activity_id;
  end if;

  -- ---- Feed + notifications ----------------------------------------------
  if v_status = 'accepted' then
    if v_visibility <> 'private' then
      insert into public.feed_posts (activity_id, user_id) values (v_activity_id, uid);
    end if;
    perform notify(uid, 'activity_completed',
      jsonb_build_object('activity_id', v_activity_id, 'distance_m', round(v_distance)));
    if v_net_gain >= 1 then
      perform notify(uid, 'territory_gained',
        jsonb_build_object('activity_id', v_activity_id, 'area_m2', round(v_net_gain)));
    end if;
  end if;

  return jsonb_build_object(
    'activity_id', v_activity_id,
    'status', v_status,
    'reasons', to_jsonb(reasons || notes),
    'distance_m', v_distance,
    'claimed_area_m2', v_claim_area,
    'net_gain_m2', v_net_gain,
    'captured_from_users', v_captured);
end $$;

-- ---------------------------------------------------------------------------
-- Map query: territories inside a bounding box. Private profiles are anonymised.
-- ---------------------------------------------------------------------------
create or replace function public.territories_in_bbox(
  min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision)
returns table (user_id uuid, username text, is_mine boolean, area_m2 double precision, geojson jsonb)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  box geometry := ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326);
  tolerance double precision := greatest(max_lng - min_lng, max_lat - min_lat) / 2000;
begin
  -- Refuse continent-scale queries; the client asks the user to zoom in.
  if max_lng - min_lng > 1 or max_lat - min_lat > 1 then
    return;
  end if;
  return query
  select
    t.user_id,
    case when t.user_id = auth.uid() or p.profile_visibility <> 'private' then p.username end,
    t.user_id = auth.uid(),
    t.area_m2,
    ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Intersection(t.geom, box), tolerance), 6)::jsonb
  from public.territories t
  join public.profiles p on p.id = t.user_id
  where t.geom && box and ST_Intersects(t.geom, box)
  limit 500;
end $$;

-- ---------------------------------------------------------------------------
-- Owner edits
-- ---------------------------------------------------------------------------
create or replace function public.update_activity(p_id uuid, p_title text, p_visibility public.visibility)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.activities
    set title = left(coalesce(p_title, ''), 80), visibility = p_visibility, updated_at = now()
    where id = p_id and user_id = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_visibility = 'private' then
    delete from public.feed_posts where activity_id = p_id;
  else
    insert into public.feed_posts (activity_id, user_id)
    select id, user_id from public.activities where id = p_id and status = 'accepted'
    on conflict (activity_id) do nothing;
  end if;
end $$;

-- Deleting an activity removes its route and feed post. Territory already won
-- stays (ownership may have changed hands since), which the app explains.
create or replace function public.delete_activity(p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.activities where id = p_id and user_id = auth.uid();
end $$;

create or replace function public.purge_old_route_points(keep_days int default 30)
returns int language sql security definer set search_path = public, extensions as $$
  with d as (
    delete from public.route_points rp using public.activities a
    where a.id = rp.activity_id and a.created_at < now() - make_interval(days => keep_days)
    returning 1)
  select count(*)::int from d;
$$;
