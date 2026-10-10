import Foundation
import HealthKit

enum ActivityKind: String, CaseIterable, Identifiable {
  case walk, run, ride

  var id: String { rawValue }

  var label: String {
    switch self {
    case .walk: return "Yürüyüş"
    case .run: return "Koşu"
    case .ride: return "Bisiklet"
    }
  }

  var symbol: String {
    switch self {
    case .walk: return "figure.walk"
    case .run: return "figure.run"
    case .ride: return "figure.outdoor.cycle"
    }
  }

  var healthKitType: HKWorkoutActivityType {
    switch self {
    case .walk: return .walking
    case .run: return .running
    case .ride: return .cycling
    }
  }

  var distanceType: HKQuantityType {
    HKQuantityType(self == .ride ? .distanceCycling : .distanceWalkingRunning)
  }

  /// Same limits as src/domain/rules.ts (MAX_SPEED_MPS × 1.5 for single jumps).
  var jumpSpeedLimitMps: Double {
    switch self {
    case .walk: return 3.5 * 1.5
    case .run: return 8 * 1.5
    case .ride: return 22 * 1.5
    }
  }
}

enum GpsQuality: String {
  case good, fair, weak, none

  var label: String {
    switch self {
    case .good: return "GPS iyi"
    case .fair: return "GPS orta"
    case .weak: return "GPS zayıf"
    case .none: return "GPS yok"
    }
  }

  var isUsable: Bool { self == .good || self == .fair }

  /// Same thresholds as signalQuality() in src/domain/gpsFilter.ts.
  static func from(accuracy: Double?, fixAt: Date?, now: Date = Date()) -> GpsQuality {
    guard let accuracy, let fixAt, now.timeIntervalSince(fixAt) <= 20 else { return .none }
    if accuracy <= 10 { return .good }
    if accuracy <= 20 { return .fair }
    return .weak
  }
}

enum Units: String {
  case metric, imperial
}

/// Shared rules (src/domain/rules.ts).
enum Rules {
  static let maxAccuracyM = 30.0
  static let minPointSpacingM = 3.0
  static let minPointInterval: TimeInterval = 15
  static let minClaimDistanceM = 400.0
  /// Older fixes are cached positions, not the current one.
  static let maxFixAge: TimeInterval = 10
}

enum Format {
  static var units: Units {
    Units(rawValue: UserDefaults.standard.string(forKey: "runner.units") ?? "") ?? .metric
  }

  private static func decimal(_ v: Double, _ digits: Int) -> String {
    String(format: "%.\(digits)f", v).replacingOccurrences(of: ".", with: ",")
  }

  static func distance(_ m: Double, units: Units = Format.units) -> (value: String, unit: String) {
    units == .imperial ? (decimal(m / 1609.344, 2), "mi") : (decimal(m / 1000, 2), "km")
  }

  static func duration(_ s: TimeInterval) -> String {
    let total = max(0, Int(s))
    let h = total / 3600
    let m = (total % 3600) / 60
    let sec = total % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
  }

  /// Average pace (walk/run) or speed (ride), like formatPaceOrSpeed on the phone.
  static func paceOrSpeed(distanceM: Double, seconds: TimeInterval, kind: ActivityKind, units: Units = Format.units) -> String {
    guard distanceM >= 50, seconds > 0 else { return "–" }
    let unitM = units == .imperial ? 1609.344 : 1000
    if kind == .ride {
      return "\(decimal(distanceM / seconds * 3600 / unitM, 1)) \(units == .imperial ? "mph" : "km/sa")"
    }
    let pace = seconds / (distanceM / unitM)
    return "\(duration(pace)) /\(units == .imperial ? "mi" : "km")"
  }
}
