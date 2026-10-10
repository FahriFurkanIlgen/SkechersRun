import SwiftUI

@main
struct RunnerWatchApp: App {
  @StateObject private var workout = WorkoutManager()
  @StateObject private var phone = PhoneLink.shared

  init() {
    PhoneLink.shared.activate()
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(workout)
        .environmentObject(phone)
    }
  }
}

/// Watch recording first (it owns the workout session); otherwise mirror a
/// phone recording if there is one; otherwise the start screen.
struct RootView: View {
  @EnvironmentObject private var workout: WorkoutManager
  @EnvironmentObject private var phone: PhoneLink

  var body: some View {
    NavigationStack {
      Group {
        switch workout.phase {
        case .finished:
          SummaryView()
        case .starting, .running, .paused, .saving:
          WorkoutView()
        case .idle:
          if let session = phone.livePhoneSession {
            MirrorView(session: session)
          } else {
            StartView()
          }
        }
      }
    }
  }
}
