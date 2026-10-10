-- SQL tests for submit_activity, ownership changes, validation and privacy.
-- Run with supabase/tests/run.sh. Any failed assertion aborts with an error.

create schema test;

-- Builds a points payload walking through (east, north) metre offsets from an
-- origin at a constant speed, one fix every `step_m` metres.
create function test.route(
  lat0 double precision, lng0 double precision, offsets double precision[][],
  speed double precision, t0 timestamptz, step_m double precision default 10,
  mocked boolean default false)
returns jsonb language plpgsql as $$
declare
  pts jsonb := '[]';
  m_lat constant double precision := 111195;
  m_lng double precision := 111195 * cos(radians(lat0));
  t double precision := extract(epoch from t0) * 1000;
  i int; s int; steps int; len double precision;
  x0 double precision; y0 double precision; x1 double precision; y1 double precision;
begin
  pts := pts || jsonb_build_array(jsonb_build_array(lat0 + offsets[1][2] / m_lat, lng0 + offsets[1][1] / m_lng, 5, t, 0, speed, null, mocked));
  for i in 2 .. array_length(offsets, 1) loop
    x0 := offsets[i-1][1]; y0 := offsets[i-1][2]; x1 := offsets[i][1]; y1 := offsets[i][2];
    len := sqrt((x1-x0)^2 + (y1-y0)^2);
    steps := greatest(1, round(len / step_m)::int);
    for s in 1 .. steps loop
      t := t + (len / steps) / speed * 1000;
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
  test.route(41.07, 29.07, '{{0,0},{1000,0}}', 3, now() - interval '30 hours')));
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

insert into r select 'b_capture', public.submit_activity(test.payload(
  '20000000-0000-0000-0000-000000000001', 'run',
  test.route(41.0, 29.0, '{{150,150},{450,150},{450,450},{150,450},{150,155}}', 3, now() - interval '30 minutes')));
select test.assert((select res ->> 'status' = 'accepted' and (res ->> 'captured_from_users')::int = 1
  and (res ->> 'captured_cells')::int >= 1 from r where name = 'b_capture'),
  'B captured cells from A: ' || (select res::text from r where name = 'b_capture'));

-- Duplicate trace from another user.
insert into r select 'b_dup', public.submit_activity(test.payload(
  '20000000-0000-0000-0000-000000000002', 'walk',
  test.route(41.07, 29.07, '{{0,0},{1000,0}}', 3, now() - interval '30 hours')));
select test.assert((select res -> 'reasons' ? 'duplicate_trace' from r where name = 'b_dup'), 'copied trace rejected');

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
