-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- Route points of several of the user's own activities in one request, as
-- compact arrays [seq, segment, lat, lng, accuracy, altitude, speed, ts_ms]
-- (about a third of the size of one JSON object per point).
create or replace function public.my_route_points_bulk(p_activities uuid[])
returns table (activity_id uuid, points jsonb)
language sql stable security definer set search_path = public, extensions as $$
  select p.activity_id,
         jsonb_agg(jsonb_build_array(
           p.seq, p.segment,
           round(ST_Y(p.geom::geometry)::numeric, 7), round(ST_X(p.geom::geometry)::numeric, 7),
           round(p.accuracy_m::numeric, 1), round(p.altitude_m::numeric, 1), round(p.speed_mps::numeric, 2),
           (extract(epoch from p.recorded_at) * 1000)::bigint
         ) order by p.seq)
  from public.route_points p
  join public.activities a on a.id = p.activity_id
  where p.activity_id = any (p_activities[1:100]) and a.user_id = auth.uid()
  group by p.activity_id;
$$;

revoke execute on function public.my_route_points_bulk(uuid[]) from anon, public;
grant execute on function public.my_route_points_bulk(uuid[]) to authenticated;
