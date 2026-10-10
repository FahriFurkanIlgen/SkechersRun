-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- 1) New activity source 'runner_watch': recorded by the Runner Apple Watch app
--    (and delivered through Apple Health), as opposed to other apps' workouts.
-- 2) Extension point for validation: submit_activity_core() now also applies
--    activity_extra_checks(), so later checks do not need to copy the core.
-- 3) First extra check, 'synthetic_route': generated GPX/FIT files (route
--    drawing tools, replayed tracks) move at a perfectly constant speed and
--    sampling interval, which real GPS never does. Imports have no "mocked"
--    flag, so this is their main protection; it applies to every source.

alter table public.activities drop constraint if exists activities_source_check;
alter table public.activities add constraint activities_source_check
  check (source in ('phone', 'apple_health', 'health_connect', 'runner_watch'));

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
    -- Coefficient of variation of step speeds below this is not real GPS.
    when 'synthetic_speed_cv' then 0.02
    -- ...judged only on routes with at least this many moving steps.
    when 'synthetic_min_steps' then 30
  end;
$$;

create or replace function public.activity_extra_checks(payload jsonb)
returns text[] language plpgsql stable set search_path = public, extensions as $$
declare
  reasons text[] := '{}';
  n_steps int;
  speed_cv double precision;
  dt_spread double precision;
begin
  with pts as (
    select
      (e.ordinality - 1)::int as seq,
      coalesce((e.value ->> 4)::int, 0) as segment,
      (e.value ->> 3)::double precision / 1000 as t,
      ST_SetSRID(ST_MakePoint((e.value ->> 1)::double precision, (e.value ->> 0)::double precision), 4326) as geom
    from jsonb_array_elements(coalesce(payload -> 'points', '[]')) with ordinality e
    where abs((e.value ->> 0)::double precision) <= 90
      and abs((e.value ->> 1)::double precision) <= 180
      and (e.value ->> 2)::real <= rule('max_accuracy_m')
  ), steps as (
    select
      ST_Distance(geom::geography, lag(geom) over w::geography) as d,
      t - lag(t) over w as dt
    from pts
    window w as (partition by segment order by seq)
  ), moving as (
    select d / dt as v, dt from steps where dt > 0 and d > 1
  )
  select count(*), stddev_pop(v) / nullif(avg(v), 0), max(dt) - min(dt)
    into n_steps, speed_cv, dt_spread
  from moving;

  if n_steps >= rule('synthetic_min_steps') and speed_cv < rule('synthetic_speed_cv') then
    reasons := reasons || 'synthetic_route'::text;
  end if;
  return reasons;
end $$;

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

  -- The core already built the default 'trimmed' route.
  update public.activities a
    set route_share = mode,
        public_route = case when a.status = 'accepted'
          then public.compute_public_route(a.user_id, (select public.route_as_line(r.route) from public.activity_routes r where r.activity_id = a.id), mode)
          end
    where a.id = aid and a.user_id = auth.uid() and a.route_share <> mode;
  return res;
end $$;

revoke execute on function public.activity_extra_checks(jsonb), public.submit_activity_core(jsonb) from anon, public, authenticated;
revoke execute on function public.submit_activity(jsonb) from anon, public;
grant execute on function public.submit_activity(jsonb) to authenticated;
