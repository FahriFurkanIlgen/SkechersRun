/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'RunnerWatch',
  displayName: 'Runner',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  icon: '../../assets/icon.png',
  colors: {
    // Dark-theme primary from the design system (watch UI is always dark).
    $accent: '#7FA3FF',
    rival: '#FF8A4C',
  },
  frameworks: ['SwiftUI', 'HealthKit', 'CoreLocation', 'WatchConnectivity'],
  entitlements: {
    'com.apple.developer.healthkit': true,
    'com.apple.developer.healthkit.access': [],
  },
};
