-- Explicit Data API privileges. Newer hosted Supabase projects do not grant
-- table/function access to `anon` / `authenticated` automatically, and the
-- earlier migrations relied on those defaults. Row Level Security (0003) still
-- decides which rows each user may see or change; these grants only make the
-- tables reachable. `anon` gets nothing: every backend feature needs sign-in.

set search_path = public, extensions;

grant usage on schema public to authenticated;

-- Tables: RLS policies restrict rows; operations without a policy stay denied.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Keep the column-level update rules from 0003/0004.
revoke update on public.profiles from authenticated;
grant update (username, avatar_url, preferred_activity, level, profile_visibility,
              default_activity_visibility, show_in_leaderboards, updated_at)
  on public.profiles to authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Functions the app calls, plus helpers used inside RLS policies. Internal
-- functions (submit_activity_core, activity_extra_checks, hex helpers,
-- triggers) stay private.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'cells_in_bbox', 'create_club', 'delete_activity', 'delete_my_account', 'delete_my_location_data',
      'follow_user', 'get_feed', 'join_club', 'leaderboard', 'leave_club', 'list_clubs', 'my_privacy_zones',
      'profile_stats', 'respond_follow', 'set_privacy_zones', 'submit_activity', 'toggle_like', 'unfollow_user',
      'update_activity', 'can_view_activity'])
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
