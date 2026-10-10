import type { Activity, ActivityType, UnitSystem } from './types';

const KM_PER_MILE = 1.609344;

/** Turkish number formatting: decimal comma. */
export function dec(value: number, digits: number): string {
  return value.toFixed(digits).replace('.', ',');
}

export function formatDistance(meters: number, units: UnitSystem): string {
  if (units === 'imperial') {
    const miles = meters / 1000 / KM_PER_MILE;
    return `${dec(miles, 2)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${dec(meters / 1000, 2)} km`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Spoken form for screen readers, e.g. "1 saat 5 dakika 3 saniye". */
export function durationLabel(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h && `${h} saat`, m && `${m} dakika`, `${sec} saniye`].filter(Boolean).join(' ');
}

/** Pace (min/km or min/mi) for walk/run, speed (km/h or mph) for rides. */
export function formatPaceOrSpeed(
  speedMps: number | null,
  type: ActivityType,
  units: UnitSystem,
): { value: string; unit: string } {
  const unitDistance = units === 'imperial' ? KM_PER_MILE * 1000 : 1000;
  if (type === 'ride') {
    const unit = units === 'imperial' ? 'mph' : 'km/sa';
    if (speedMps == null) return { value: '–', unit };
    return { value: dec((speedMps * 3600) / unitDistance, 1), unit };
  }
  const unit = units === 'imperial' ? '/mi' : '/km';
  if (speedMps == null || speedMps < 0.3) return { value: '–', unit };
  const secPerUnit = unitDistance / speedMps;
  if (secPerUnit > 99 * 60) return { value: '–', unit };
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit % 60);
  return { value: `${m}:${String(s === 60 ? 59 : s).padStart(2, '0')}`, unit };
}

/** "1 hücre", "12 hücre" (Turkish has no plural after numbers). */
export function formatCells(n: number): string {
  return `${Math.round(n).toLocaleString('tr-TR')} hücre`;
}

export function formatArea(m2: number, units: UnitSystem): string {
  if (units === 'imperial') {
    const acres = m2 / 4046.8564224;
    return acres < 640 ? `${dec(acres, 1)} akre` : `${dec(acres / 640, 2)} mi²`;
  }
  if (m2 < 10_000) return `${Math.round(m2).toLocaleString('tr-TR')} m²`;
  if (m2 < 1_000_000) return `${dec(m2 / 10_000, 2)} ha`;
  return `${dec(m2 / 1_000_000, 2)} km²`;
}

/** Goal-style distance without trailing zeros, e.g. "20 km", "12,6 km". */
export function formatGoalDistance(meters: number, units: UnitSystem): string {
  const v = units === 'imperial' ? meters / 1609.344 : meters / 1000;
  const unit = units === 'imperial' ? 'mi' : 'km';
  const text = Number.isInteger(Math.round(v * 10) / 10) ? String(Math.round(v)) : dec(v, 1);
  return `${text} ${unit}`;
}

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  walk: 'Yürüyüş',
  run: 'Koşu',
  ride: 'Bisiklet',
};

const SOURCE_LABEL = { phone: 'Telefon', apple_health: 'Apple Sağlık', health_connect: 'Health Connect' } as const;

/** Where an imported activity came from ("Apple Watch", "Garmin Forerunner"…); null for phone recordings. */
export function sourceLabel(a: Pick<Activity, 'source' | 'sourceDevice'>): string | null {
  if (a.source === 'phone') return null;
  return a.sourceDevice ?? SOURCE_LABEL[a.source];
}

/** "Bugün 18:20", "Dün 08:05" or a short date. */
export function relativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return `Bugün ${time}`;
  if (days === 1) return `Dün ${time}`;
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}
