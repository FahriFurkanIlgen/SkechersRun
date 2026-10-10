import ExpoModulesCore
import WatchConnectivity

/**
 * Bridge between the Runner iOS app (JS) and the Runner Apple Watch app.
 *
 * Phone → watch: the current phone recording ("phoneSession") as application
 * context, so the watch can mirror it and show its controls.
 * Watch → phone: control commands (pause / resume / finish) for the phone
 * recording, and workouts the watch recorded on its own ("watchWorkout",
 * guaranteed delivery via transferUserInfo). Workouts are kept in
 * UserDefaults until JS acknowledges them, so none is lost while JS is not
 * running.
 */
public class RunnerWatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RunnerWatch")

    Events("onCommand", "onWatchWorkout", "onWatchState")

    OnCreate {
      WatchBridge.shared.module = self
      WatchBridge.shared.activate()
    }

    OnDestroy {
      WatchBridge.shared.module = nil
    }

    Function("isSupported") { () -> Bool in
      WCSession.isSupported()
    }

    Function("getWatchState") { () -> [String: Any] in
      WatchBridge.shared.watchState()
    }

    Function("sendPhoneSession") { (payload: [String: Any]) in
      WatchBridge.shared.sendPhoneSession(payload)
    }

    Function("pendingWorkouts") { () -> [[String: Any]] in
      WatchBridge.shared.pendingWorkouts()
    }

    Function("ackWorkout") { (workoutId: String) in
      WatchBridge.shared.ackWorkout(workoutId)
    }
  }

  fileprivate func emit(_ name: String, _ body: [String: Any]) {
    sendEvent(name, body)
  }
}

final class WatchBridge: NSObject, WCSessionDelegate {
  static let shared = WatchBridge()

  weak var module: RunnerWatchModule?

  private let pendingKey = "runner.watch.pendingWorkouts"
  private let queue = DispatchQueue(label: "runner.watch.bridge")

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    if session.delegate == nil { session.delegate = self }
    if session.activationState != .activated { session.activate() }
  }

  func watchState() -> [String: Any] {
    guard WCSession.isSupported() else {
      return ["supported": false, "paired": false, "installed": false, "reachable": false]
    }
    let s = WCSession.default
    return [
      "supported": true,
      "paired": s.activationState == .activated && s.isPaired,
      "installed": s.activationState == .activated && s.isWatchAppInstalled,
      "reachable": s.activationState == .activated && s.isReachable,
    ]
  }

  /// Latest phone recording state. Application context keeps only the newest
  /// value and is delivered when the watch app next runs; when the watch app
  /// is open (reachable) it is also sent as a message for low latency.
  func sendPhoneSession(_ payload: [String: Any]) {
    guard WCSession.isSupported() else { return }
    let s = WCSession.default
    guard s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else { return }
    var message = Self.plistSafe(payload)
    message["kind"] = "phoneSession"
    message["sentAt"] = Date().timeIntervalSince1970 * 1000
    try? s.updateApplicationContext(message)
    if s.isReachable {
      s.sendMessage(message, replyHandler: nil, errorHandler: nil)
    }
  }

  func pendingWorkouts() -> [[String: Any]] {
    queue.sync { (UserDefaults.standard.array(forKey: pendingKey) as? [[String: Any]]) ?? [] }
  }

  func ackWorkout(_ workoutId: String) {
    queue.sync {
      let list = (UserDefaults.standard.array(forKey: pendingKey) as? [[String: Any]]) ?? []
      UserDefaults.standard.set(list.filter { ($0["workoutId"] as? String) != workoutId }, forKey: pendingKey)
    }
  }

  private func storeWorkout(_ info: [String: Any]) {
    guard let id = info["workoutId"] as? String else { return }
    queue.sync {
      var list = (UserDefaults.standard.array(forKey: pendingKey) as? [[String: Any]]) ?? []
      if !list.contains(where: { ($0["workoutId"] as? String) == id }) {
        list.append(info)
        UserDefaults.standard.set(list, forKey: pendingKey)
      }
    }
    module?.emit("onWatchWorkout", info)
  }

  private func handle(_ message: [String: Any]) {
    switch message["kind"] as? String {
    case "command":
      if let command = message["command"] as? String {
        module?.emit("onCommand", ["command": command])
      }
    case "watchWorkout":
      storeWorkout(message)
    case "requestPhoneSession":
      module?.emit("onCommand", ["command": "sync"])
    default:
      break
    }
  }

  /// WatchConnectivity only accepts property-list values.
  private static func plistSafe(_ dict: [String: Any]) -> [String: Any] {
    dict.compactMapValues { value -> Any? in
      switch value {
      case is NSNull: return nil
      case let nested as [String: Any]: return plistSafe(nested)
      case is String, is NSNumber, is Date, is Data: return value
      default: return nil
      }
    }
  }

  // MARK: WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    module?.emit("onWatchState", watchState())
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // Switching to another paired watch: reactivate for the new one.
    session.activate()
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    module?.emit("onWatchState", watchState())
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    module?.emit("onWatchState", watchState())
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handle(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    handle(message)
    replyHandler(["ok": true])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    handle(userInfo)
  }
}
