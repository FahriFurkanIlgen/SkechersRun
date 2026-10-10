Pod::Spec.new do |s|
  s.name           = 'RunnerWatch'
  s.version        = '0.1.0'
  s.summary        = 'WatchConnectivity bridge for Runner'
  s.description    = 'WatchConnectivity bridge between the Runner iOS app and its Apple Watch app'
  s.license        = 'UNLICENSED'
  s.author         = 'Runner'
  s.homepage       = 'https://github.com/FahriFurkanIlgen/SkechersRun'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
