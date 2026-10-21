/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'watch',
  name: 'RunnerWatch',
  displayName: 'Battle Run',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  icon: '../../assets/icon.png',
  colors: {
    // Dark-theme primary from the design system (watch UI is always dark).
    $accent: '#7FA3FF',
    rival: '#FF8A4C',
  },
  frameworks: ['SwiftUI', 'HealthKit', 'CoreLocation', 'WatchConnectivity', 'WidgetKit'],
  entitlements: {
    'com.apple.developer.healthkit': true,
    'com.apple.developer.healthkit.access': [],
    // Shared with the complication (targets/watch-widget), which reads the stats the phone sends.
    'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}`],
  },
});
