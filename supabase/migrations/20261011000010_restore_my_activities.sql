-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- Lets the app restore the signed-in user's own activities on a device that
-- does not have them (new phone, reinstall, after switching accounts).
-- Owner only; times as epoch milliseconds like the app uses.
create or replace function public.my_activities(p_limit int default 200)
returns table (
  id uuid, client_id uuid, type public.activity_type, title text, visibility public.visibility,
  route_share text, started_at double precision, ended_at double precision, moving_time_s double precision,
  distance_m double precision, status text, reasons text[], claimed_cells int, net_gain_cells int,
  captured_cells int, source text, external_id text, source_device text
)
language sql stable security definer set search_path = public, extensions as $$
  select a.id, a.client_id, a.type, a.title, a.visibility, a.route_share,
         extract(epoch from a.started_at) * 1000, extract(epoch from a.ended_at) * 1000,
         a.moving_time_s, a.distance_m, a.status,
         coalesce(a.rejection_reasons, '{}') || coalesce(a.claim_notes, '{}'),
         a.claimed_cells, a.net_gain_cells, a.captured_cells, a.source, a.external_id, a.source_device
  from public.activities a
  where a.user_id = auth.uid()
  order by a.started_at desc
  limit least(greatest(p_limit, 1), 1000);
$$;

create or replace function public.my_route_points(p_activity uuid)
returns table (seq int, segment int, lat double precision, lng double precision, accuracy real,
               altitude real, speed real, ts double precision)
language sql stable security definer set search_path = public, extensions as $$
  select p.seq, p.segment, ST_Y(p.geom::geometry), ST_X(p.geom::geometry), p.accuracy_m,
         p.altitude_m, p.speed_mps, extract(epoch from p.recorded_at) * 1000
  from public.route_points p
  join public.activities a on a.id = p.activity_id
  where p.activity_id = p_activity and a.user_id = auth.uid()
  order by p.seq;
$$;

revoke execute on function public.my_activities(int), public.my_route_points(uuid) from anon, public;
grant execute on function public.my_activities(int), public.my_route_points(uuid) to authenticated;
