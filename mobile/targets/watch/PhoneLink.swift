import Foundation
import WatchConnectivity

/// Phone recording state mirrored from the iPhone (see modules/runner-watch).
struct PhoneSession: Equatable {
  enum State: String {
    case idle, recording, paused
  }

  let state: State
  let kind: ActivityKind
  let movingMsAccum: Double
  let resumedAt: Double?
  let distanceM: Double
  let gps: GpsQuality
  let estimatedCells: Int
  let sentAt: Date

  init?(_ dict: [String: Any]) {
    guard dict["kind"] as? String == "phoneSession",
          let state = State(rawValue: dict["state"] as? String ?? "") else { return nil }
    self.state = state
    kind = ActivityKind(rawValue: dict["type"] as? String ?? "") ?? .run
    movingMsAccum = (dict["movingMsAccum"] as? NSNumber)?.doubleValue ?? 0
    resumedAt = (dict["resumedAt"] as? NSNumber)?.doubleValue
    distanceM = (dict["distanceM"] as? NSNumber)?.doubleValue ?? 0
    gps = GpsQuality(rawValue: dict["gps"] as? String ?? "") ?? .none
    estimatedCells = (dict["estimatedCells"] as? NSNumber)?.intValue ?? 0
    sentAt = Date(timeIntervalSince1970: ((dict["sentAt"] as? NSNumber)?.doubleValue ?? 0) / 1000)
  }

  var isActive: Bool { state == .recording || state == .paused }

  /// The phone refreshes this at least every few seconds while recording; an
  /// old value means the phone app stopped or the watch lost the connection.
  var isFresh: Bool { Date().timeIntervalSince(sentAt) < 60 }

  func movingTime(at date: Date = Date()) -> TimeInterval {
    var ms = movingMsAccum
    if state == .recording, let resumedAt {
      ms += max(0, date.timeIntervalSince1970 * 1000 - resumedAt)
    }
    return ms / 1000
  }
}

@MainActor
final class PhoneLink: NSObject, ObservableObject {
  static let shared = PhoneLink()

  @Published private(set) var phone: PhoneSession?
  @Published private(set) var reachable = false
  @Published var commandError: String?

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  /// A phone recording to mirror: active and recently updated.
  var livePhoneSession: PhoneSession? {
    guard let phone, phone.isActive, phone.isFresh || reachable else { return nil }
    return phone
  }

  func send(command: String) {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else {
      commandError = "Telefona ulaşılamıyor. Kaydı telefondan yönet."
      return
    }
    commandError = nil
    session.sendMessage(["kind": "command", "command": command], replyHandler: nil) { [weak self] _ in
      Task { @MainActor in self?.commandError = "Komut telefona iletilemedi." }
    }
  }

  func requestPhoneSession() {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { return }
    session.sendMessage(["kind": "requestPhoneSession"], replyHandler: nil, errorHandler: nil)
  }

  /// Guaranteed, queued delivery: arrives even if the phone is away or the app is closed.
  func sendWorkout(workoutId: String, kind: ActivityKind, startedAt: Date, endedAt: Date, distanceM: Double) {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
    WCSession.default.transferUserInfo([
      "kind": "watchWorkout",
      "workoutId": workoutId,
      "type": kind.rawValue,
      "startedAt": startedAt.timeIntervalSince1970 * 1000,
      "endedAt": endedAt.timeIntervalSince1970 * 1000,
      "distanceM": distanceM,
    ])
  }

  fileprivate func receive(_ dict: [String: Any]) {
    if let units = dict["units"] as? String {
      UserDefaults.standard.set(units, forKey: "runner.units")
    }
    if let session = PhoneSession(dict) {
      phone = session
    }
  }

  fileprivate func setReachable(_ value: Bool) {
    reachable = value
    if value { requestPhoneSession() }
  }
}

extension PhoneLink: WCSessionDelegate {
  nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    let context = session.receivedApplicationContext
    let reachable = session.isReachable
    Task { @MainActor in
      self.receive(context)
      self.setReachable(reachable)
    }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    let reachable = session.isReachable
    Task { @MainActor in self.setReachable(reachable) }
  }

  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    Task { @MainActor in self.receive(applicationContext) }
  }

  nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    Task { @MainActor in self.receive(message) }
  }
}
