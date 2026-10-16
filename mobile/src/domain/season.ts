/**
 * Monthly seasons. Points = cells gained + cells taken from others + landmark
 * bonus (server: season_points). Ranks are fixed thresholds so everyone can see
 * what the next one takes; a new season starts every month.
 */
export const SEASON_TIERS = [
  { name: 'Çaylak', min: 0 },
  { name: 'Bronz', min: 25 },
  { name: 'Gümüş', min: 75 },
  { name: 'Altın', min: 200 },
  { name: 'Platin', min: 450 },
  { name: 'Elmas', min: 900 },
  { name: 'Efsane', min: 1600 },
] as const;

export type SeasonTier = (typeof SEASON_TIERS)[number]['name'];

export interface SeasonRank {
  tier: SeasonTier;
  index: number;
  next: { tier: SeasonTier; remaining: number } | null;
  /** Progress from the current tier to the next, 0..1 (1 at the top tier). */
  progress: number;
}

export function seasonRank(points: number): SeasonRank {
  const p = Math.max(0, Math.floor(points));
  let index = 0;
  for (let i = 0; i < SEASON_TIERS.length; i++) if (p >= SEASON_TIERS[i].min) index = i;
  const cur = SEASON_TIERS[index];
  const nxt = SEASON_TIERS[index + 1];
  return {
    tier: cur.name,
    index,
    next: nxt ? { tier: nxt.name, remaining: nxt.min - p } : null,
    progress: nxt ? (p - cur.min) / (nxt.min - cur.min) : 1,
  };
}

/** Whole days left until the season ends (at least 0). */
export function seasonDaysLeft(endMs: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((endMs - now) / 86_400_000));
}
