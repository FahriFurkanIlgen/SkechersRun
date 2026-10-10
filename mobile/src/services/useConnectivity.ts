import { useNetworkState } from 'expo-network';

/** True when the device reports no usable internet connection. */
export function useIsOffline(): boolean {
  const state = useNetworkState();
  return state.isConnected === false || state.isInternetReachable === false;
}
