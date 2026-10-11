// End-to-end check of the calls the app makes, against a local Supabase
// (`supabase start`, same grants as the hosted project). Creates throwaway
// users on the LOCAL instance only.
// Usage: SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... node supabase/tests/e2e/api_flow.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../../../mobile/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url?.startsWith('http://127.0.0.1') && !url?.startsWith('http://localhost')) {
  throw new Error('Only runs against a local Supabase (creates test users).');
}

const run = Math.random().toString(36).slice(2, 8);
const ok = (msg) => console.log(`ok - ${msg}`);
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message} (${error.code ?? ''})`);
  return data;
};

/** Walk around a ~300 m × 300 m block with realistic speed variation. */
function loopRoute(lat0, lng0, startMs) {
  const mLat = 111195, mLng = 111195 * Math.cos((lat0 * Math.PI) / 180);
  const corners = [[0, 0], [300, 0], [300, 300], [0, 300], [0, 5]];
  const pts = [];
  let t = startMs, k = 0;
  const push = (x, y) => pts.push([lat0 + y / mLat, lng0 + x / mLng, 5, Math.round(t), 0, null, null, false]);
  push(0, 0);
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1], [x1, y1] = corners[i];
    const len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.round(len / 10));
    for (let s = 1; s <= steps; s++) {
      k++;
      t += ((len / steps) / (1.4 * (1 + 0.15 * Math.sin(k * 1.7)))) * 1000;
      push(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
    }
  }
  return pts;
}

// ---- User A: sign up, onboarding profile, prefs, zones -------------------
const a = client();
const emailA = `e2e-a-${run}@example.test`, password = `Test-${run}-pass1`;
const signUp = must(await a.auth.signUp({ email: emailA, password, options: { data: { username: '' } } }), 'sign up A');
assert.ok(signUp.session, 'local sign-up returns a session (no e-mail confirmation locally)');
const uidA = signUp.user.id;
ok('A signed up');

const profA = must(await a.from('profiles').select('id, username, avatar_url, preferred_activity, level, profile_visibility, default_activity_visibility, show_in_leaderboards').eq('id', uidA).maybeSingle(), 'read own profile');
assert.match(profA.username, /^runner_/);
ok(`A profile created by trigger (${profA.username})`);

must(await a.from('profiles').update({ username: `e2e_a_${run}`, preferred_activity: 'walk', level: 'beginner', updated_at: new Date().toISOString() }).eq('id', uidA), 'onboarding: update own profile');
ok('A onboarding profile update (the failing step on the phone)');

must(await a.from('notification_prefs').upsert({ user_id: uidA, enabled: true, activity_completed: true, territory_changes: true, follow_requests: true, club_invites: true, push_token: null, updated_at: new Date().toISOString() }), 'notification prefs upsert');
ok('A notification prefs saved');

must(await a.rpc('set_privacy_zones', { zones: [{ label: 'Ev', lat: 40.9, lng: 29.3, radius_m: 300 }] }), 'set privacy zones');
const zonesA = must(await a.rpc('my_privacy_zones'), 'my privacy zones');
assert.equal(zonesA.length, 1);
ok('A privacy zones saved and read back');

// ---- A records an activity -----------------------------------------------
const startMs = Date.now() - 60 * 60 * 1000;
const pts = loopRoute(40.98, 29.02, startMs);
const res = must(await a.rpc('submit_activity', { payload: {
  client_id: crypto.randomUUID(), type: 'walk', title: 'E2E yürüyüş', visibility: 'public', route_share: 'trimmed',
  source: 'phone', started_at: startMs, ended_at: pts.at(-1)[3], moving_time_s: (pts.at(-1)[3] - startMs) / 1000, points: pts,
} }), 'submit activity');
assert.equal(res.status, 'accepted', JSON.stringify(res));
assert.ok(res.claimed_cells > 0);
ok(`A activity accepted, ${res.claimed_cells} cells`);

const cells = must(await a.rpc('cells_in_bbox', { min_lat: 40.97, min_lng: 29.01, max_lat: 40.99, max_lng: 29.03 }), 'cells in bbox');
assert.ok(cells.length >= res.claimed_cells);
ok(`map cells visible (${cells.length})`);

const stats = must(await a.rpc('profile_stats', { p_user: uidA }), 'profile stats');
assert.ok(Number(stats.territory_cells) > 0);
ok('profile stats');
must(await a.rpc('get_feed', { p_before: null, p_limit: 20 }), 'feed');
ok('feed');
must(await a.from('activities').select('id').eq('user_id', uidA), 'own activities');
ok('own activities readable');

// ---- Login flow: sign out, sign back in with password -------------------
await a.auth.signOut();
const a2 = client();
const signIn = must(await a2.auth.signInWithPassword({ email: emailA, password }), 'sign in A');
assert.equal(signIn.user.id, uidA);
ok('A signs in again with e-mail + password');

// ---- User B: isolation (account switching on one device) ---------------
const b = client();
const signUpB = must(await b.auth.signUp({ email: `e2e-b-${run}@example.test`, password }), 'sign up B');
const uidB = signUpB.user.id;
const zonesB = must(await b.rpc('my_privacy_zones'), 'B zones');
assert.equal(zonesB.length, 0);
ok("B does not get A's privacy zones");
const { count } = await b.from('activities').select('id', { count: 'exact', head: true }).eq('user_id', uidB).in('id', [res.activity_id]);
assert.equal(count, 0);
ok("A's activity is not counted as B's (account-switch detection)");
const hijack = await b.from('profiles').update({ username: `hijack_${run}` }).eq('id', uidA).select();
assert.equal((hijack.data ?? []).length, 0);
ok("B cannot change A's profile");
const board = must(await b.rpc('leaderboard', { p_scope: 'global', p_metric: 'area', p_lat: null, p_lng: null, p_level: null, p_radius_km: 10, p_limit: 50, p_who: 'all' }), 'leaderboard');
assert.ok(board.some((r) => r.user_id === uidA || r.username === `e2e_a_${run}`));
ok('leaderboard shows A to B');

// ---- Cleanup ---------------------------------------------------------
must(await a2.rpc('delete_my_account'), 'delete A');
must(await b.rpc('delete_my_account'), 'delete B');
ok('test accounts deleted');
console.log('ALL E2E API CHECKS PASSED');
