-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- Social RPCs, leaderboards, account/data deletion, and row level security.

-- ---------------------------------------------------------------------------
-- Follows
-- ---------------------------------------------------------------------------
create or replace function public.follow_user(target uuid)
returns public.follow_status language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  st public.follow_status;
begin
  if uid is null or target = uid then raise exception 'invalid_follow'; end if;
  select case when profile_visibility = 'public' then 'accepted' else 'pending' end::public.follow_status
    into st from public.profiles where id = target;
  if st is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.follows (follower_id, followee_id, status) values (uid, target, st)
    on conflict do nothing;
  if found then
    perform notify(target, case when st = 'accepted' then 'new_follower' else 'follow_request' end::public.notification_kind,
      jsonb_build_object('user_id', uid));
  end if;
  return st;
end $$;

create or replace function public.respond_follow(follower uuid, accept boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if accept then
    update public.follows set status = 'accepted'
      where follower_id = follower and followee_id = auth.uid() and status = 'pending';
  else
    delete from public.follows where follower_id = follower and followee_id = auth.uid();
  end if;
end $$;

create or replace function public.unfollow_user(target uuid)
returns void language sql security definer set search_path = public, extensions as $$
  delete from public.follows where follower_id = auth.uid() and followee_id = target;
$$;

-- ---------------------------------------------------------------------------
-- Feed (self + people I follow), with visibility enforced per activity.
-- ---------------------------------------------------------------------------
create or replace function public.get_feed(p_before timestamptz default null, p_limit int default 20)
returns table (
  id uuid, activity_id uuid, user_id uuid, username text, avatar_url text,
  activity_type public.activity_type, title text, distance_m double precision,
  moving_time_s double precision, net_gain_m2 double precision, public_route jsonb,
  like_count bigint, liked_by_me boolean, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select f.id, a.id, a.user_id, p.username, p.avatar_url, a.type, a.title, a.distance_m,
         a.moving_time_s, a.net_gain_m2,
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

create or replace function public.toggle_like(p_post uuid)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.activities;
begin
  select act.* into a from public.feed_posts f join public.activities act on act.id = f.activity_id
    where f.id = p_post;
  if not found or not public.can_view_activity(a, auth.uid()) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  delete from public.post_likes where post_id = p_post and user_id = auth.uid();
  if found then return false; end if;
  insert into public.post_likes (post_id, user_id) values (p_post, auth.uid());
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Leaderboards
--   scope:  'global' | 'nearby' (needs lat/lng; radius in km)
--   metric: 'area' (currently held) | 'weekly_gain' | 'active_days' (last 28 days, >= 1 km)
--   level:  null | 'beginner' | 'experienced'
-- Private profiles are excluded (except the caller's own row).
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard(
  p_scope text, p_metric text, p_level public.athlete_level default null,
  p_lat double precision default null, p_lng double precision default null,
  p_radius_km double precision default 10, p_limit int default 50)
returns table (rank bigint, user_id uuid, username text, avatar_url text, value double precision, is_me boolean)
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
    where (p.profile_visibility <> 'private' or p.id = auth.uid())
      and (p_level is null or p.level = p_level)
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
      end as value
    from players pl
  )
  select rank() over (order by s.value desc), p.id, p.username, p.avatar_url, s.value, p.id = auth.uid()
  from scores s join public.profiles p on p.id = s.id
  where coalesce(s.value, 0) > 0
  order by s.value desc
  limit least(coalesce(p_limit, 50), 100);
end $$;

-- ---------------------------------------------------------------------------
-- Profile stats (own profile or a profile the caller may see)
-- ---------------------------------------------------------------------------
create or replace function public.profile_stats(p_user uuid)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'activity_count', count(a.*),
    'total_distance_m', coalesce(sum(a.distance_m), 0),
    'total_time_s', coalesce(sum(a.moving_time_s), 0),
    'territory_m2', coalesce((select area_m2 from public.territories where user_id = p_user), 0),
    'total_gain_m2', coalesce(sum(a.net_gain_m2), 0),
    'longest_m', coalesce(max(a.distance_m), 0)
  )
  from public.activities a
  where a.user_id = p_user and a.status = 'accepted'
    and (p_user = auth.uid() or public.can_view_activity(a, auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Clubs
-- ---------------------------------------------------------------------------
create or replace function public.create_club(p_name text, p_description text, p_private boolean default false)
returns public.clubs language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.clubs;
begin
  insert into public.clubs (name, description, owner_id, is_private)
    values (p_name, p_description, auth.uid(), coalesce(p_private, false)) returning * into c;
  insert into public.club_members (club_id, user_id, role) values (c.id, auth.uid(), 'owner');
  return c;
end $$;

-- Join by invite code (works for private and public clubs) or by id (public clubs only).
create or replace function public.join_club(p_code text default null, p_club uuid default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  cid uuid;
begin
  if p_code is not null then
    select id into cid from public.clubs where invite_code = upper(trim(p_code));
  else
    select id into cid from public.clubs where id = p_club and not is_private;
  end if;
  if cid is null then raise exception 'club_not_found' using errcode = 'P0002'; end if;
  insert into public.club_members (club_id, user_id) values (cid, auth.uid()) on conflict do nothing;
  return cid;
end $$;

create or replace function public.leave_club(p_club uuid)
returns void language sql security definer set search_path = public, extensions as $$
  delete from public.club_members where club_id = p_club and user_id = auth.uid() and role <> 'owner';
$$;

create or replace function public.invite_to_club(p_club uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.clubs;
begin
  select * into c from public.clubs where id = p_club
    and exists (select 1 from public.club_members m where m.club_id = p_club and m.user_id = auth.uid());
  if not found then raise exception 'club_not_found' using errcode = 'P0002'; end if;
  perform notify(p_user, 'club_invite',
    jsonb_build_object('club_id', c.id, 'club_name', c.name, 'invite_code', c.invite_code, 'from_user_id', auth.uid()));
end $$;

create or replace function public.list_clubs()
returns table (id uuid, name text, description text, owner_id uuid, invite_code text,
               is_private boolean, member_count bigint, is_member boolean, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select c.id, c.name, c.description, c.owner_id,
         case when exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid())
              then c.invite_code end,
         c.is_private,
         (select count(*) from public.club_members m where m.club_id = c.id),
         exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid()),
         c.created_at
  from public.clubs c
  where not c.is_private
     or exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid())
  order by c.created_at desc
  limit 100;
$$;

-- ---------------------------------------------------------------------------
-- Privacy zones (owner replaces the whole set; centres are jittered on insert)
-- ---------------------------------------------------------------------------
create or replace function public.set_privacy_zones(zones jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.privacy_zones where user_id = auth.uid();
  insert into public.privacy_zones (user_id, label, center, radius_m)
  select auth.uid(), left(z ->> 'label', 32),
         ST_MakePoint((z ->> 'lng')::double precision, (z ->> 'lat')::double precision)::geography,
         greatest(200, least(1500, (z ->> 'radius_m')::real))
  from jsonb_array_elements(coalesce(zones, '[]')) z;
end $$;

-- ---------------------------------------------------------------------------
-- Data deletion
-- ---------------------------------------------------------------------------
-- Removes every piece of location data: raw points, routes, public routes,
-- privacy zones and territory. Activity stats (distance, time) are kept.
create or replace function public.delete_my_location_data()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.route_points rp using public.activities a
    where a.id = rp.activity_id and a.user_id = auth.uid();
  delete from public.activity_routes where user_id = auth.uid();
  update public.activities set public_route = null where user_id = auth.uid();
  delete from public.privacy_zones where user_id = auth.uid();
  delete from public.territories where user_id = auth.uid();
end $$;

-- Deletes the auth user; every table cascades from profiles/auth.users.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- Row level security. Direct table access is read-mostly; writes to
-- location-bearing tables go through the SECURITY DEFINER functions above.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notifications enable row level security;
alter table public.privacy_zones enable row level security;
alter table public.activities enable row level security;
alter table public.activity_routes enable row level security;
alter table public.route_points enable row level security;
alter table public.territories enable row level security;
alter table public.territory_events enable row level security;
alter table public.feed_posts enable row level security;
alter table public.post_likes enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy follows_read_own on public.follows for select to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());

create policy club_members_read_own on public.club_members for select to authenticated
  using (user_id = auth.uid());

create policy prefs_own on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy privacy_zones_own on public.privacy_zones for select to authenticated
  using (user_id = auth.uid());

create policy activities_read on public.activities for select to authenticated
  using (public.can_view_activity(activities, auth.uid()));

create policy activity_routes_own on public.activity_routes for select to authenticated
  using (user_id = auth.uid());

create policy route_points_own on public.route_points for select to authenticated
  using (exists (select 1 from public.activities a where a.id = activity_id and a.user_id = auth.uid()));

create policy territory_events_own on public.territory_events for select to authenticated
  using (user_id = auth.uid() or from_user_id = auth.uid());

-- Territories are read through territories_in_bbox() (anonymises private players).
-- Clubs are read through list_clubs(). No direct select policy => no direct access.

-- Column-level privileges: clients may only change these profile fields directly.
revoke update on public.profiles from authenticated;
grant update (username, avatar_url, preferred_activity, level, profile_visibility, default_activity_visibility, updated_at)
  on public.profiles to authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Never expose helper/internal functions to anonymous callers.
-- (Only our own functions: PostGIS may also live in `public` on some setups.)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from anon, public', f.sig);
  end loop;
end $$;
grant execute on function
  public.submit_activity(jsonb),
  public.territories_in_bbox(double precision, double precision, double precision, double precision),
  public.update_activity(uuid, text, public.visibility),
  public.delete_activity(uuid),
  public.follow_user(uuid), public.respond_follow(uuid, boolean), public.unfollow_user(uuid),
  public.get_feed(timestamptz, int), public.toggle_like(uuid),
  public.leaderboard(text, text, public.athlete_level, double precision, double precision, double precision, int),
  public.profile_stats(uuid),
  public.create_club(text, text, boolean), public.join_club(text, uuid), public.leave_club(uuid),
  public.invite_to_club(uuid, uuid), public.list_clubs(),
  public.set_privacy_zones(jsonb),
  public.delete_my_location_data(), public.delete_my_account()
to authenticated;
-- Used inside RLS policies, so callers need execute on them.
grant execute on function public.can_view_activity(public.activities, uuid), public.is_follower(uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Avatar storage (Supabase Storage). Skipped where the storage schema is absent.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
      on conflict (id) do nothing;
    execute $p$create policy avatars_owner_write on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy avatars_owner_update on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy avatars_owner_delete on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;
