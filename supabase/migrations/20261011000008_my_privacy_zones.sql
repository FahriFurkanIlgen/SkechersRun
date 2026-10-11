-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- The signed-in user's own privacy zones as plain coordinates, so the app can
-- restore them on this device after signing in (e.g. after switching accounts).
-- Centres are the stored (already jittered) ones; zones still cover the real place.
create or replace function public.my_privacy_zones()
returns table (id uuid, label text, lat double precision, lng double precision, radius_m real)
language sql stable security definer set search_path = public, extensions as $$
  select z.id, z.label, ST_Y(z.center::geometry), ST_X(z.center::geometry), z.radius_m
  from public.privacy_zones z
  where z.user_id = auth.uid()
  order by z.label;
$$;

revoke execute on function public.my_privacy_zones() from anon, public;
grant execute on function public.my_privacy_zones() to authenticated;
