import { haversineM, type LatLng } from './geo';
import { segments } from './metrics';
import { RULES } from './rules';
import type { RoutePoint } from './types';

/**
 * Hexagon cell grid, identical to the server (supabase/migrations/*_hex_cells.sql):
 * flat-topped hexagons in Web Mercator (EPSG:3857), axial coordinates (q, r),
 *   centre(q, r) = (1.5·s·q, √3·s·(r + q/2))  with s = HEX_SIZE mercator metres.
 */
export const HEX_SIZE = 130;
const R = 6378137;
const SQRT3 = Math.sqrt(3);
const DEG = Math.PI / 180;

export interface Cell {
  q: number;
  r: number;
}

export const cellKey = (c: Cell) => `${c.q}:${c.r}`;

export function toMercator(p: LatLng): [number, number] {
  return [R * p.longitude * DEG, R * Math.log(Math.tan(Math.PI / 4 + (p.latitude * DEG) / 2))];
}

export function fromMercator(x: number, y: number): LatLng {
  return { latitude: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / DEG, longitude: x / R / DEG };
}

export function cellCenterMercator({ q, r }: Cell): [number, number] {
  return [HEX_SIZE * 1.5 * q, HEX_SIZE * SQRT3 * (r + q / 2)];
}

/** Postgres-compatible rounding (half away from zero). */
const round = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

/** The cell containing a point (cube-coordinate rounding). */
export function cellAt(p: LatLng): Cell {
  const [x, y] = toMercator(p);
  const fq = ((2 / 3) * x) / HEX_SIZE;
  const fr = ((-1 / 3) * x + (SQRT3 / 3) * y) / HEX_SIZE;
  const fs = -fq - fr;
  let q = round(fq);
  let r = round(fr);
  const s = round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

/** Hexagon outline as six lat/lng corners. */
export function cellRing(cell: Cell): LatLng[] {
  const [cx, cy] = cellCenterMercator(cell);
  return Array.from({ length: 6 }, (_, k) => fromMercator(cx + HEX_SIZE * Math.cos(k * 60 * DEG), cy + HEX_SIZE * Math.sin(k * 60 * DEG)));
}

export function cellCenter(cell: Cell): LatLng {
  const [x, y] = cellCenterMercator(cell);
  return fromMercator(x, y);
}

/** All cells whose centre could fall in a lat/lng bounding box. */
export function cellsInBounds(min: LatLng, max: LatLng): Cell[] {
  const [x0, y0] = toMercator(min);
  const [x1, y1] = toMercator(max);
  const out: Cell[] = [];
  for (let q = Math.floor(x0 / (1.5 * HEX_SIZE)) - 1; q <= Math.ceil(x1 / (1.5 * HEX_SIZE)) + 1; q++) {
    const r0 = Math.floor(y0 / (HEX_SIZE * SQRT3) - q / 2) - 1;
    const r1 = Math.ceil(y1 / (HEX_SIZE * SQRT3) - q / 2) + 1;
    for (let r = r0; r <= r1; r++) out.push({ q, r });
  }
  return out;
}

function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface CellEstimate {
  routeCells: Cell[];
  loopCells: Cell[];
  /** Union of route and loop cells (what the server would claim, before ownership). */
  cells: Cell[];
  isLoop: boolean;
}

/**
 * Device-side estimate of the cells an activity claims (the server decides):
 * cells the path runs through for ≥ minCellPathM, plus — if the route returns
 * near its start — cells whose centre lies inside the loop.
 */
export function estimateCells(points: RoutePoint[]): CellEstimate {
  const pathInCell = new Map<string, { cell: Cell; m: number }>();
  for (const seg of segments(points)) {
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1];
      const b = seg[i];
      const d = haversineM(a, b);
      const steps = Math.max(1, Math.ceil(d / 5));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const cell = cellAt({ latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t });
        const key = cellKey(cell);
        const entry = pathInCell.get(key) ?? { cell, m: 0 };
        entry.m += d / steps;
        pathInCell.set(key, entry);
      }
    }
  }
  const routeCells = [...pathInCell.values()].filter((e) => e.m >= RULES.minCellPathM).map((e) => e.cell);

  const first = points[0];
  const last = points[points.length - 1];
  const isLoop = points.length >= 4 && haversineM(first, last) <= RULES.loopCloseDistanceM;
  const loopCells: Cell[] = [];
  if (isLoop) {
    const ring = points.map(toMercator);
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLng = Math.min(minLng, p.longitude);
      maxLng = Math.max(maxLng, p.longitude);
    }
    for (const cell of cellsInBounds({ latitude: minLat, longitude: minLng }, { latitude: maxLat, longitude: maxLng })) {
      const [cx, cy] = cellCenterMercator(cell);
      if (pointInRing(cx, cy, ring)) loopCells.push(cell);
    }
  }

  const all = new Map<string, Cell>();
  for (const c of [...routeCells, ...loopCells]) all.set(cellKey(c), c);
  return { routeCells, loopCells, cells: [...all.values()], isLoop };
}

/**
 * Cells within `radiusM` of a point (by cell centre) that are not in `owned`
 * (keys from cellKey), nearest first. Used to suggest where to go next.
 */
export function emptyCellsNear(center: LatLng, radiusM: number, owned: Set<string>): Cell[] {
  const dLat = radiusM / 111_195;
  const dLng = radiusM / (111_195 * Math.cos((center.latitude * Math.PI) / 180));
  const candidates = cellsInBounds(
    { latitude: center.latitude - dLat, longitude: center.longitude - dLng },
    { latitude: center.latitude + dLat, longitude: center.longitude + dLng },
  );
  return candidates
    .filter((c) => !owned.has(cellKey(c)))
    .map((c) => ({ c, d: haversineM(center, cellCenter(c)) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.c);
}
