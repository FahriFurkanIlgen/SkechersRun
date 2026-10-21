import Constants from 'expo-constants';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

/**
 * Android battery optimisation can stop background location during long
 * activities. Many manufacturers add their own, stricter app killers on top,
 * so besides the system setting we show manufacturer-specific steps.
 */

export interface BatteryAdvice {
  /** Manufacturer-specific extra steps, if we know any. */
  vendorSteps: string | null;
}

const VENDOR_STEPS: { match: RegExp; steps: string }[] = [
  {
    match: /xiaomi|redmi|poco/i,
    steps: 'Ayarlar → Uygulamalar → Battle Run → Pil tasarrufu → “Kısıtlama yok”. Aynı ekranda “Otomatik başlat”ı da aç.',
  },
  {
    match: /samsung/i,
    steps: 'Ayarlar → Pil → Arka plan kullanım sınırları → Battle Run’ı “Hiç uyumayan uygulamalar”a ekle.',
  },
  {
    match: /huawei|honor/i,
    steps: 'Ayarlar → Pil → Uygulama başlatma → Battle Run → “Manuel yönet” ve üç seçeneği de aç.',
  },
  {
    match: /oppo|realme|oneplus/i,
    steps: 'Ayarlar → Pil → Battle Run → “Arka planda çalışmaya izin ver”i aç ve uygulamayı kısıtlama.',
  },
  {
    match: /vivo|iqoo/i,
    steps: 'Ayarlar → Pil → Arka planda yüksek güç tüketimi → Battle Run’a izin ver.',
  },
];

/** null when nothing needs to be done (iOS, or optimisation already off). */
export async function getBatteryAdvice(): Promise<BatteryAdvice | null> {
  if (Platform.OS !== 'android') return null;
  try {
    if (!(await Battery.isBatteryOptimizationEnabledAsync())) return null;
  } catch {
    return null;
  }
  const maker = `${Device.manufacturer ?? ''} ${Device.brand ?? ''}`;
  return { vendorSteps: VENDOR_STEPS.find((v) => v.match.test(maker))?.steps ?? null };
}

/** Opens the system battery optimisation list (falls back to the app's settings page). */
export async function openBatterySettings(): Promise<void> {
  try {
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
  } catch {
    const pkg = Constants.expoConfig?.android?.package;
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, {
      data: pkg ? `package:${pkg}` : undefined,
    });
  }
}
