import { haversineM } from './geo';
import { estimateCells, type Cell } from './hex';
import { routeDistanceM } from './metrics';
import { RULES } from './rules';
import type { RoutePoint } from './types';

/**
 * Territory rule (mirrored by `submit_activity` on the server, which decides):
 *
 * 1. The map is a fixed grid of hexagon cells (see hex.ts).
 * 2. Route cells: every cell your path runs through for at least `minCellPathM`.
 * 3. Loop bonus: if the route ends within `loopCloseDistanceM` of where it
 *    started, every cell whose centre lies inside the loop is claimed too.
 * 4. Activities shorter than `minClaimDistanceM` claim nothing; at most
 *    `maxClaimCells` per activity.
 * 5. Each cell has one owner. Cells you already own add nothing (repeating a
 *    route gains 0); cells owned by someone else are captured.
 */

export type ClaimShape = 'loop' | 'corridor' | 'too_short';

export interface ClaimEstimate {
  shape: ClaimShape;
  distanceM: number;
  /** Gap between start and end of the route in meters. */
  closureGapM: number;
  routeCells: number;
  loopCells: number;
  /** Estimated cells claimed before ownership rules. */
  cells: number;
  cellList: Cell[];
}

export function estimateClaim(points: RoutePoint[]): ClaimEstimate {
  const distanceM = routeDistanceM(points);
  const closureGapM = points.length >= 2 ? haversineM(points[0], points[points.length - 1]) : Infinity;
  if (distanceM < RULES.minClaimDistanceM || points.length < 3) {
    return { shape: 'too_short', distanceM, closureGapM, routeCells: 0, loopCells: 0, cells: 0, cellList: [] };
  }
  const est = estimateCells(points);
  const tooMany = est.cells.length > RULES.maxClaimCells;
  return {
    shape: est.isLoop ? 'loop' : 'corridor',
    distanceM,
    closureGapM,
    routeCells: est.routeCells.length,
    loopCells: est.loopCells.length,
    cells: tooMany ? 0 : est.cells.length,
    cellList: tooMany ? [] : est.cells,
  };
}
