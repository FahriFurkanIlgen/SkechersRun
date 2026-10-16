// Supabase Edge Function: delivers a push notification for every row inserted
// into public.notifications (wired with a Database Webhook, see README).
// Push is sent through the Expo Push API to the token in notification_prefs.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { actorIdFor, messageFor, type NotificationKind } from './messages.ts';

interface NotificationRow {
  id: string;
  user_id: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
}

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  const body = await req.json();
  if (body.type !== 'INSERT' || body.table !== 'notifications') return new Response('ignored');
  const row = body.record as NotificationRow;

  // Preferences were already applied when the row was created (public.notify);
  // here we only need a token. No token = nothing to do.
  const { data: prefs } = await supabase
    .from('notification_prefs')
    .select('push_token, enabled')
    .eq('user_id', row.user_id)
    .maybeSingle();
  if (!prefs?.enabled || !prefs.push_token) return new Response('no token');

  // Name the other player unless their profile is private.
  let actor: string | null = null;
  const actorId = actorIdFor(row.kind, row.payload);
  if (actorId) {
    const { data: p } = await supabase.from('profiles').select('username, profile_visibility').eq('id', actorId).maybeSingle();
    if (p && p.profile_visibility !== 'private') actor = p.username;
  }

  const message = messageFor(row.kind, row.payload, actor);
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      to: prefs.push_token,
      title: message.title,
      body: message.body,
      sound: 'default',
      data: { kind: row.kind, notificationId: row.id, shareId: row.payload?.share_id ?? null },
    }),
  });
  const result = await res.json();

  // Drop tokens Expo reports as invalid so we stop sending to them.
  if (result?.data?.status === 'error' && result.data.details?.error === 'DeviceNotRegistered') {
    await supabase.from('notification_prefs').update({ push_token: null }).eq('user_id', row.user_id);
  }
  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
});
