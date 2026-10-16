-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- Wheelchair as a first-class activity type: same map, same cells, its own
-- plausible speed limit (pushing, including racing chairs on the flat).
alter type public.activity_type add value if not exists 'wheelchair';

create or replace function public.max_speed_mps(t public.activity_type)
returns double precision language sql immutable as $$
  select case t::text when 'walk' then 3.5 when 'run' then 8.0 when 'ride' then 22.0 when 'wheelchair' then 6.0 end;
$$;
