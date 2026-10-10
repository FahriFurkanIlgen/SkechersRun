import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, SignalBars } from '../components/Icon';
import { RouteMap } from '../components/RouteMap';
import { Banner, Button, Metric, Txt } from '../components/ui';
import { ACTIVITY_LABEL, durationLabel, formatCells, formatDuration, formatPaceOrSpeed } from '../domain/format';
import type { SignalQuality } from '../domain/gpsFilter';
import { currentSpeedMps } from '../domain/metrics';
import { estimateClaim } from '../domain/territory';
import { useRecordingClock } from '../features/activity/useRecordingClock';
import { announceSplit, splitUnitM } from '../services/splitFeedback';
import { useIsOffline } from '../services/useConnectivity';
import { useRecording } from '../state/recordingStore';
import { useSettings } from '../state/settingsStore';
import { fonts, radius, useTheme } from '../theme/theme';

const SIGNAL: Record<SignalQuality, { text: string; level: 0 | 1 | 2 | 3 | 4 }> = {
  good: { text: 'GPS iyi', level: 4 },
  fair: { text: 'GPS orta', level: 3 },
  weak: { text: 'GPS zayıf', level: 1 },
  none: { text: 'GPS yok', level: 0 },
};

function distanceParts(m: number, units: 'metric' | 'imperial') {
  const v = units === 'imperial' ? m / 1609.344 : m / 1000;
  return { value: v.toFixed(2).replace('.', ','), unit: units === 'imperial' ? 'mi' : 'km' };
}

/** 04 Canlı kayıt (+ duraklatıldı durumu) */
export default function RecordScreen() {
  useKeepAwake();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const units = useSettings((s) => s.units);
  const voice = useSettings((s) => s.voiceFeedback);
  const haptic = useSettings((s) => s.hapticFeedback);
  const setSettings = useSettings((s) => s.set);
  const rec = useRecording();
  const { movingS, signal } = useRecordingClock();
  const offline = useIsOffline();
  const leaving = useRef(false);
  const [locked, setLocked] = useState(false);

  // Nothing to show (cancelled, or opened without an active recording).
  useEffect(() => {
    if (rec.status === 'idle' && !leaving.current) router.replace('/(tabs)');
  }, [rec.status]);

  // Split announcements: every full km (or mile).
  const split = useRef<{ index: number; at: number } | null>(null);
  useEffect(() => {
    const unitM = splitUnitM(units);
    const index = Math.floor(rec.distanceM / unitM);
    if (split.current === null) {
      split.current = { index, at: movingS };
      return;
    }
    if (index > split.current.index && rec.session) {
      const dt = movingS - split.current.at;
      void announceSplit({
        index,
        movingS,
        splitSpeedMps: dt > 0 ? unitM / dt : null,
        type: rec.session.type,
        units,
        voice,
        haptic,
      });
      split.current = { index, at: movingS };
    }
  }, [rec.distanceM, movingS, units, voice, haptic, rec.session]);

  const estimate = useMemo(() => estimateClaim(rec.points), [rec.points]);

  if (!rec.session) return null;
  const type = rec.session.type;
  const paused = rec.status === 'paused';
  const pace = formatPaceOrSpeed(paused ? null : currentSpeedMps(rec.points), type, units);
  const dist = distanceParts(rec.distanceM, units);
  const bigColor = paused ? colors.text2 : colors.text;
  const sig = SIGNAL[signal];
  const sigColor = signal === 'good' || signal === 'fair' ? colors.ok : colors.warn;

  const finish = async () => {
    leaving.current = true;
    const id = await rec.finish();
    if (id) router.replace({ pathname: '/summary/[id]', params: { id } });
  };

  const cancel = () =>
    Alert.alert('Kayıt silinsin mi?', 'Bu aktivitenin rotası ve süresi kalıcı olarak silinir.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => void rec.cancel() },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: 340 }}>
        <RouteMap points={rec.points} cells={estimate.cellList} follow showsUserLocation accessibilityLabel="Canlı rota haritası. Konumun, kaydedilen yol ve kazanılan hücreler gösteriliyor." />
      </View>

      <View style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Icon name={type} size={20} color={colors.text} strokeWidth={1.9} />
          <Text style={{ fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text }}>{ACTIVITY_LABEL[type]}</Text>
        </View>
        <View
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`GPS sinyali 4 üzerinden ${sig.level}`}
          style={[chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <SignalBars level={sig.level} color={sigColor} size={16} />
          <Text style={{ fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text }}>{sig.text}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ekranı kilitle, yanlış dokunuşları önle"
          onPress={() => setLocked(true)}
          style={{ marginLeft: 'auto', width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="lock" size={20} color={colors.text} />
        </Pressable>
      </View>

      <View
        accessibilityLabel="Aktivite verileri"
        style={{ flex: 1, marginTop: -24, backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 20, paddingTop: 20, paddingBottom: insets.bottom + 12, gap: 12 }}
      >
        {paused ? (
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 40, borderRadius: 12, backgroundColor: colors.warnSoft }}>
            <Icon name="pause" size={18} color={colors.warn} />
            <Text style={{ fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text }}>Duraklatıldı · Kayıt bekliyor</Text>
          </View>
        ) : null}
        {rec.session.mode === 'foreground' ? (
          <Banner tone="warning">Arka plan konum izni yok: ekranı kilitlersen veya uygulamadan çıkarsan kayıt duraklayabilir.</Banner>
        ) : null}
        {rec.error ? <Banner tone="danger">{rec.error}</Banner> : null}
        {offline ? <Banner tone="info">Çevrimdışısın. Kayıt sürüyor; veriler cihazda güvende.</Banner> : null}

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Süre: ${durationLabel(movingS)}`}>
            <Txt variant="label" muted>Süre</Txt>
            <Metric value={formatDuration(movingS)} size="XL" color={bigColor} />
          </View>
          <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Mesafe: ${dist.value} ${dist.unit}`}>
            <Txt variant="label" muted>Mesafe</Txt>
            <Metric value={dist.value} unit={dist.unit} size="XL" color={bigColor} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="label" muted>{type === 'ride' ? 'Hız' : 'Tempo'}</Txt>
            <Metric value={pace.value} unit={pace.unit} size="M" />
          </View>
          <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Tahmini kazanılan: ${formatCells(estimate.cells)}`}>
            <Txt variant="label" muted>Kazanılan alan</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="hex" size={22} color={colors.primaryText} strokeWidth={2.2} />
              <Metric value={estimate.shape === 'too_short' ? '—' : `+${estimate.cells}`} unit={estimate.shape === 'too_short' ? undefined : 'hücre'} size="M" color={colors.primaryText} />
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Sesli geri bildirim, her 1 km"
            accessibilityState={{ checked: voice }}
            onPress={() => setSettings({ voiceFeedback: !voice })}
            style={[toggle, { borderColor: colors.border, backgroundColor: voice ? colors.bg : colors.surface }]}
          >
            <Icon name="sound" size={18} color={colors.text} />
            <Text style={{ fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text }}>{voice ? 'Sesli: her 1 km' : 'Sesli kapalı'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Titreşim, her 1 km"
            accessibilityState={{ checked: haptic }}
            onPress={() => setSettings({ hapticFeedback: !haptic })}
            style={[toggle, { borderColor: colors.border, backgroundColor: haptic ? colors.bg : colors.surface }]}
          >
            <Icon name="vibrate" size={18} color={colors.text} />
            <Text style={{ fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text }}>{haptic ? 'Titreşim açık' : 'Titreşim kapalı'}</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 'auto', alignItems: 'center', gap: 10 }}>
          {!paused ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Aktiviteyi duraklat"
                onPress={() => void rec.pause()}
                style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="pause" size={34} color={colors.surface} />
              </Pressable>
              <Txt variant="label" muted>Duraklat</Txt>
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 28 }}>
                <View style={{ alignItems: 'center', gap: 8 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Aktiviteye devam et"
                    onPress={() => void rec.resume()}
                    style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Icon name="play" size={32} color={colors.onPrimary} />
                  </Pressable>
                  <Txt variant="label">Devam et</Txt>
                </View>
                <View style={{ alignItems: 'center', gap: 8 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Aktiviteyi bitir. Bitirmek için basılı tut"
                    accessibilityActions={[{ name: 'activate', label: 'Bitir' }]}
                    onAccessibilityAction={() => void finish()}
                    onLongPress={() => void finish()}
                    delayLongPress={800}
                    style={({ pressed }) => ({
                      width: 88,
                      height: 88,
                      borderRadius: 44,
                      borderWidth: 2,
                      borderColor: colors.text,
                      backgroundColor: pressed ? colors.surface2 : colors.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                    })}
                  >
                    <Icon name="stop" size={28} color={colors.text} />
                  </Pressable>
                  <Txt variant="label">Bitir</Txt>
                </View>
              </View>
              <Txt variant="caption" muted>Bitirmek için basılı tut</Txt>
              <Button label="Kaydı sil" variant="danger" size="sm" onPress={cancel} />
            </>
          )}
        </View>
      </View>

      {locked ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ekran kilitli. Kilidi açmak için basılı tut"
          onLongPress={() => setLocked(false)}
          delayLongPress={700}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: insets.bottom + 40 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, height: 52, borderRadius: 26, backgroundColor: colors.surface }}>
            <Icon name="lock" size={20} color={colors.text} />
            <Text style={{ fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text }}>Kilidi açmak için basılı tut</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const chip = { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1 } as const;
const toggle = { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1 } as const;
