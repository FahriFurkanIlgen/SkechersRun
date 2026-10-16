// Supabase Edge Function: Strava import.
// The device opens Strava's OAuth page and sends the returned code here; this
// function keeps the tokens (public.strava_connections, service role only) and
// proxies the few Strava API calls the import needs. The device then converts
// the route and submits it through submit_activity like any other import, so
// Strava activities get exactly the same validation.
//
// Secrets (supabase secrets set …): STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { importable, streamsToLocations, type StravaSummary, type StreamSet } from './mapping.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CLIENT_ID = Deno.env.get('STRAVA_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET');
const API = 'https://www.strava.com/api/v3';

interface Connection {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, ...params }),
  });
  if (!res.ok) throw new HttpError(res.status === 400 || res.status === 401 ? 400 : 502, 'strava_token_failed');
  return await res.json();
}

/** A valid access token, refreshed when it expires within a minute. */
async function accessToken(userId: string): Promise<string> {
  const { data } = await supabase.from('strava_connections').select('*').eq('user_id', userId).maybeSingle<Connection>();
  if (!data) throw new HttpError(404, 'not_connected');
  if (Date.parse(data.expires_at) - Date.now() > 60_000) return data.access_token;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: data.refresh_token });
  await supabase
    .from('strava_connections')
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(t.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  return t.access_token;
}

async function stravaGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new HttpError(401, 'strava_unauthorized');
  if (res.status === 429) throw new HttpError(429, 'strava_rate_limited');
  if (!res.ok) throw new HttpError(502, `strava_${res.status}`);
  return (await res.json()) as T;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'strava_not_configured' }, 503);
  const jwt = req.headers.get('authorization')?.replace(/^Bearer /i, '');
  const { data: auth } = jwt ? await supabase.auth.getUser(jwt) : { data: { user: null } };
  const user = auth.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  try {
    const body = (await req.json()) as { action: string; code?: string; scope?: string; page?: number; id?: string };
    switch (body.action) {
      case 'exchange': {
        if (!body.code) throw new HttpError(400, 'missing_code');
        const t = await tokenRequest({ grant_type: 'authorization_code', code: body.code });
        const name = [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(' ') || null;
        const { error } = await supabase.from('strava_connections').upsert({
          user_id: user.id,
          athlete_id: t.athlete?.id ?? 0,
          athlete_name: name,
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          expires_at: new Date(t.expires_at * 1000).toISOString(),
          scope: body.scope ?? null,
          updated_at: new Date().toISOString(),
        });
        if (error) throw new HttpError(500, 'store_failed');
        return json({ connected: true, athleteName: name });
      }
      case 'activities': {
        const token = await accessToken(user.id);
        const page = Math.max(1, Math.min(10, body.page ?? 1));
        const list = await stravaGet<StravaSummary[]>(token, `/athlete/activities?per_page=30&page=${page}`);
        return json({ activities: importable(list), more: list.length === 30 });
      }
      case 'streams': {
        if (!body.id || !/^\d+$/.test(body.id)) throw new HttpError(400, 'invalid_id');
        const token = await accessToken(user.id);
        const [detail, streams] = await Promise.all([
          stravaGet<StravaSummary>(token, `/activities/${body.id}`),
          stravaGet<StreamSet>(token, `/activities/${body.id}/streams?keys=latlng,time,altitude,velocity_smooth&key_by_type=true`),
        ]);
        const [activity] = importable([detail]);
        if (!activity) throw new HttpError(422, 'not_importable');
        return json({ activity, locations: streamsToLocations(streams, activity.startedAt) });
      }
      case 'disconnect': {
        const token = await accessToken(user.id).catch(() => null);
        if (token) {
          await fetch('https://www.strava.com/oauth/deauthorize', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ access_token: token }),
          }).catch(() => undefined);
        }
        await supabase.from('strava_connections').delete().eq('user_id', user.id);
        return json({ connected: false });
      }
      default:
        throw new HttpError(400, 'unknown_action');
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: 'internal' }, 500);
  }
});
