/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'watch-widget',
  name: 'RunnerComplication',
  displayName: 'Runner',
  // Must be prefixed by the watch app's identifier (targets/watch).
  bundleIdentifier: '.watchkitapp.widgets',
  deploymentTarget: '10.0',
  colors: {
    $accent: '#7FA3FF',
  },
  frameworks: ['WidgetKit', 'SwiftUI'],
  entitlements: {
    'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}`],
  },
});
