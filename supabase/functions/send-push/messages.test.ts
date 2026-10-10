// Run: node --test supabase/functions/send-push/messages.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { actorIdFor, messageFor } from './messages.ts';

test('territory lost names the capturing player and cell count', () => {
  const m = messageFor('territory_lost', { cells: 3, by_user_id: 'u1' }, 'bora');
  assert.equal(m.body, 'bora senden 3 hücre aldı. Geri almak ister misin?');
  assert.equal(actorIdFor('territory_lost', { by_user_id: 'u1' }), 'u1');
});

test('falls back when the actor is unknown or private', () => {
  assert.equal(messageFor('follow_request', { user_id: 'x' }, null).body, 'Bir oyuncu seni takip etmek istiyor.');
});

test('club invites read the inviter from from_user_id', () => {
  assert.equal(actorIdFor('club_invite', { from_user_id: 'u9' }), 'u9');
  assert.match(messageFor('club_invite', { club_name: 'Sabah' }, 'ayse').body, /“Sabah”/);
});
