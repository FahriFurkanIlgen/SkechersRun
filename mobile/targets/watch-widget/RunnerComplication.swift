import SwiftUI
import WidgetKit

/// Watch face complication / Smart Stack widget: weekly goal ring and cell count.
/// Data comes from the phone via the watch app (SharedStats in the App Group).
struct StatsEntry: TimelineEntry {
  let date: Date
  let stats: SharedStats?
}

struct StatsProvider: TimelineProvider {
  func placeholder(in context: Context) -> StatsEntry {
    StatsEntry(date: Date(), stats: SharedStats(["weekDoneM": 12_400, "weekTargetM": 25_000, "cells": 84, "cellsOwned": true, "weekStartMs": Date().timeIntervalSince1970 * 1000]))
  }

  func getSnapshot(in context: Context, completion: @escaping (StatsEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : StatsEntry(date: Date(), stats: SharedStats.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<StatsEntry>) -> Void) {
    let now = Date()
    var entries = [StatsEntry(date: now, stats: SharedStats.load())]
    // One more entry at the start of next week so the ring resets even without new data.
    if let stats = entries[0].stats {
      let nextWeek = Date(timeIntervalSince1970: (stats.weekStartMs + 7 * 86_400_000) / 1000)
      if nextWeek > now { entries.append(StatsEntry(date: nextWeek, stats: stats)) }
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

private func km(_ m: Double) -> String {
  let v = m / 1000
  return (v >= 10 ? String(format: "%.0f", v) : String(format: "%.1f", v)).replacingOccurrences(of: ".", with: ",")
}

struct ComplicationView: View {
  @Environment(\.widgetFamily) private var family
  let entry: StatsEntry

  var body: some View {
    if let s = entry.stats {
      content(s)
    } else {
      switch family {
      case .accessoryInline:
        Text("Runner")
      case .accessoryRectangular:
        VStack(alignment: .leading) {
          Text("Runner").font(.headline)
          Text("Telefondaki Runner'ı aç").font(.caption2)
        }
      default:
        Image(systemName: "hexagon.fill")
      }
    }
  }

  @ViewBuilder
  private func content(_ s: SharedStats) -> some View {
    let done = s.doneThisWeek(now: entry.date)
    let progress = s.isMinutes
      ? "\(SharedStats.minutesText(done)) / \(SharedStats.minutesText(s.weekTargetM))"
      : "\(km(done)) / \(km(s.weekTargetM)) km"
    switch family {
    case .accessoryCircular:
      Gauge(value: s.ratio(now: entry.date)) {
        Image(systemName: "hexagon.fill")
      } currentValueLabel: {
        Text("\(s.cells)")
      }
      .gaugeStyle(.accessoryCircularCapacity)
      .tint(.accentColor)
    case .accessoryCorner:
      Text("\(s.cells)")
        .widgetCurvesContent()
        .widgetLabel {
          Gauge(value: s.ratio(now: entry.date)) { Text("hafta") }
            .tint(.accentColor)
        }
    case .accessoryInline:
      Text("⬢ \(s.cells) · \(progress)")
    default:
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 4) {
          Image(systemName: "hexagon.fill").foregroundStyle(Color.accentColor)
          Text("\(s.cells) hücre").font(.headline)
        }
        Text("Bu hafta \(progress)")
          .font(.caption2)
        ProgressView(value: s.ratio(now: entry.date))
          .tint(.accentColor)
      }
    }
  }
}

@main
struct RunnerComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "RunnerComplication", provider: StatsProvider()) { entry in
      ComplicationView(entry: entry)
        .containerBackground(.clear, for: .widget)
    }
    .configurationDisplayName("Runner")
    .description("Haftalık hedefin ve hücrelerin.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
  }
}
