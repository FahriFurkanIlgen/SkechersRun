import { Stat, StatGrid } from '../../components/ui';
import { durationLabel, formatDistance, formatDuration, formatPaceOrSpeed } from '../../domain/format';
import type { Activity, UnitSystem } from '../../domain/types';

export function ActivityStats({
  activity,
  avgSpeedMps,
  units,
}: {
  activity: Activity;
  avgSpeedMps: number | null;
  units: UnitSystem;
}) {
  const avg = formatPaceOrSpeed(avgSpeedMps, activity.type, units);
  const cells = activity.claim?.status === 'accepted' ? activity.claim.netGainCells : activity.estimatedCells;
  return (
    <StatGrid>
      <Stat label="Mesafe" value={formatDistance(activity.distanceM, units)} />
      <Stat label="Süre" value={formatDuration(activity.movingTimeS)} accessibilityValue={durationLabel(activity.movingTimeS)} />
      <Stat label={activity.type === 'ride' ? 'Ortalama hız' : 'Ortalama tempo'} value={avg.value} unit={avg.unit} />
      <Stat
        label={activity.claim?.status === 'accepted' ? 'Kazanılan hücre' : 'Tahmini hücre'}
        value={`+${cells}`}
        unit="hücre"
      />
    </StatGrid>
  );
}
