import Foundation

/// Weekly goal and cell count sent by the phone, stored in the App Group so
/// the complication (targets/watch-widget/SharedStats.swift) can read them.
struct SharedStats: Equatable {
  static let suiteKey = "runner.stats"

  var weekDoneM: Double
  var weekTargetM: Double
  /// Start of the week the distance belongs to (Monday 00:00 local), epoch ms.
  var weekStartMs: Double
  var cells: Int
  /// true = cells currently owned (server); false = cells gained (device only).
  var cellsOwned: Bool
  /// true = weekDoneM / weekTargetM hold minutes of movement instead of meters.
  var isMinutes: Bool

  /// App Group derived from the bundle id: com.x.runner.watchkitapp[.complication] → group.com.x.runner
  static var suite: UserDefaults? {
    guard let id = Bundle.main.bundleIdentifier,
          let range = id.range(of: ".watchkitapp") else { return nil }
    return UserDefaults(suiteName: "group." + id[..<range.lowerBound])
  }

  init?(_ dict: [String: Any]) {
    guard let target = (dict["weekTargetM"] as? NSNumber)?.doubleValue else { return nil }
    weekTargetM = target
    weekDoneM = (dict["weekDoneM"] as? NSNumber)?.doubleValue ?? 0
    weekStartMs = (dict["weekStartMs"] as? NSNumber)?.doubleValue ?? 0
    cells = (dict["cells"] as? NSNumber)?.intValue ?? 0
    cellsOwned = dict["cellsOwned"] as? Bool ?? false
    isMinutes = dict["goalUnit"] as? String == "min"
  }

  static func load() -> SharedStats? {
    guard let dict = suite?.dictionary(forKey: suiteKey) else { return nil }
    return SharedStats(dict)
  }

  static func save(_ dict: [String: Any]) {
    suite?.set(dict, forKey: suiteKey)
  }

  /// Distance done in the current week (0 once a new week started on the watch).
  func doneThisWeek(now: Date = Date()) -> Double {
    now.timeIntervalSince1970 * 1000 < weekStartMs + 7 * 86_400_000 ? weekDoneM : 0
  }

  /// "45 dk" / "2 sa 30 dk"
  static func minutesText(_ minutes: Double) -> String {
    let m = max(0, Int(minutes.rounded()))
    if m < 60 { return "\(m) dk" }
    return m % 60 == 0 ? "\(m / 60) sa" : "\(m / 60) sa \(m % 60) dk"
  }

  func ratio(now: Date = Date()) -> Double {
    weekTargetM > 0 ? min(1, doneThisWeek(now: now) / weekTargetM) : 0
  }
}
