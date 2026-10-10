-- PostGIS lives in the `extensions` schema; hosted Supabase does not put it on the
-- migration role's search_path, so set it explicitly.
set search_path = public, extensions;

-- Where an activity was recorded: the phone itself, or imported from a health
-- platform (Apple Health — e.g. Apple Watch workouts — or Health Connect).
-- Imported activities go through exactly the same validation as phone ones.

alter table public.activities
  add column source text not null default 'phone'
    check (source in ('phone', 'apple_health', 'health_connect')),
  -- Identifier of the workout in the source platform (e.g. HealthKit UUID).
  add column external_id text,
  -- Human-readable recording device, e.g. "Apple Watch".
  add column source_device text check (length(source_device) <= 64);

-- The same external workout can only be imported once per player.
create unique index activities_external_idx on public.activities (user_id, source, external_id)
  where external_id is not null;

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
  if v_source not in ('phone', 'apple_health', 'health_connect') then
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

revoke execute on function public.submit_activity(jsonb) from anon, public;
grant execute on function public.submit_activity(jsonb) to authenticated;
