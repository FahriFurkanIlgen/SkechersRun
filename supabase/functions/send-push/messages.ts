// Turkish push texts for rows in public.notifications. Pure and dependency-free
// so it runs in Deno (Edge Function) and in Node's test runner.

export type NotificationKind =
  | 'activity_completed'
  | 'territory_gained'
  | 'territory_lost'
  | 'follow_request'
  | 'new_follower'
  | 'club_invite';

export interface PushMessage {
  title: string;
  body: string;
}

const cells = (n: unknown) => `${typeof n === 'number' ? n : 0} hücre`;

/** `actor` is the username of the other player involved, when there is one. */
export function messageFor(
  kind: NotificationKind,
  payload: Record<string, unknown>,
  actor: string | null,
): PushMessage {
  switch (kind) {
    case 'activity_completed':
      return { title: 'Aktiviten işlendi', body: 'Sonuçları görmek için dokun.' };
    case 'territory_gained':
      return { title: 'Hücre kazandın', body: `+${cells(payload.cells)} artık senin.` };
    case 'territory_lost':
      return {
        title: 'Bir bölgen el değiştirdi',
        body: `${actor ?? 'Bir oyuncu'} senden ${cells(payload.cells)} aldı. Geri almak ister misin?`,
      };
    case 'follow_request':
      return { title: 'Yeni takip isteği', body: `${actor ?? 'Bir oyuncu'} seni takip etmek istiyor.` };
    case 'new_follower':
      return { title: 'Yeni takipçi', body: `${actor ?? 'Bir oyuncu'} seni takip etmeye başladı.` };
    case 'club_invite':
      return {
        title: 'Kulüp daveti',
        body: `${actor ?? 'Bir oyuncu'} seni “${String(payload.club_name ?? 'kulüp')}” kulübüne davet etti.`,
      };
  }
}

/** Which payload field names the other player for each kind. */
export function actorIdFor(kind: NotificationKind, payload: Record<string, unknown>): string | null {
  const key = kind === 'territory_lost' ? 'by_user_id' : kind === 'club_invite' ? 'from_user_id' : 'user_id';
  const id = payload[key];
  return typeof id === 'string' ? id : null;
}
