import { type LatLng } from './geo';
import { cellKey, estimateCells, type Cell } from './hex';
import { RULES } from './rules';
import type { ActivityType, Landmark, RoutePoint, TerritoryCell } from './types';

/**
 * "Akıllı rota": loops that start and end at the player and run over the most
 * valuable cells nearby. Shapes are geometric (circles and ellipses), not
 * snapped to streets — the map shows them as a direction to aim for.
 */

/** Typical moving speed per activity, m/s. */
const SPEED: Record<ActivityType, number> = { walk: 1.3, run: 2.7, ride: 5.0, wheelchair: 1.4 };

/** Value of passing through / enclosing one cell. Mirrors season points: stealing counts twice. */
const VALUE = { empty: 1, theirs: 2, mineWeak: 0.5, landmark: 5 };

const DIRECTIONS = 12;
/** Ellipse long/short axis ratios; long thin loops keep long rides under the cell cap. */
const RATIOS = [1, 2.2, 4];
const POINTS_PER_LOOP = 48;

export interface RouteSuggestion {
  /** Closed loop from the player back to the player. */
  points: LatLng[];
  distanceM: number;
  minutes: number;
  /** Cells on/inside the loop worth something to the player. */
  targets: Cell[];
  /** Cells taken from other players (subset of targets). */
  steals: number;
  /** Landmark cells on the loop not owned by the player. */
  landmarks: number;
  /** Device estimate of all cells the loop claims. */
  cells: number;
  score: number;
  /** Compass bearing of the loop's far end, degrees. */
  bearing: number;
  /** true = follows streets (Apple Maps); false = geometric direction only. */
  snapped: boolean;
}

const M_PER_DEG_LAT = 111_195;

function offset(origin: LatLng, eastM: number, northM: number): LatLng {
  return {
    latitude: origin.latitude + northM / M_PER_DEG_LAT,
    longitude: origin.longitude + eastM / (M_PER_DEG_LAT * Math.cos((origin.latitude * Math.PI) / 180)),
  };
}

/** Ellipse through `start`, its long axis pointing at `bearing`, with the given perimeter. */
export function ellipseLoop(start: LatLng, perimeterM: number, bearingDeg: number, ratio: number, n = POINTS_PER_LOOP): LatLng[] {
  // Ramanujan: P ≈ π(a+b)(1 + 3h/(10+√(4−3h))), h = ((a−b)/(a+b))²; solve for b with a = ratio·b.
  const h = ((ratio - 1) / (ratio + 1)) ** 2;
  const k = Math.PI * (ratio + 1) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const b = perimeterM / k;
  const a = ratio * b;
  const th = (bearingDeg * Math.PI) / 180;
  // Unit vectors (east, north) along and across the long axis.
  const ux = Math.sin(th);
  const uy = Math.cos(th);
  const vx = Math.cos(th);
  const vy = -Math.sin(th);
  const out: LatLng[] = [];
  for (let i = 0; i <= n; i++) {
    // t = π at the start, so the loop begins and ends exactly at the player.
    const t = Math.PI + (2 * Math.PI * i) / n;
    const along = a + a * Math.cos(t);
    const across = b * Math.sin(t);
    out.push(offset(start, along * ux + across * vx, along * uy + across * vy));
  }
  return out;
}

function asRoute(points: LatLng[]): RoutePoint[] {
  return points.map((p, i) => ({
    seq: i,
    segment: 0,
    latitude: p.latitude,
    longitude: p.longitude,
    accuracy: 5,
    altitude: null,
    speed: null,
    timestamp: i * 1000,
    mocked: false,
  }));
}

export interface ScoreContext {
  byKey: Map<string, TerritoryCell>;
  landmarkKeys: Set<string>;
}

export function scoreContext(territories: TerritoryCell[], landmarks: Landmark[] = []): ScoreContext {
  return { byKey: new Map(territories.map((c) => [cellKey(c), c])), landmarkKeys: new Set(landmarks.filter((l) => !l.isMine).map(cellKey)) };
}

/** Value of a closed route for the player; null when it claims nothing or too much. */
export function scoreLoop(points: LatLng[], ctx: ScoreContext): Pick<RouteSuggestion, 'targets' | 'steals' | 'landmarks' | 'cells' | 'score'> | null {
  const est = estimateCells(asRoute(points));
  if (est.cells.length === 0 || est.cells.length > RULES.maxClaimCells) return null;
  let score = 0;
  let steals = 0;
  let lm = 0;
  const targets: Cell[] = [];
  for (const cell of est.cells) {
    const key = cellKey(cell);
    const owned = ctx.byKey.get(key);
    let v = 0;
    if (!owned) v = VALUE.empty;
    else if (owned.isMine) v = owned.weak ? VALUE.mineWeak : 0;
    else if (!owned.protected) {
      v = VALUE.theirs;
      steals++;
    }
    if (ctx.landmarkKeys.has(key) && !owned?.protected && !owned?.isMine) {
      v += VALUE.landmark;
      lm++;
    }
    if (v > 0) {
      score += v;
      targets.push(cell);
    }
  }
  return { targets, steals, landmarks: lm, cells: est.cells.length, score };
}

/** Target loop length for a duration. */
/** Minutes a loop of this length takes at a typical pace. */
export function loopMinutes(type: ActivityType, distanceM: number): number {
  return Math.round(distanceM / SPEED[type] / 60);
}

export function loopDistanceM(type: ActivityType, minutes: number): number {
  return Math.max(RULES.minClaimDistanceM * 1.5, SPEED[type] * minutes * 60);
}

/**
 * Geometric loops, best first and pointing in clearly different directions.
 * They ignore streets and water; services/smartRoute.ts snaps them to streets
 * where Apple Maps directions are available.
 */
export function suggestRoutes(input: {
  start: LatLng;
  minutes: number;
  type: ActivityType;
  territories: TerritoryCell[];
  landmarks?: Landmark[];
  /** How many distinct options to return. */
  count?: number;
}): RouteSuggestion[] {
  const { start, minutes, type, territories, landmarks = [], count = 3 } = input;
  const distanceM = loopDistanceM(type, minutes);
  const ctx = scoreContext(territories, landmarks);

  const candidates: RouteSuggestion[] = [];
  for (const ratio of RATIOS) {
    for (let d = 0; d < DIRECTIONS; d++) {
      const bearing = (360 / DIRECTIONS) * d + (ratio === 1 ? 0 : 15);
      const points = ellipseLoop(start, distanceM, bearing, ratio);
      const scored = scoreLoop(points, ctx);
      if (!scored) continue;
      candidates.push({ points, distanceM, minutes, ...scored, bearing: bearing % 360, snapped: false });
    }
  }
  return pickDistinct(candidates, count);
}

/** Best first; skip options pointing almost the same way as a better one. */
export function pickDistinct(candidates: RouteSuggestion[], count: number): RouteSuggestion[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const picked: RouteSuggestion[] = [];
  for (const c of sorted) {
    if (c.score <= 0) break;
    if (picked.some((p) => angleBetween(p.bearing, c.bearing) < 50)) continue;
    picked.push(c);
    if (picked.length === count) break;
  }
  return picked;
}

/** A few points along the loop (start first and last) to route between on streets. */
export function loopWaypoints(points: LatLng[], legs = 4): LatLng[] {
  const out: LatLng[] = [];
  for (let k = 0; k <= legs; k++) out.push(points[Math.round((k * (points.length - 1)) / legs)]);
  return out;
}

function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const COMPASS = ['kuzey', 'kuzeydoğu', 'doğu', 'güneydoğu', 'güney', 'güneybatı', 'batı', 'kuzeybatı'];

/** "kuzeydoğu" for 45°. */
export function compassName(bearing: number): string {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}
