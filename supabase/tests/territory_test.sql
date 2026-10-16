-- SQL tests for submit_activity, ownership changes, validation and privacy.
-- Run with supabase/tests/run.sh. Any failed assertion aborts with an error.

create schema test;

-- Builds a points payload walking through (east, north) metre offsets from an
-- origin at about `speed`, one fix every `step_m` metres. Real GPS speed varies;
-- `jitter` (±fraction, deterministic) mimics that. jitter = 0 gives the perfectly
-- constant speed of a generated track (rejected as synthetic_route).
create function test.route(
  lat0 double precision, lng0 double precision, offsets double precision[][],
  speed double precision, t0 timestamptz, step_m double precision default 10,
  mocked boolean default false, jitter double precision default 0.15)
returns jsonb language plpgsql as $$
declare
  pts jsonb := '[]';
  m_lat constant double precision := 111195;
  m_lng double precision := 111195 * cos(radians(lat0));
  t double precision := extract(epoch from t0) * 1000;
  i int; s int; steps int; len double precision; k int := 0;
  x0 double precision; y0 double precision; x1 double precision; y1 double precision;
begin
  pts := pts || jsonb_build_array(jsonb_build_array(lat0 + offsets[1][2] / m_lat, lng0 + offsets[1][1] / m_lng, 5, t, 0, speed, null, mocked));
  for i in 2 .. array_length(offsets, 1) loop
    x0 := offsets[i-1][1]; y0 := offsets[i-1][2]; x1 := offsets[i][1]; y1 := offsets[i][2];
    len := sqrt((x1-x0)^2 + (y1-y0)^2);
    steps := greatest(1, round(len / step_m)::int);
    for s in 1 .. steps loop
      k := k + 1;
      t := t + (len / steps) / (speed * (1 + jitter * sin(k * 1.7))) * 1000;
      pts := pts || jsonb_build_array(jsonb_build_array(
        lat0 + (y0 + (y1-y0) * s / steps) / m_lat,
        lng0 + (x0 + (x1-x0) * s / steps) / m_lng, 5, t, 0, speed, null, mocked));
    end loop;
  end loop;
  return pts;
end $$;

create function test.payload(client uuid, typ text, pts jsonb, vis text default 'public')
returns jsonb language sql as $$
  select jsonb_build_object(
    'client_id', client, 'type', typ, 'visibility', vis, 'title', 'test',
    'started_at', (pts -> 0 ->> 3)::double precision,
    'ended_at', (pts -> -1 ->> 3)::double precision,
    'moving_time_s', ((pts -> -1 ->> 3)::double precision - (pts -> 0 ->> 3)::double precision) / 1000,
    'points', pts);
$$;

create function test.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test', '{"username":"ayse"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test', '{"username":"bora"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test', '{"username":"ayse"}');

select test.assert((select count(*) = 3 from public.profiles), 'profiles created by trigger');
select test.assert((select username <> 'ayse' from public.profiles where id = '00000000-0000-0000-0000-00000000000c'),
  'duplicate username gets a unique suffix');

update public.profiles set profile_visibility = 'public' where id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set profile_visibility = 'private' where id = '00000000-0000-0000-0000-00000000000b';

-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

create temp table r (name text primary key, res jsonb);
grant all on r to authenticated;

-- A: 300 m square loop, walking 1.4 m/s, 2 hours ago.
insert into r select 'a_loop', public.submit_activity(test.payload(
  '10000000-0000-0000-0000-000000000001', 'walk',
  test.route(41.0, 29.0, '{{0,0},{300,0},{300,300},{0,300},{0,5}}', 1.4, now() - interval '2 hours')));

select test.assert((select res ->> 'status' = 'accepted' from r where name = 'a_loop'), 'loop accepted');
-- 300 m square at 41°N, cell edge ≈ 98 m: ~4 interior cells + the cells along the perimeter.
select test.assert((select (res ->> 'claimed_cells')::int between 8 and 24 from r where name = 'a_loop'),
  'loop claims route cells + interior cells, got ' || (select res ->> 'claimed_cells' from r where name = 'a_loop'));
select test.assert((select count(*) = (select (res ->> 'claimed_cells')::int from r where name = 'a_loop')
  from public.cells_in_bbox(28.99, 40.99, 29.01, 41.01) where is_mine), 'claimed cells are stored and visible on the map');
select test.assert((select res -> 'reasons' ? 'loop' from r where name = 'a_loop'), 'loop note present');
select test.assert((select (res ->> 'net_gain_cells')::int = (res ->> 'claimed_cells')::int from r where name = 'a_loop'),
  'first claim is all net gain');

-- Idempotent retry.
select test.assert((select public.submit_activity(test.payload(
  '10000000-0000-0000-0000-000000000001', 'walk',
  test.route(41.0, 29.0, '{{0,0},{300,0},{300,300},{0,300},{0,5}}', 1.4, now() - interval '2 hours'))) ->> 'activity_id'
  = (select res ->> 'activity_id' from r where name = 'a_loop')), 'retry with same client_id is idempotent');

-- Same loop again an hour later: accepted but no new area.
insert into r select 'a_repeat', public.submit_activity(test.payload(
  '10000000-0000-0000-0000-000000000002', 'walk',
  test.route(41.0, 29.0, '{{0,0},{300,0},{300,300},{0,300},{0,5}}', 1.4, now() - interval '50 minutes')));
select test.assert((select res ->> 'status' = 'accepted' from r where name = 'a_repeat'), 'repeat loop accepted');
select test.assert((select (res ->> 'net_gain_cells')::int = 0 and (res ->> 'claimed_cells')::int > 0 from r where name = 'a_repeat'),
  'repeating own route gains no new cells, got ' || (select res ->> 'net_gain_cells' from r where name = 'a_repeat'));

-- Overlapping in time with the first activity.
insert into r select 'a_overlap', public.submit_activity(test.payload(
  '10000000-0000-0000-0000-000000000003', 'walk',
  test.route(41.01, 29.01, '{{0,0},{600,0}}', 1.4, now() - interval '2 hours' + interval '1 minute')));
select test.assert((select res -> 'reasons' ? 'overlapping_activity' and res ->> 'status' = 'rejected' from r where name = 'a_overlap'),
  'time-overlapping activity rejected');

-- Walking at 6 m/s.
insert into r select 'a_fast', public.submit_activity(test.payload(
  '10000000-0000-0000-0000-000000000004', 'walk',
  test.route(41.02, 29.02, '{{0,0},{2000,0}}', 6, now() - interval '5 hours')));
select test.assert((select res -> 'reasons' ? 'impossible_average_speed' from r where name = 'a_fast'), 'impossible walking speed rejected');

insert into r select 'a_teleport', public.submit_activity(test.payload(
  '10000000-0000-0000-0000-000000000006', 'run',
  (select jsonb_agg(case when (ord % 10) = 0
                         then jsonb_set(e, '{0}', to_jsonb((e ->> 0)::float + 0.01))
                         else e end order by ord)
   from jsonb_array_elements(test.route(41.04, 29.04, '{{0,0},{2000,0}}', 3, now() - interval '12 hours')) with ordinality as x(e, ord))));
select test.assert((select res -> 'reasons' ? 'route_jumps' from r where name = 'a_teleport'),
  'teleporting route rejected: ' || (select res::text from r where name = 'a_teleport'));

-- Mock locations.
insert into r select 'a_mock', public.submit_activity(test.payload(
  '10000000-0000-0000-0000-000000000007', 'walk',
  test.route(41.05, 29.05, '{{0,0},{800,0}}', 1.4, now() - interval '20 hours', 10, true)));
select test.assert((select res -> 'reasons' ? 'mock_location' from r where name = 'a_mock'), 'mock location rejected');

-- Short walk: accepted, no claim.
insert into r select 'a_short', public.submit_activity(test.payload(
  '10000000-0000-0000-0000-000000000008', 'walk',
  test.route(41.06, 29.06, '{{0,0},{200,0}}', 1.4, now() - interval '22 hours')));
select test.assert((select res ->> 'status' = 'accepted' and res -> 'reasons' ? 'below_min_distance'
  and (res ->> 'claimed_cells')::int = 0 from r where name = 'a_short'), 'short activity accepted without claim');

-- Open route: corridor only (1 km * 30 m ~ 30k m2).
insert into r select 'a_corridor', public.submit_activity(test.payload(
  '10000000-0000-0000-0000-000000000009', 'run',
  test.route(41.07, 29.07, '{{0,0},{1000,0}}', 3, date_trunc('hour', now()) - interval '30 hours')));
-- 1 km straight run through cells ~147 m apart (centre to centre along the row).
select test.assert((select (res ->> 'claimed_cells')::int between 5 and 12 and res -> 'reasons' ? 'corridor'
  from r where name = 'a_corridor'), 'open route claims the cells it runs through, got ' || (select res ->> 'claimed_cells' from r where name = 'a_corridor'));

-- Privacy zone at the start of a route: the public route must avoid it.
select public.set_privacy_zones('[{"label":"Ev","lat":41.08,"lng":29.08,"radius_m":300}]');
insert into r select 'a_private', public.submit_activity(test.payload(
  '10000000-0000-0000-0000-000000000010', 'walk',
  test.route(41.08, 29.08, '{{0,0},{2000,0}}', 1.4, now() - interval '40 hours')));
select test.assert((
  select not ST_DWithin(a.public_route::geography, ST_MakePoint(29.08, 41.08)::geography, 300)
  from public.activities a where a.id = (select (res ->> 'activity_id')::uuid from r where name = 'a_private')),
  'public route stays out of the privacy zone and trimmed start');

-- ---------------------------------------------------------------------------
-- B overlaps A's loop and captures part of it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.assert((select count(*) = 0 from public.route_points), 'B cannot read A''s raw points');
select test.assert((select count(*) = 0 from public.privacy_zones), 'B cannot read A''s privacy zones');
select test.assert((select count(*) = 0 from public.territory_cells), 'cells not directly readable');

-- A's cells were just claimed and are protected (0013); let the protection run out.
reset role;
update public.territory_cells set protected_until = now() - interval '1 minute'
  where owner_id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into r select 'b_capture', public.submit_activity(test.payload(
  '20000000-0000-0000-0000-000000000001', 'run',
  test.route(41.0, 29.0, '{{150,150},{450,150},{450,450},{150,450},{150,155}}', 3, now() - interval '30 minutes')));
select test.assert((select res ->> 'status' = 'accepted' and (res ->> 'captured_from_users')::int = 1
  and (res ->> 'captured_cells')::int >= 1 from r where name = 'b_capture'),
  'B captured cells from A: ' || (select res::text from r where name = 'b_capture'));

-- Duplicate trace from another user.
insert into r select 'b_dup', public.submit_activity(test.payload(
  '20000000-0000-0000-0000-000000000002', 'walk',
  test.route(41.07, 29.07, '{{0,0},{1000,0}}', 3, date_trunc('hour', now()) - interval '30 hours')));
select test.assert((select res -> 'reasons' ? 'duplicate_trace' from r where name = 'b_dup'), 'copied trace rejected: ' || (select res::text from r where name = 'b_dup'));

-- A sees B anonymised (B's profile is private) and B's territory.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.assert((select count(*) = 2 and bool_or(is_mine) and bool_or(not is_mine and username is null)
  from (select distinct is_mine, username from public.cells_in_bbox(28.99, 40.99, 29.01, 41.01)) x),
  'bbox query returns both players, private player anonymised');
select test.assert((select count(*) = 0 from public.cells_in_bbox(28.0, 40.0, 29.5, 41.5)), 'zoomed-out query returns nothing');
select test.assert((select count(*) >= 1 from public.notifications where kind = 'territory_lost'), 'A notified about lost territory');
select test.assert((select count(*) >= 1 from public.notifications where kind = 'territory_gained'), 'A notified about gained territory');

-- Feed: A sees own public posts; B's posts invisible to A (not following, private).
select test.assert((select count(*) > 0 and bool_and(username = 'ayse') from public.get_feed()), 'feed shows own posts only');
select test.assert((select public.follow_user('00000000-0000-0000-0000-00000000000b') = 'pending'), 'following a private profile creates a request');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.respond_follow('00000000-0000-0000-0000-00000000000a', true);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.assert((select count(*) filter (where username = 'bora') = 1 from public.get_feed()), 'accepted follower sees B''s post');
select test.assert((select public.toggle_like((select id from public.get_feed() where username = 'bora'))), 'like toggles on');

-- Leaderboards.
select test.assert((select count(*) = 1 from public.leaderboard('global', 'area') where is_me), 'global leaderboard includes me');
select test.assert((select count(*) = 0 from public.leaderboard('global', 'area') where username = 'bora'),
  'private profiles excluded from leaderboards');
select test.assert((select count(*) >= 1 from public.leaderboard('nearby', 'area', null, 41.0, 29.0, 5)), 'nearby leaderboard works');
select test.assert((select count(*) >= 1 from public.leaderboard('global', 'active_days', 'beginner')), 'consistency leaderboard works');

-- Clubs.
select test.assert((select (public.create_club('Sabah Koşucuları', 'Erken kalkanlar', true)).invite_code is not null), 'club created');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.assert((select count(*) = 0 from public.list_clubs()), 'private club hidden from non-members');
-- The invite code is shared out of band; read it as superuser for the test.
reset role;
create table test.code as select invite_code from public.clubs limit 1;
grant select on test.code to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.join_club((select invite_code from test.code));
select test.assert((select count(*) = 1 and bool_and(is_member) from public.list_clubs()), 'joined private club by invite code');

-- Owner edits and deletes.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.update_activity((select (res ->> 'activity_id')::uuid from r where name = 'a_loop'), 'Akşam turu', 'private');
select test.assert((select count(*) = 0 from public.feed_posts f where f.activity_id = (select (res ->> 'activity_id')::uuid from r where name = 'a_loop')),
  'making an activity private removes it from the feed');
select public.delete_activity((select (res ->> 'activity_id')::uuid from r where name = 'a_short'));
select test.assert((select count(*) = 0 from public.activities where id = (select (res ->> 'activity_id')::uuid from r where name = 'a_short')),
  'owner can delete an activity');

-- Location data deletion.
select public.delete_my_location_data();
select test.assert((select count(*) = 0 from public.route_points), 'raw points deleted');
select test.assert((select count(*) = 0 from public.cells_in_bbox(28.99, 40.99, 29.01, 41.01) where is_mine), 'territory deleted');

-- Account deletion cascades.
select public.delete_my_account();
reset role;
select test.assert((select count(*) = 0 from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 'account deletion cascades');
select test.assert((select count(*) = 0 from public.activities where user_id = '00000000-0000-0000-0000-00000000000a'), 'activities removed with account');

-- ---------------------------------------------------------------------------
-- Design alignment (0004): sharing modes, leaderboard opt-out, friends filter.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';

insert into r select 'c_stats', public.submit_activity(test.payload(
  '30000000-0000-0000-0000-000000000001', 'walk',
  test.route(41.2, 29.2, '{{0,0},{1500,0}}', 1.4, now() - interval '3 hours')) || '{"route_share":"stats_only"}');
select test.assert((select a.public_route is null and a.route_share = 'stats_only' from public.activities a
  where a.id = (select (res ->> 'activity_id')::uuid from r where name = 'c_stats')), 'stats-only share hides the route');

insert into r select 'c_full', public.submit_activity(test.payload(
  '30000000-0000-0000-0000-000000000002', 'walk',
  test.route(41.3, 29.3, '{{0,0},{1500,0}}', 1.4, now() - interval '6 hours')) || '{"route_share":"full"}');
select test.assert((select ST_DWithin(a.public_route::geography, ST_MakePoint(29.3, 41.3)::geography, 20)
  from public.activities a where a.id = (select (res ->> 'activity_id')::uuid from r where name = 'c_full')),
  'full share keeps the start (no privacy zone set)');

insert into r select 'c_trim', public.submit_activity(test.payload(
  '30000000-0000-0000-0000-000000000003', 'walk',
  test.route(41.4, 29.4, '{{0,0},{1500,0}}', 1.4, now() - interval '9 hours')));
select test.assert((select not ST_DWithin(a.public_route::geography, ST_MakePoint(29.4, 41.4)::geography, 290)
  from public.activities a where a.id = (select (res ->> 'activity_id')::uuid from r where name = 'c_trim')),
  'default share trims the first 300 m');

select public.update_activity((select (res ->> 'activity_id')::uuid from r where name = 'c_trim'), 'x', 'public', 'stats_only');
select test.assert((select a.public_route is null from public.activities a
  where a.id = (select (res ->> 'activity_id')::uuid from r where name = 'c_trim')), 'changing share mode recomputes the public route');

select test.assert((select count(*) = 1 from public.leaderboard('global', 'area') where is_me), 'C appears on own leaderboard');
update public.profiles set show_in_leaderboards = false, profile_visibility = 'public' where id = auth.uid();
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.assert((select count(*) = 0 from public.leaderboard('global', 'area') r2
  where r2.user_id = '00000000-0000-0000-0000-00000000000c'), 'leaderboard opt-out respected');
select test.assert((select bool_and(r2.is_me) from public.leaderboard('global', 'area', null, null, null, 10, 50, 'friends') r2),
  'friends filter with no friends shows only me');
reset role;

-- ---------------------------------------------------------------------------
-- Activity source (0006): imports from health platforms.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into r select 'b_import', public.submit_activity(test.payload(
  '20000000-0000-0000-0000-000000000099', 'run',
  test.route(41.5, 29.5, '{{0,0},{900,0}}', 3, now() - interval '2 days'))
  || '{"source":"apple_health","external_id":"HK-1","source_device":"Apple Watch"}');
select test.assert((select a.source = 'apple_health' and a.external_id = 'HK-1' and a.source_device = 'Apple Watch'
  and a.status = 'accepted' and a.claimed_cells > 0
  from public.activities a where a.id = (select (res ->> 'activity_id')::uuid from r where name = 'b_import')),
  'imported workout is stored with its source and claims cells');
select test.assert((select public.submit_activity(test.payload(
  '20000000-0000-0000-0000-000000000098', 'run',
  test.route(41.6, 29.6, '{{0,0},{900,0}}', 3, now() - interval '3 days'))
  || '{"source":"apple_health","external_id":"HK-1"}') -> 'reasons' ? 'duplicate_import'), 'same external workout cannot be imported twice');
reset role;

-- ---------------------------------------------------------------------------
-- 0007: Runner watch source and synthetic route detection.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.assert((select public.submit_activity(test.payload(
  '20000000-0000-0000-0000-000000000097', 'run',
  test.route(41.7, 29.7, '{{0,0},{900,0},{900,600}}', 3, now() - interval '4 days', jitter => 0))
  || '{"source":"health_connect","external_id":"HC-9"}') -> 'reasons' ? 'synthetic_route'),
  'constant-speed generated track is rejected as synthetic');
insert into r select 'b_watch', public.submit_activity(test.payload(
  '20000000-0000-0000-0000-000000000096', 'run',
  test.route(41.8, 29.8, '{{0,0},{900,0}}', 3, now() - interval '5 days'))
  || '{"source":"runner_watch","external_id":"HK-W1","source_device":"Apple Watch"}');
select test.assert((select a.source = 'runner_watch' and a.status = 'accepted'
  from public.activities a where a.id = (select (res ->> 'activity_id')::uuid from r where name = 'b_watch')),
  'workout recorded by the Runner watch app is accepted with its source');
reset role;

-- 0008: own privacy zones readable as coordinates, nobody else's.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.set_privacy_zones('[{"label":"Ev","lat":41.2,"lng":29.2,"radius_m":300}]'::jsonb);
select test.assert((select count(*) = 1 and bool_and(abs(lat - 41.2) < 0.01 and radius_m >= 300) from public.my_privacy_zones()),
  'my_privacy_zones returns own zone near the real centre');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.assert((select count(*) = 0 from public.my_privacy_zones() where label = 'Ev'), 'other users zones are not returned');
reset role;

-- 0010: own activities and route points can be restored, nobody else's.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.assert((select count(*) > 0 from public.my_activities()), 'my_activities returns own activities');
select test.assert((select count(*) > 0 from public.my_route_points((select id from public.my_activities() where status = 'accepted' limit 1))),
  'my_route_points returns own points');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.assert((select count(*) = 0 from public.my_route_points(
  (select (res ->> 'activity_id')::uuid from r where name = 'b_watch'))), 'other users route points are not returned');
reset role;

-- 0011: bulk route points, owner only.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.assert((select count(*) > 0 and bool_and(jsonb_array_length(points) > 1)
  from public.my_route_points_bulk(array(select id from public.my_activities() where status = 'accepted'))),
  'my_route_points_bulk returns own routes as compact arrays');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.assert((select count(*) = 0 from public.my_route_points_bulk(
  array[(select (res ->> 'activity_id')::uuid from r where name = 'b_watch')])), 'bulk does not return other users routes');
reset role;

-- 0012: districts.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update public.profiles set home_city = 'İstanbul', home_district = 'Kadıköy' where id = auth.uid();
insert into r select 'a_kadikoy', public.submit_activity(test.payload(
  '30000000-0000-0000-0000-000000000001', 'run',
  test.route(42.0, 30.0, '{{0,0},{900,0}}', 3, now() - interval '20 minutes'))
  || '{"city":"İstanbul","district":"Kadıköy"}');
select test.assert((select a.district = 'Kadıköy' from public.activities a
  where a.id = (select (res ->> 'activity_id')::uuid from r where name = 'a_kadikoy')), 'activity stores its district');
reset role;
select test.assert((select count(*) > 0 from public.territory_cells t where t.district = 'Kadıköy'), 'claimed cells store the district');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.assert((select bool_or(l.is_me) from public.district_leaderboard('İstanbul', 'Kadıköy', 'area') l),
  'district leaderboard ranks the player');
select test.assert((select b.district = 'Kadıköy' and b.team_size = 1 and b.weekly_gain > 0 and b.is_mine
  from public.district_battle('İstanbul') b where b.district = 'Kadıköy'), 'district battle counts the home team');
select test.assert((select d.district = 'Kadıköy' from public.my_districts() d limit 1), 'my_districts suggests where I ran');
reset role;

-- ---------------------------------------------------------------------------
-- 0013: game depth (protection, decay, landmarks, seasons, clubs).
reset role;
-- hex_at matches the app's cellAt (src/domain/hex.ts): Moda Sahili → known cell.
select test.assert((select (h.q, h.r) = (select q, r from public.landmarks where name = 'Moda Sahili')
  from public.hex_at(40.9806, 29.0248) h), 'hex_at is consistent with seeded landmarks');
-- A landmark on the next route.
insert into public.landmarks (q, r, name)
select h.q, h.r, 'Test Kalesi' from public.hex_at(43.0, 31.0 + 300 / (111195 * cos(radians(43.0)))) h;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into r select 'b_depth', public.submit_activity(test.payload(
  '40000000-0000-0000-0000-000000000001', 'run',
  test.route(43.0, 31.0, '{{0,0},{900,0}}', 3, now() - interval '3 hours')));
select test.assert((select (res ->> 'landmark_cells')::int = 1 from r where name = 'b_depth'),
  'gaining a landmark cell is counted: ' || (select res::text from r where name = 'b_depth'));
select test.assert((select (p ->> 'points')::numeric >= (select (res ->> 'net_gain_cells')::numeric + 5 from r where name = 'b_depth')
  from public.my_season() p), 'season points include the landmark bonus');
select test.assert((select count(*) > 0 from public.leaderboard('global', 'season') l where l.is_me), 'season leaderboard');
select test.assert((select bool_or(c.protected) and bool_or(c.landmark = 'Test Kalesi')
  from public.cells_in_bbox(30.99, 42.99, 31.02, 43.01) c), 'new cells are protected; landmark flagged');

-- Someone else runs the same street right away: protected cells are not taken.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into r select 'c_protected', public.submit_activity(test.payload(
  '40000000-0000-0000-0000-000000000002', 'run',
  test.route(43.0, 31.0, '{{0,0},{900,0}}', 3, now() - interval '2 hours')));
select test.assert((select res -> 'reasons' ? 'protected_cells' and (res ->> 'captured_cells')::int = 0 from r where name = 'c_protected'),
  'protected cells cannot be captured: ' || (select res::text from r where name = 'c_protected'));
reset role;
update public.territory_cells set protected_until = now() - interval '1 minute'
  where owner_id = '00000000-0000-0000-0000-00000000000b';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into r select 'c_capture', public.submit_activity(test.payload(
  '40000000-0000-0000-0000-000000000003', 'run',
  test.route(43.0, 31.0, '{{0,0},{900,0}}', 3, now() - interval '1 hour')));
select test.assert((select (res ->> 'captured_cells')::int > 0 from r where name = 'c_capture'),
  'after protection ends, cells can be captured');
reset role;

-- Decay: weak after 21 days, abandoned (hidden, free, expired) after 42.
update public.territory_cells set last_visited_at = now() - interval '30 days'
  where owner_id = '00000000-0000-0000-0000-00000000000c';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.assert((select bool_and(c.weak) from public.cells_in_bbox(30.99, 42.99, 31.02, 43.01) c where c.is_mine),
  'unvisited cells are weak');
select test.assert((select (p ->> 'weak_cells')::int > 0 from public.my_season() p), 'my_season reports weak cells');
reset role;
update public.territory_cells set last_visited_at = now() - interval '50 days'
  where owner_id = '00000000-0000-0000-0000-00000000000c';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.assert((select count(*) = 0 from public.cells_in_bbox(30.99, 42.99, 31.02, 43.01) c where c.is_mine),
  'abandoned cells are hidden');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into r select 'b_retake', public.submit_activity(test.payload(
  '40000000-0000-0000-0000-000000000004', 'run',
  test.route(43.0, 31.0, '{{0,0},{900,0}}', 3, now() - interval '40 minutes')));
select test.assert((select (res ->> 'captured_cells')::int = 0 and (res ->> 'net_gain_cells')::int > 0 from r where name = 'b_retake'),
  'abandoned cells are claimed as free, not captured: ' || (select res::text from r where name = 'b_retake'));
reset role;
update public.territory_cells set last_visited_at = now() - interval '50 days'
  where owner_id = '00000000-0000-0000-0000-00000000000b';
select test.assert((select public.expire_territory() > 0), 'expire_territory frees abandoned cells');
select test.assert((select count(*) > 0 from public.notifications n
  where n.user_id = '00000000-0000-0000-0000-00000000000b' and n.kind = 'territory_lost' and n.payload ->> 'reason' = 'decay'),
  'owner is told about decayed cells');

-- Clubs: ranking and detail.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.create_club('Moda Koşucuları', 'test', false);
select test.assert((select bool_or(c.is_member and c.weekly_gain > 0) from public.club_leaderboard() c), 'club leaderboard sums members');
select test.assert((select (public.club_detail(c.club_id) -> 'members' -> 0 ->> 'is_me')::boolean
  from public.club_leaderboard() c where c.is_member limit 1), 'club detail lists members');
reset role;

-- 0014: live location sharing (only accepted followers, only latest point, erased at the end).
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select public.follow_user('00000000-0000-0000-0000-00000000000b');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.respond_follow('00000000-0000-0000-0000-00000000000c', true);
select test.assert((select count(*) = 1 from public.live_share_candidates() where user_id = '00000000-0000-0000-0000-00000000000c'),
  'accepted followers can be chosen');
create temp table ls as select public.start_live_share(array['00000000-0000-0000-0000-00000000000c'::uuid], 'run') as id;
select public.update_live_share((select id from ls), 41.0, 29.0, 8);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.assert((select (public.get_live_share((select id from ls)) ->> 'lat')::numeric = 41.0), 'viewer sees the latest position');
select test.assert((select count(*) > 0 from public.notifications n where n.kind = 'live_share'), 'viewer is notified');
select test.assert((select count(*) = 0 from public.live_shares), 'shares are not directly readable');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.assert((select public.get_live_share((select id from ls)) is null), 'others cannot see the share');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.end_live_share((select id from ls));
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.assert((select (s ->> 'active')::boolean = false and s ->> 'lat' is null from public.get_live_share((select id from ls)) s),
  'ended share hides the position');
reset role;
select test.assert((select last_lat is null from public.live_shares where id = (select id from ls)), 'position erased when sharing ends');

-- 0015: wheelchair activities.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.assert((select public.submit_activity(test.payload(
  '50000000-0000-0000-0000-000000000001', 'wheelchair',
  test.route(44.0, 32.0, '{{0,0},{800,0}}', 2, now() - interval '6 hours'))) ->> 'status' = 'accepted'),
  'wheelchair activity at pushing speed is accepted');
select test.assert((select public.submit_activity(test.payload(
  '50000000-0000-0000-0000-000000000002', 'wheelchair',
  test.route(44.1, 32.1, '{{0,0},{2000,0}}', 9, now() - interval '5 hours'))) -> 'reasons' ? 'impossible_average_speed'),
  'wheelchair speed limit applies');
reset role;

-- 0016: Strava import source; tokens never reachable by players.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.assert((select public.submit_activity(test.payload(
  '60000000-0000-0000-0000-000000000001', 'run',
  test.route(45.0, 33.0, '{{0,0},{900,0}}', 3, now() - interval '7 hours'))
  || '{"source":"strava","external_id":"12345","source_device":"Garmin · Strava"}') ->> 'status' = 'accepted'),
  'strava activity is accepted');
select test.assert((select public.submit_activity(test.payload(
  '60000000-0000-0000-0000-000000000002', 'run',
  test.route(45.0, 33.0, '{{0,0},{900,0}}', 3, now() - interval '7 hours'))
  || '{"source":"strava","external_id":"12345"}') -> 'reasons' ? 'duplicate_import'),
  'the same strava activity cannot be imported twice');
select test.assert((select count(*) = 0 from public.strava_status()), 'not connected yet');
reset role;
insert into public.strava_connections (user_id, athlete_id, athlete_name, access_token, refresh_token, expires_at)
  values ('00000000-0000-0000-0000-00000000000b', 1, 'B Test', 'secret-a', 'secret-r', now() + interval '1 hour');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.assert((select connected and athlete_name = 'B Test' from public.strava_status()), 'status shows the connection');
-- run.sh grants select on every table to authenticated; RLS (no policies) still hides the rows.
select test.assert((select count(*) = 0 from public.strava_connections), 'strava tokens are not readable');
reset role;
