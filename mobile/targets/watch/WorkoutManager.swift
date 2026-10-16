import CoreLocation
import Foundation
import HealthKit
import WatchKit

/// Phone-free recording on the watch: an HKWorkoutSession keeps the app running
/// with the screen off, CoreLocation provides the route (filtered with the
/// same rules as the phone), and the finished workout is saved to Apple Health
/// together with its route. The phone then imports it like any Health workout.
@MainActor
final class WorkoutManager: NSObject, ObservableObject {
  struct Summary {
    let kind: ActivityKind
    let distanceM: Double
    let movingS: TimeInterval
    let cells: Int
    let savedToHealth: Bool
  }

  enum Phase: Equatable {
    case idle
    case starting
    case running
    case paused
    case saving
    case finished
  }

  @Published private(set) var phase: Phase = .idle
  @Published private(set) var kind: ActivityKind = .run
  @Published private(set) var distanceM = 0.0
  @Published private(set) var cells = 0
  @Published private(set) var gps: GpsQuality = .none
  @Published private(set) var summary: Summary?
  @Published var error: String?

  private let healthStore = HKHealthStore()
  private let locationManager = CLLocationManager()
  private var session: HKWorkoutSession?
  private var builder: HKLiveWorkoutBuilder?
  private var routeBuilder: HKWorkoutRouteBuilder?
  private var lastAccepted: CLLocation?
  private var lastFix: (accuracy: Double, at: Date)?
  private var estimator = CellEstimator()
  private var routePoints = 0
  private var gpsTimer: Timer?
  private var startedAt = Date.distantPast
  /// Completed kilometres (or miles) already announced with a haptic.
  private var splitsAnnounced = 0

  override init() {
    super.init()
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.activityType = .fitness
    locationManager.distanceFilter = kCLDistanceFilterNone
  }

  /// Moving time (pauses excluded), read live from the workout builder.
  func movingTime(at date: Date = Date()) -> TimeInterval {
    builder?.elapsedTime(at: date) ?? summary?.movingS ?? 0
  }

  // MARK: Control

  func start(_ kind: ActivityKind) async {
    guard phase == .idle || phase == .finished else { return }
    self.kind = kind
    phase = .starting
    error = nil
    summary = nil
    distanceM = 0
    cells = 0
    estimator = CellEstimator()
    lastAccepted = nil
    lastFix = nil
    routePoints = 0
    splitsAnnounced = 0
    do {
      try await requestAuthorization(for: kind)
      locationManager.requestWhenInUseAuthorization()

      let configuration = HKWorkoutConfiguration()
      configuration.activityType = kind.healthKitType
      configuration.locationType = .outdoor
      let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
      let builder = session.associatedWorkoutBuilder()
      builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
      session.delegate = self
      self.session = session
      self.builder = builder
      routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: nil)

      let start = Date()
      startedAt = start
      session.startActivity(with: start)
      try await builder.beginCollection(at: start)
      locationManager.startUpdatingLocation()
      startGpsTimer()
      phase = .running
    } catch {
      self.error = "Kayıt başlatılamadı: \(error.localizedDescription)"
      reset()
    }
  }

  func pause() {
    guard phase == .running else { return }
    session?.pause()
  }

  func resume() {
    guard phase == .paused else { return }
    session?.resume()
  }

  /// Ends the workout, saves it (with route) to Apple Health and tells the phone.
  func finish() async {
    guard phase == .running || phase == .paused, let session, let builder else { return }
    phase = .saving
    locationManager.stopUpdatingLocation()
    stopGpsTimer()
    let end = Date()
    session.end()
    let moving = builder.elapsedTime(at: end)
    var saved = false
    do {
      try await builder.endCollection(at: end)
      try await builder.addMetadata([
        HKMetadataKeyIndoorWorkout: false,
        "RunnerRecordedOnWatch": true,
      ])
      if let workout = try await builder.finishWorkout() {
        if routePoints > 0, let routeBuilder {
          _ = try await routeBuilder.finishRoute(with: workout, metadata: nil)
        }
        saved = true
        PhoneLink.shared.sendWorkout(
          workoutId: workout.uuid.uuidString,
          kind: kind,
          startedAt: workout.startDate,
          endedAt: workout.endDate,
          distanceM: distanceM
        )
      }
    } catch {
      self.error = "Antrenman Sağlık'a kaydedilemedi: \(error.localizedDescription)"
    }
    summary = Summary(kind: kind, distanceM: distanceM, movingS: moving, cells: cells, savedToHealth: saved)
    self.session = nil
    self.builder = nil
    routeBuilder = nil
    phase = .finished
  }

  /// Ends without saving anything.
  func discard() {
    guard phase == .running || phase == .paused else { return }
    locationManager.stopUpdatingLocation()
    session?.end()
    builder?.discardWorkout()
    routeBuilder?.discard()
    reset()
  }

  func dismissSummary() {
    summary = nil
    phase = .idle
  }

  private func reset() {
    stopGpsTimer()
    session = nil
    builder = nil
    routeBuilder = nil
    gps = .none
    phase = .idle
  }

  private func requestAuthorization(for kind: ActivityKind) async throws {
    guard HKHealthStore.isHealthDataAvailable() else {
      throw NSError(domain: "Runner", code: 1, userInfo: [NSLocalizedDescriptionKey: "Sağlık verisi bu saatte kullanılamıyor."])
    }
    let share: Set<HKSampleType> = [
      HKObjectType.workoutType(),
      HKSeriesType.workoutRoute(),
      HKQuantityType(.distanceWalkingRunning),
      HKQuantityType(.distanceCycling),
      HKQuantityType(.distanceWheelchair),
    ]
    let read: Set<HKObjectType> = [
      HKQuantityType(.distanceWalkingRunning),
      HKQuantityType(.distanceCycling),
      HKQuantityType(.distanceWheelchair),
    ]
    try await healthStore.requestAuthorization(toShare: share, read: read)
  }

  // MARK: GPS

  private func startGpsTimer() {
    gpsTimer?.invalidate()
    gpsTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
      Task { @MainActor in self?.refreshGps() }
    }
  }

  private func stopGpsTimer() {
    gpsTimer?.invalidate()
    gpsTimer = nil
  }

  private func refreshGps() {
    gps = GpsQuality.from(accuracy: lastFix?.accuracy, fixAt: lastFix?.at)
  }

  /// Same decision as evaluateFix() in src/domain/gpsFilter.ts.
  private func accept(_ fix: CLLocation) -> Bool {
    guard fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= Rules.maxAccuracyM else { return false }
    // CoreLocation first hands out its cached last location, possibly from far away.
    guard fix.timestamp >= startedAt, Date().timeIntervalSince(fix.timestamp) < Rules.maxFixAge else { return false }
    guard let last = lastAccepted else { return true }
    let dt = fix.timestamp.timeIntervalSince(last.timestamp)
    guard dt > 0 else { return false }
    let d = fix.distance(from: last)
    if d / dt > kind.jumpSpeedLimitMps { return false }
    if d < Rules.minPointSpacingM && dt < Rules.minPointInterval { return false }
    return true
  }

  fileprivate func handle(_ locations: [CLLocation]) {
    guard phase == .running else { return }
    var accepted: [CLLocation] = []
    for fix in locations {
      if fix.horizontalAccuracy >= 0 { lastFix = (fix.horizontalAccuracy, fix.timestamp) }
      guard accept(fix) else { continue }
      if let last = lastAccepted {
        distanceM += fix.distance(from: last)
        estimator.add(from: last, to: fix)
      }
      lastAccepted = fix
      accepted.append(fix)
    }
    cells = estimator.cells
    announceSplitIfNeeded()
    refreshGps()
    guard !accepted.isEmpty, let routeBuilder else { return }
    routePoints += accepted.count
    routeBuilder.insertRouteData(accepted) { _, _ in }
  }

  /// A haptic tap at every full kilometre (mile), like the phone's split feedback.
  private func announceSplitIfNeeded() {
    let unitM = Format.units == .imperial ? 1609.344 : 1000
    let splits = Int(distanceM / unitM)
    guard splits > splitsAnnounced else { return }
    splitsAnnounced = splits
    // Follows the phone's "Titreşimli geri bildirim" setting (on by default).
    if UserDefaults.standard.object(forKey: "runner.haptics") as? Bool ?? true {
      WKInterfaceDevice.current().play(.notification)
    }
  }

  fileprivate func sessionChanged(to state: HKWorkoutSessionState) {
    switch state {
    case .running:
      if phase == .paused { phase = .running }
    case .paused:
      if phase == .running {
        phase = .paused
        // No distance across a pause (separate route segment, like the phone).
        lastAccepted = nil
      }
    default:
      break
    }
  }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
    Task { @MainActor in self.sessionChanged(to: toState) }
  }

  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    Task { @MainActor in self.error = error.localizedDescription }
  }
}

extension WorkoutManager: CLLocationManagerDelegate {
  nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    Task { @MainActor in self.handle(locations) }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
