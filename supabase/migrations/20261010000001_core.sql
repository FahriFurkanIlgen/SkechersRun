-- Runner core schema: profiles, social graph, clubs, notifications, privacy zones.
-- Location-bearing tables live in 0002 (activities) and 0003 (territory).

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.activity_type as enum ('walk', 'run', 'ride');
create type public.visibility as enum ('public', 'followers', 'private');
create type public.athlete_level as enum ('beginner', 'experienced');
create type public.follow_status as enum ('pending', 'accepted');
create type public.notification_kind as enum (
  'activity_completed', 'territory_gained', 'territory_lost',
  'follow_request', 'new_follower', 'club_invite'
);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_.]{3,24}$'),
  avatar_url text,
  preferred_activity public.activity_type not null default 'walk',
  level public.athlete_level not null default 'beginner',
  profile_visibility public.visibility not null default 'followers',
  default_activity_visibility public.visibility not null default 'followers',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  base text := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^a-zA-Z0-9_.]', '', 'g'));
begin
  if length(base) < 3 then
    base := 'runner_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  base := left(base, 24);
  if exists (select 1 from public.profiles where username = base) then
    base := left(base, 15) || '_' || substr(md5(new.id::text), 1, 8);
  end if;
  insert into public.profiles (id, username) values (new.id, base);
  insert into public.notification_prefs (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Social graph
-- ---------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status public.follow_status not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id, status);

-- Is `viewer` an accepted follower of `owner`?
create or replace function public.is_follower(owner uuid, viewer uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.follows
    where followee_id = owner and follower_id = viewer and status = 'accepted'
  );
$$;

-- ---------------------------------------------------------------------------
-- Clubs (MVP: create / join / leave). Challenges are modelled for the next phase.
-- ---------------------------------------------------------------------------
create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 3 and 48),
  description text check (length(description) <= 280),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  is_private boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_members_user_idx on public.club_members (user_id);

-- Invite-code competitions among friends (data model only in the MVP).
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 3 and 48),
  created_by uuid not null references public.profiles (id) on delete cascade,
  club_id uuid references public.clubs (id) on delete cascade,
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  metric text not null check (metric in ('area_gain', 'distance', 'active_days')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  created_at timestamptz not null default now()
);

create table public.challenge_participants (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  activity_completed boolean not null default true,
  territory_changes boolean not null default true,
  follow_requests boolean not null default true,
  club_invites boolean not null default true,
  -- Expo push token. Delivery requires a sender (edge function / worker) — see README.
  push_token text,
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.notification_kind not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- Inserts a notification unless the recipient turned that kind off.
create or replace function public.notify(recipient uuid, k public.notification_kind, body jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  p public.notification_prefs;
begin
  select * into p from public.notification_prefs where user_id = recipient;
  if found and (
    not p.enabled
    or (k = 'activity_completed' and not p.activity_completed)
    or (k in ('territory_gained', 'territory_lost') and not p.territory_changes)
    or (k in ('follow_request', 'new_follower') and not p.follow_requests)
    or (k = 'club_invite' and not p.club_invites)
  ) then
    return;
  end if;
  insert into public.notifications (user_id, kind, payload) values (recipient, k, body);
end $$;

-- ---------------------------------------------------------------------------
-- Privacy zones: never readable by anyone but the owner.
-- ---------------------------------------------------------------------------
create table public.privacy_zones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null check (length(label) <= 32),
  center geography (point, 4326) not null,
  radius_m real not null check (radius_m between 200 and 1500),
  created_at timestamptz not null default now()
);
create index privacy_zones_user_idx on public.privacy_zones (user_id);

-- Shift the stored centre by a random offset (< 30% of the radius) and grow the
-- radius by the same amount. The real location stays covered, but the gaps in
-- shared routes no longer form a circle centred on it.
create or replace function public.jitter_privacy_zone()
returns trigger language plpgsql set search_path = public, extensions as $$
declare
  offset_m double precision := new.radius_m * 0.3 * sqrt(random());
  bearing double precision := random() * 2 * pi();
begin
  new.center := ST_Project(new.center, offset_m, bearing);
  new.radius_m := least(1500, new.radius_m + offset_m);
  return new;
end $$;

create trigger privacy_zones_jitter before insert on public.privacy_zones
  for each row execute function public.jitter_privacy_zone();

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
