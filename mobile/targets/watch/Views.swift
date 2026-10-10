import SwiftUI

// MARK: Start

struct StartView: View {
  @EnvironmentObject private var workout: WorkoutManager
  @EnvironmentObject private var phone: PhoneLink

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(ActivityKind.allCases) { kind in
          Button {
            Task { await workout.start(kind) }
          } label: {
            HStack(spacing: 10) {
              Image(systemName: kind.symbol)
                .font(.title3)
                .frame(width: 28)
              Text(kind.label)
                .font(.headline)
              Spacer()
            }
            .padding(.vertical, 6)
          }
          .tint(.accentColor)
        }
        if let error = workout.error {
          Text(error)
            .font(.footnote)
            .foregroundStyle(.red)
        }
        if let stats = phone.stats {
          WeekStatsView(stats: stats)
            .padding(.top, 4)
        }
        Text(phone.reachable
          ? "Saatin GPS'iyle kaydeder. Telefonda kayıt başlatırsan saat onu gösterir."
          : "Telefon gerekmez: saatin GPS'iyle kaydeder, bitince Sağlık'a ve telefondaki Runner'a aktarılır.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .padding(.top, 4)
      }
    }
    .navigationTitle("Runner")
  }
}

struct WeekStatsView: View {
  let stats: SharedStats

  var body: some View {
    let done = Format.distance(stats.doneThisWeek())
    let target = Format.goal(stats.weekTargetM)
    VStack(alignment: .leading, spacing: 4) {
      Text("Bu hafta \(done.value) / \(target)")
        .font(.footnote)
      ProgressView(value: stats.ratio())
        .tint(.accentColor)
      Label("\(stats.cells) hücre\(stats.cellsOwned ? "" : " kazanıldı")", systemImage: "hexagon.fill")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
  }
}

// MARK: Shared metric layout

struct MetricsView: View {
  let kind: ActivityKind
  let movingS: TimeInterval
  let distanceM: Double
  let cells: Int
  let gps: GpsQuality
  let paused: Bool

  var body: some View {
    let distance = Format.distance(distanceM)
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 4) {
        Image(systemName: kind.symbol)
        Text(paused ? "Duraklatıldı" : kind.label)
        Spacer()
        Image(systemName: gps.isUsable ? "location.fill" : "location.slash")
          .foregroundStyle(gps.isUsable ? Color.green : Color.orange)
          .accessibilityLabel(gps.label)
      }
      .font(.footnote)
      .foregroundStyle(paused ? Color.orange : Color.secondary)

      Text(Format.duration(movingS))
        .font(.system(size: 40, weight: .semibold, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(paused ? Color.secondary : Color.primary)
        .minimumScaleFactor(0.6)
        .lineLimit(1)

      HStack(alignment: .firstTextBaseline, spacing: 3) {
        Text(distance.value)
          .font(.system(size: 28, weight: .semibold, design: .rounded))
          .monospacedDigit()
        Text(distance.unit)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }

      Text(Format.paceOrSpeed(distanceM: distanceM, seconds: movingS, kind: kind))
        .font(.headline)
        .monospacedDigit()

      HStack(spacing: 4) {
        Image(systemName: "hexagon.fill")
          .foregroundStyle(Color.accentColor)
        Text(cells == 0 ? "Hücre yok" : "≈ \(cells) hücre")
      }
      .font(.footnote)

      if !gps.isUsable && !paused {
        Text(gps == .none ? "GPS sinyali aranıyor" : "GPS zayıf: mesafe eksik ölçülebilir")
          .font(.caption2)
          .foregroundStyle(.orange)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct ControlsView: View {
  let paused: Bool
  let onPauseResume: () -> Void
  let onFinish: () -> Void
  var onDiscard: (() -> Void)?

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Button(action: onPauseResume) {
          Label(paused ? "Devam" : "Duraklat", systemImage: paused ? "play.fill" : "pause.fill")
            .frame(maxWidth: .infinity)
        }
        .tint(paused ? .green : .yellow)

        Button(action: onFinish) {
          Label("Bitir", systemImage: "stop.fill")
            .frame(maxWidth: .infinity)
        }
        .tint(.red)

        if let onDiscard {
          Button(role: .destructive, action: onDiscard) {
            Text("Kaydetmeden çık")
              .font(.footnote)
          }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
          .padding(.top, 6)
        }
      }
    }
  }
}

// MARK: Watch recording

struct WorkoutView: View {
  @EnvironmentObject private var workout: WorkoutManager
  @State private var page = 1
  @State private var confirmDiscard = false

  var body: some View {
    if workout.phase == .starting || workout.phase == .saving {
      ProgressView(workout.phase == .starting ? "Başlatılıyor" : "Kaydediliyor")
    } else {
      TabView(selection: $page) {
        ControlsView(
          paused: workout.phase == .paused,
          onPauseResume: { workout.phase == .paused ? workout.resume() : workout.pause() },
          onFinish: { Task { await workout.finish() } },
          onDiscard: { confirmDiscard = true }
        )
        .tag(0)

        TimelineView(.periodic(from: .now, by: 1)) { context in
          MetricsView(
            kind: workout.kind,
            movingS: workout.movingTime(at: context.date),
            distanceM: workout.distanceM,
            cells: workout.cells,
            gps: workout.gps,
            paused: workout.phase == .paused
          )
        }
        .tag(1)
      }
      .tabViewStyle(.page)
      .navigationBarBackButtonHidden(true)
      .confirmationDialog("Kayıt silinsin mi?", isPresented: $confirmDiscard) {
        Button("Sil", role: .destructive) { workout.discard() }
        Button("Vazgeç", role: .cancel) {}
      } message: {
        Text("Bu aktivite Sağlık'a ve telefona aktarılmaz.")
      }
    }
  }
}

// MARK: Phone recording mirror

struct MirrorView: View {
  @EnvironmentObject private var phone: PhoneLink
  let session: PhoneSession
  @State private var page = 1

  var body: some View {
    TabView(selection: $page) {
      VStack(spacing: 6) {
        ControlsView(
          paused: session.state == .paused,
          onPauseResume: { phone.send(command: session.state == .paused ? "resume" : "pause") },
          onFinish: { phone.send(command: "finish") }
        )
        if let error = phone.commandError {
          Text(error)
            .font(.caption2)
            .foregroundStyle(.orange)
        }
      }
      .tag(0)

      TimelineView(.periodic(from: .now, by: 1)) { context in
        VStack(alignment: .leading, spacing: 4) {
          MetricsView(
            kind: session.kind,
            movingS: session.movingTime(at: context.date),
            distanceM: session.distanceM,
            cells: session.estimatedCells,
            gps: session.gps,
            paused: session.state == .paused
          )
          Label("Telefonda kaydediliyor", systemImage: "iphone")
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
      .tag(1)
    }
    .tabViewStyle(.page)
  }
}

// MARK: Summary

struct SummaryView: View {
  @EnvironmentObject private var workout: WorkoutManager

  var body: some View {
    ScrollView {
      if let s = workout.summary {
        let distance = Format.distance(s.distanceM)
        VStack(alignment: .leading, spacing: 6) {
          Label(s.kind.label, systemImage: s.kind.symbol)
            .font(.headline)
          HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(distance.value)
              .font(.system(size: 32, weight: .semibold, design: .rounded))
            Text(distance.unit)
              .foregroundStyle(.secondary)
          }
          Text(Format.duration(s.movingS))
            .font(.title3)
            .monospacedDigit()
          Label(s.cells == 0 ? "Hücre yok" : "≈ \(s.cells) hücre", systemImage: "hexagon.fill")
            .font(.footnote)

          if s.distanceM < Rules.minClaimDistanceM {
            Text("Hücre kazanmak için en az 400 m gerekir.")
              .font(.footnote)
              .foregroundStyle(.orange)
          }
          if s.savedToHealth {
            Text("Sağlık'a kaydedildi. Telefondaki Runner'ı açınca özet gelir; kaydettiğinde hücreler sunucuda hesaplanır.")
              .font(.footnote)
              .foregroundStyle(.secondary)
          } else if let error = workout.error {
            Text(error)
              .font(.footnote)
              .foregroundStyle(.red)
          }
          Button("Tamam") { workout.dismissSummary() }
            .tint(.accentColor)
            .padding(.top, 4)
        }
      }
    }
    .navigationTitle("Özet")
  }
}
