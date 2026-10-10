import { Redirect } from 'expo-router';
import { useRecording } from '../state/recordingStore';
import { useSettings } from '../state/settingsStore';

export default function Index() {
  const onboardingDone = useSettings((s) => s.onboardingDone);
  const recording = useRecording((s) => s.status);
  if (!onboardingDone) return <Redirect href="/onboarding" />;
  // An activity was still recording when the app was closed: go straight back to it.
  if (recording === 'recording' || recording === 'paused') return <Redirect href="/record" />;
  return <Redirect href="/(tabs)" />;
}
