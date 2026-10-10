import type { Activity, AthleteLevel } from './types';

/**
 * Weekly goals reward showing up regularly rather than speed or fitness.
 * Walking counts exactly like running or riding.
 */
export interface WeeklyGoal {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  done: boolean;
}

const GOALS: Record<AthleteLevel, { activeDays: number; minActivityM: number; streakWeeks: number }> = {
  beginner: { activeDays: 3, minActivityM: 1000, streakWeeks: 2 },
  experienced: { activeDays: 5, minActivityM: 3000, streakWeeks: 4 },
};

const DAY_MS = 86_400_000;

/** Monday 00:00 local time of the week containing `now`. */
export function startOfWeek(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return d.getTime() - day * DAY_MS;
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function activeDaysBetween(activities: Activity[], from: number, to: number, minM: number) {
  const days = new Set<string>();
  for (const a of activities) {
    if (a.startedAt >= from && a.startedAt < to && a.distanceM >= minM) days.add(dayKey(a.startedAt));
  }
  return days.size;
}

export function weeklyGoals(activities: Activity[], level: AthleteLevel, now = Date.now()): WeeklyGoal[] {
  const cfg = GOALS[level];
  const weekStart = startOfWeek(now);
  const weekEnd = weekStart + 7 * DAY_MS;
  const activeDays = activeDaysBetween(activities, weekStart, weekEnd, cfg.minActivityM);

  // Consecutive previous weeks (excluding the current one) that met the day goal.
  let streak = 0;
  for (let w = 1; w <= 52; w++) {
    const from = weekStart - w * 7 * DAY_MS;
    if (activeDaysBetween(activities, from, from + 7 * DAY_MS, cfg.minActivityM) >= cfg.activeDays) streak++;
    else break;
  }
  const streakIncludingThisWeek = streak + (activeDays >= cfg.activeDays ? 1 : 0);

  const km = cfg.minActivityM / 1000;
  return [
    {
      id: 'active-days',
      title: `Bu hafta ${cfg.activeDays} gün hareket et`,
      description: `En az ${km} km'lik her aktivite bir gün sayılır. Tempo önemli değil.`,
      target: cfg.activeDays,
      progress: Math.min(activeDays, cfg.activeDays),
      done: activeDays >= cfg.activeDays,
    },
    {
      id: 'streak',
      title: `${cfg.streakWeeks} hafta üst üste hedefini tut`,
      description: 'Haftalık gün hedefini art arda tamamladığın haftalar.',
      target: cfg.streakWeeks,
      progress: Math.min(streakIncludingThisWeek, cfg.streakWeeks),
      done: streakIncludingThisWeek >= cfg.streakWeeks,
    },
  ];
}

/** Distance covered this week (Monday 00:00 local) in meters. */
export function weekDistanceM(activities: Activity[], now = Date.now()): number {
  const from = startOfWeek(now);
  return activities.filter((a) => a.startedAt >= from).reduce((s, a) => s + a.distanceM, 0);
}

export function defaultWeeklyGoalKm(level: AthleteLevel): number {
  return level === 'beginner' ? 10 : 25;
}

/** Days left in the current week including today (Mon..Sun). */
export function daysLeftInWeek(now = Date.now()): number {
  return 7 - Math.floor((now - startOfWeek(now)) / DAY_MS);
}
