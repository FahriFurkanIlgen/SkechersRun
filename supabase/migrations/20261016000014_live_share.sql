-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- Live location sharing for safety: while recording, a player can let chosen
-- followers see where they are. Only the latest position is stored (no track),
-- it is erased when sharing ends, and a share expires after 8 hours.

alter type public.notification_kind add value if not exists 'live_share';

create table public.live_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  activity_type public.activity_type not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '8 hours',
  ended_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  last_accuracy real,
  last_at timestamptz
);
create index live_shares_user_idx on public.live_shares (user_id, started_at desc);

create table public.live_share_viewers (
  share_id uuid not null references public.live_shares (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  primary key (share_id, viewer_id)
);
create index live_share_viewers_viewer_idx on public.live_share_viewers (viewer_id);

-- Only through the functions below.
alter table public.live_shares enable row level security;
alter table public.live_share_viewers enable row level security;
revoke all on public.live_shares, public.live_share_viewers from anon, authenticated;

-- People who may watch: the player's accepted followers.
create or replace function public.live_share_candidates()
returns table (user_id uuid, username text, avatar_url text)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.username, p.avatar_url
  from public.follows f join public.profiles p on p.id = f.follower_id
  where f.followee_id = auth.uid() and f.status = 'accepted'
  order by p.username
  limit 200;
$$;

create or replace function public.start_live_share(p_viewers uuid[], p_type public.activity_type)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  sid uuid;
  v uuid;
  me text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  -- One active share at a time.
  update public.live_shares set ended_at = now(), last_lat = null, last_lng = null, last_accuracy = null
    where user_id = auth.uid() and ended_at is null;
  insert into public.live_shares (user_id, activity_type) values (auth.uid(), p_type) returning id into sid;
  select username into me from public.profiles where id = auth.uid();
  for v in
    select f.follower_id from public.follows f
    where f.followee_id = auth.uid() and f.status = 'accepted' and f.follower_id = any (p_viewers[1:20])
  loop
    insert into public.live_share_viewers (share_id, viewer_id) values (sid, v) on conflict do nothing;
    perform notify(v, 'live_share', jsonb_build_object('share_id', sid, 'user_id', auth.uid(), 'username', me,
                                                        'activity_type', p_type));
  end loop;
  return sid;
end $$;

create or replace function public.update_live_share(p_share uuid, p_lat double precision, p_lng double precision, p_accuracy real)
returns void language sql security definer set search_path = public, extensions as $$
  update public.live_shares
    set last_lat = p_lat, last_lng = p_lng, last_accuracy = p_accuracy, last_at = now()
    where id = p_share and user_id = auth.uid() and ended_at is null and expires_at > now()
      and abs(p_lat) <= 90 and abs(p_lng) <= 180;
$$;

create or replace function public.end_live_share(p_share uuid)
returns void language sql security definer set search_path = public, extensions as $$
  update public.live_shares
    set ended_at = coalesce(ended_at, now()), last_lat = null, last_lng = null, last_accuracy = null
    where id = p_share and user_id = auth.uid();
$$;

-- For a viewer (or the owner): who, since when, latest position while active.
create or replace function public.get_live_share(p_share uuid)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', s.id, 'username', p.username, 'activity_type', s.activity_type,
    'started_at', s.started_at, 'active', s.ended_at is null and s.expires_at > now(),
    'lat', case when s.ended_at is null and s.expires_at > now() then s.last_lat end,
    'lng', case when s.ended_at is null and s.expires_at > now() then s.last_lng end,
    'accuracy', s.last_accuracy, 'last_at', s.last_at)
  from public.live_shares s join public.profiles p on p.id = s.user_id
  where s.id = p_share
    and (s.user_id = auth.uid()
         or exists (select 1 from public.live_share_viewers v where v.share_id = s.id and v.viewer_id = auth.uid()));
$$;

revoke execute on function public.live_share_candidates(), public.start_live_share(uuid[], public.activity_type),
  public.update_live_share(uuid, double precision, double precision, real), public.end_live_share(uuid),
  public.get_live_share(uuid) from anon, public;
grant execute on function public.live_share_candidates(), public.start_live_share(uuid[], public.activity_type),
  public.update_live_share(uuid, double precision, double precision, real), public.end_live_share(uuid),
  public.get_live_share(uuid) to authenticated;
