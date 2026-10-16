// Run: node --test supabase/functions/strava/mapping.test.ts
import { deepStrictEqual as assertEquals } from 'node:assert';
import { test } from 'node:test';
import { importable, runnerType, streamsToLocations } from './mapping.ts';

test('maps sport types and drops unsupported ones', () => {
  assertEquals(runnerType('TrailRun'), 'run');
  assertEquals(runnerType('Hike'), 'walk');
  assertEquals(runnerType(undefined, 'Ride'), 'ride');
  assertEquals(runnerType('Swim'), null);
  assertEquals(runnerType('VirtualRide'), null);
});

test('keeps only GPS activities', () => {
  const base = { name: 'x', start_date: '2026-10-15T06:00:00Z', moving_time: 1800, elapsed_time: 1900, distance: 5000 };
  const list = importable([
    { ...base, id: 1, sport_type: 'Run', map: { summary_polyline: 'abc' } },
    { ...base, id: 2, sport_type: 'Run', manual: true, map: { summary_polyline: 'abc' } },
    { ...base, id: 3, sport_type: 'Ride', trainer: true, map: { summary_polyline: '' } },
    { ...base, id: 4, sport_type: 'Swim', map: { summary_polyline: 'abc' } },
  ]);
  assertEquals(list.map((a) => a.id), ['1']);
  assertEquals(list[0].startedAt, Date.parse('2026-10-15T06:00:00Z'));
});

test('converts streams to timed locations with pause segments', () => {
  const locs = streamsToLocations(
    { latlng: { data: [[41, 29], [41.0001, 29], [41.0002, 29]] }, time: { data: [0, 5, 200] }, velocity_smooth: { data: [0, 2.5, 2.4] } },
    1_000_000,
  );
  assertEquals(locs.length, 3);
  assertEquals(locs[1].timestamp, 1_005_000);
  assertEquals(locs[1].speed, 2.5);
  assertEquals(locs.map((l) => l.segment), [0, 0, 1]);
});
