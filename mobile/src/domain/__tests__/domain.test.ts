import { haversineM, ringAreaM2, simplify } from '../geo';
import { evaluateFix, signalQuality } from '../gpsFilter';
import { bestEffortS, currentSpeedMps, routeDistanceM } from '../metrics';
import { estimateClaim } from '../territory';
import { cellAt, cellCenter, cellCenterMercator, cellRing } from '../hex';
import { formatDistance, formatDuration, formatPaceOrSpeed, formatArea, formatGoalDistance } from '../format';
import { removePointsInZones, suggestPrivacyZones, trimRouteEnds } from '../privacy';
import { weeklyGoals, startOfWeek } from '../goals';
import { RULES } from '../rules';
import { normalizeUsername } from '../username';
import { routeFromExternalLocations } from '../importRoute';
import type { Activity } from '../types';
import { routeFromOffsets, square } from './testRoutes';

describe('geo', () => {
  it('computes haversine distance', () => {
    // One degree of latitude is ~111.2 km.
    expect(haversineM({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111_195, -2);
  });

  it('computes ring area of a 200 m square', () => {
    const pts = routeFromOffsets(square(200), 3);
    expect(ringAreaM2(pts)).toBeGreaterThan(39_000);
    expect(ringAreaM2(pts)).toBeLessThan(41_000);
  });

  it('simplifies collinear points away', () => {
    const pts = routeFromOffsets([[0, 0], [500, 0]], 3);
    expect(simplify(pts, 2)).toHaveLength(2);
  });
});

describe('gpsFilter', () => {
  const base = routeFromOffsets([[0, 0], [100, 0]], 3);
  const last = base[0];

  it('rejects inaccurate fixes', () => {
    expect(evaluateFix({ ...base[1], accuracy: 60 }, last, 'run')).toEqual({ accept: false, reason: 'low_accuracy' });
  });

  it('rejects impossible jumps', () => {
    const jump = { ...base[1], latitude: last.latitude + 0.01, timestamp: last.timestamp + 1000 };
    expect(evaluateFix(jump, last, 'walk')).toEqual({ accept: false, reason: 'jump' });
  });

  it('drops jitter while standing still', () => {
    const still = { ...last, timestamp: last.timestamp + 2000 };
    expect(evaluateFix(still, last, 'walk')).toEqual({ accept: false, reason: 'jitter' });
  });

  it('accepts normal progress', () => {
    expect(evaluateFix(base[1], last, 'walk')).toEqual({ accept: true });
  });

  it('reports signal quality', () => {
    expect(signalQuality(5, 1000, 2000)).toBe('good');
    expect(signalQuality(25, 1000, 2000)).toBe('weak');
    expect(signalQuality(5, 0, RULES.signalLostAfterMs + 1)).toBe('none');
  });
});

describe('metrics', () => {
  it('does not bridge pause segments', () => {
    const a = routeFromOffsets([[0, 0], [300, 0]], 3);
    const b = routeFromOffsets([[1000, 0], [1300, 0]], 3).map((p) => ({ ...p, segment: 1 }));
    expect(routeDistanceM([...a, ...b])).toBeCloseTo(600, -1);
  });

  it('finds the fastest effort over a distance', () => {
    // 3 km at 3 m/s => best 1 km = 333 s
    const pts = routeFromOffsets([[0, 0], [3000, 0]], 3);
    expect(bestEffortS(pts, 1000)).toBeCloseTo(333.3, 0);
    expect(bestEffortS(pts, 5000)).toBeNull();
    // faster second half wins
    const slow = routeFromOffsets([[0, 0], [1000, 0]], 2);
    const fast = routeFromOffsets([[1000, 0], [2000, 0]], 4).map((p) => ({ ...p, timestamp: p.timestamp + 500_000, seq: p.seq + 1000 }));
    expect(bestEffortS([...slow, ...fast.slice(1)], 1000)).toBeCloseTo(250, 0);
  });

  it('computes current speed from geometry', () => {
    const pts = routeFromOffsets([[0, 0], [300, 0]], 3);
    expect(currentSpeedMps(pts)).toBeCloseTo(3, 1);
  });
});

describe('hex cells', () => {
  it('round-trips a point to its own cell centre', () => {
    const p = { latitude: 41.0422, longitude: 29.0083 };
    const cell = cellAt(p);
    expect(cellAt(cellCenter(cell))).toEqual(cell);
    // Cell edge ≈ 130 m · cos(41°) ≈ 98 m: the point is within one circumradius of the centre.
    expect(haversineM(p, cellCenter(cell))).toBeLessThan(100);
  });

  it('matches the server grid formula', () => {
    // centre(q, r) = (1.5·s·q, √3·s·(r + q/2)) in EPSG:3857
    expect(cellCenterMercator({ q: 2, r: -1 })).toEqual([390, 0]);
    expect(cellRing({ q: 0, r: 0 })).toHaveLength(6);
  });

  it('neighbouring cells do not overlap', () => {
    const a = cellCenter({ q: 0, r: 0 });
    const b = cellCenter({ q: 1, r: 0 });
    expect(cellAt(a)).not.toEqual(cellAt(b));
  });
});

describe('territory estimate', () => {
  it('claims nothing for short routes', () => {
    expect(estimateClaim(routeFromOffsets([[0, 0], [100, 0]], 3)).shape).toBe('too_short');
  });

  it('claims the cells an open route runs through', () => {
    const est = estimateClaim(routeFromOffsets([[0, 0], [1000, 0]], 3));
    expect(est.shape).toBe('corridor');
    // Server test expects 5–12 for the same route.
    expect(est.cells).toBeGreaterThanOrEqual(5);
    expect(est.cells).toBeLessThanOrEqual(12);
    expect(est.loopCells).toBe(0);
  });

  it('adds interior cells for loops', () => {
    const est = estimateClaim(routeFromOffsets(square(600), 3));
    expect(est.shape).toBe('loop');
    expect(est.loopCells).toBeGreaterThan(5);
    expect(est.cells).toBeGreaterThan(est.routeCells);
  });
});

describe('format', () => {
  it('formats distances and durations', () => {
    expect(formatDistance(850, 'metric')).toBe('850 m');
    expect(formatDistance(5000, 'metric')).toBe('5,00 km');
    expect(formatDistance(1609.344, 'imperial')).toBe('1,00 mi');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(65)).toBe('01:05');
  });

  it('formats pace for runs and speed for rides', () => {
    expect(formatPaceOrSpeed(1000 / 300, 'run', 'metric')).toEqual({ value: '5:00', unit: '/km' });
    expect(formatPaceOrSpeed(10, 'ride', 'metric')).toEqual({ value: '36,0', unit: 'km/sa' });
    expect(formatPaceOrSpeed(null, 'walk', 'metric').value).toBe('–');
  });

  it('formats goal distances compactly', () => {
    expect(formatGoalDistance(20000, 'metric')).toBe('20 km');
    expect(formatGoalDistance(12600, 'metric')).toBe('12,6 km');
    expect(formatGoalDistance(0, 'metric')).toBe('0 km');
  });

  it('formats areas', () => {
    expect(formatArea(25_000, 'metric')).toBe('2,50 ha');
    expect(formatArea(2_500_000, 'metric')).toBe('2,50 km²');
  });
});

describe('privacy', () => {
  it('trims route ends', () => {
    const pts = routeFromOffsets([[0, 0], [1000, 0]], 3);
    const trimmed = trimRouteEnds(pts, 200);
    expect(routeDistanceM(trimmed)).toBeCloseTo(600, -1);
    expect(trimRouteEnds(routeFromOffsets([[0, 0], [300, 0]], 3), 200)).toEqual([]);
  });

  it('removes points inside privacy zones', () => {
    const pts = routeFromOffsets([[0, 0], [1000, 0]], 3);
    const zone = { id: 'z', label: 'Ev', center: pts[0], radiusM: 300 };
    const kept = removePointsInZones(pts, [zone]);
    expect(kept.every((p) => haversineM(p, zone.center) > 300)).toBe(true);
  });

  it('suggests zones for repeated start points', () => {
    const home = { latitude: 41, longitude: 29 };
    const near = (d: number) => ({ latitude: home.latitude + d / 111_195, longitude: home.longitude });
    const s = suggestPrivacyZones([near(0), near(30), near(60), near(5000)], []);
    expect(s).toHaveLength(1);
    expect(s[0].hits).toBe(3);
  });
});

describe('weekly goals', () => {
  const now = new Date(2026, 9, 9, 12).getTime(); // Friday
  const mk = (ts: number, distanceM: number): Activity => ({
    id: String(ts), remoteId: null, type: 'walk', title: '', visibility: 'private', routeShare: 'trimmed', source: 'phone', externalId: null, sourceDevice: null, best5kS: null, best10kS: null,
    startedAt: ts, endedAt: ts + 1, movingTimeS: 600, distanceM, estimatedCells: 0,
    syncState: 'local_only', claim: null, lastSyncError: null,
  });

  it('counts distinct active days with minimum distance', () => {
    const ws = startOfWeek(now);
    const acts = [mk(ws + 3600e3, 1500), mk(ws + 3700e3, 1500), mk(ws + 86400e3 + 1, 1200), mk(ws + 2 * 86400e3, 200)];
    const [days] = weeklyGoals(acts, 'beginner', now);
    expect(days.progress).toBe(2);
    expect(days.done).toBe(false);
  });
});

describe('username normalisation', () => {
  it('maps Turkish letters and strips invalid characters', () => {
    expect(normalizeUsername('Şükrü Öztürk?')).toBe('sukru_ozturk');
    expect(normalizeUsername('deneme?koşucu')).toBe('denemekosucu');
    expect(normalizeUsername('Ko\u0073\u0327ucu IŞIK')).toBe('kosucu_isik');
  });
});

describe('imported routes', () => {
  it('filters inaccurate fixes and keeps segments apart', () => {
    const base = routeFromOffsets([[0, 0], [600, 0]], 3);
    const locs = base.map((p, i) => ({
      latitude: p.latitude,
      longitude: p.longitude,
      horizontalAccuracy: i === 5 ? 80 : 5,
      timestamp: p.timestamp,
      speed: 3,
      altitude: null,
      segment: i < 30 ? 0 : 1,
    }));
    const pts = routeFromExternalLocations(locs, 'run');
    expect(pts).toHaveLength(base.length - 1);
    expect(new Set(pts.map((p) => p.segment))).toEqual(new Set([0, 1]));
    expect(pts.every((p, i) => p.seq === i)).toBe(true);
  });
});
