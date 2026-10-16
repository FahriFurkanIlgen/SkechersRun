import { Redirect } from 'expo-router';

/**
 * Strava's OAuth redirect (runner://strava-callback?code=…). The browser
 * session in services/strava.ts reads the code; if the system also opens the
 * link in the app (Android), just return to the import screen.
 */
export default function StravaCallback() {
  return <Redirect href="/import-strava" />;
}
