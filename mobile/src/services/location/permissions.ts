import * as Location from 'expo-location';
import { Linking } from 'react-native';

export type LocationAccess =
  | 'services_off' // device-wide location is disabled
  | 'denied' // user refused (can only be changed in Settings)
  | 'undetermined'
  | 'foreground' // "While using the app"
  | 'background'; // "Always" — needed for reliable lock-screen recording on Android

export async function getLocationAccess(): Promise<LocationAccess> {
  if (!(await Location.hasServicesEnabledAsync())) return 'services_off';
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status === 'denied') return 'denied';
  if (fg.status !== 'granted') return 'undetermined';
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.status === 'granted' ? 'background' : 'foreground';
}

export async function requestForegroundLocation(): Promise<LocationAccess> {
  const res = await Location.requestForegroundPermissionsAsync();
  if (res.status !== 'granted') return res.canAskAgain ? 'undetermined' : 'denied';
  return getLocationAccess();
}

/** Asks for "Always" access. On Android 11+ this opens the system settings page. */
export async function requestBackgroundLocation(): Promise<LocationAccess> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') return requestForegroundLocation();
  try {
    await Location.requestBackgroundPermissionsAsync();
  } catch {
    // Missing background mode in the native build; fall through to report current state.
  }
  return getLocationAccess();
}

export function openAppSettings() {
  return Linking.openSettings();
}
