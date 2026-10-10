import CoreLocation
import Foundation

/// Hexagon cell grid, identical to the phone (src/domain/hex.ts) and the server
/// (supabase/migrations/*_hex_cells.sql): flat-topped hexagons in Web Mercator,
/// axial coordinates (q, r), centre(q, r) = (1.5·s·q, √3·s·(r + q/2)), s = 130.
struct HexCell: Hashable {
  let q: Int
  let r: Int
}

enum HexGrid {
  static let size = 130.0
  private static let earthRadius = 6378137.0
  private static let sqrt3 = 3.0.squareRoot()

  static func mercator(_ c: CLLocationCoordinate2D) -> (x: Double, y: Double) {
    let lat = c.latitude * .pi / 180
    let lon = c.longitude * .pi / 180
    return (earthRadius * lon, earthRadius * log(tan(.pi / 4 + lat / 2)))
  }

  /// Postgres-compatible rounding (half away from zero).
  private static func round(_ v: Double) -> Double {
    (v < 0 ? -1 : 1) * Foundation.round(abs(v))
  }

  static func cell(at c: CLLocationCoordinate2D) -> HexCell {
    let (x, y) = mercator(c)
    let fq = (2.0 / 3.0) * x / size
    let fr = ((-1.0 / 3.0) * x + (sqrt3 / 3.0) * y) / size
    let fs = -fq - fr
    var q = round(fq)
    var r = round(fr)
    let s = round(fs)
    let dq = abs(q - fq)
    let dr = abs(r - fr)
    let ds = abs(s - fs)
    if dq > dr && dq > ds {
      q = -r - s
    } else if dr > ds {
      r = -q - s
    }
    return HexCell(q: Int(q), r: Int(r))
  }
}

/// Live, conservative estimate of route cells: a cell counts once the route
/// has run at least `minCellPathM` inside it. Loop (enclosed) cells are only
/// computed by the server, so the final result can be higher.
struct CellEstimator {
  static let minCellPathM = 30.0
  static let maxClaimCells = 300

  private var pathInCell: [HexCell: Double] = [:]
  private(set) var cells = 0

  mutating func add(from a: CLLocation, to b: CLLocation) {
    let d = b.distance(from: a)
    guard d > 0 else { return }
    // Split long segments so each piece is attributed to the right cell.
    let steps = max(1, Int((d / 10).rounded(.up)))
    for i in 0..<steps {
      let t = (Double(i) + 0.5) / Double(steps)
      let mid = CLLocationCoordinate2D(
        latitude: a.coordinate.latitude + (b.coordinate.latitude - a.coordinate.latitude) * t,
        longitude: a.coordinate.longitude + (b.coordinate.longitude - a.coordinate.longitude) * t
      )
      let cell = HexGrid.cell(at: mid)
      let before = pathInCell[cell, default: 0]
      let after = before + d / Double(steps)
      pathInCell[cell] = after
      if before < Self.minCellPathM && after >= Self.minCellPathM {
        cells = min(cells + 1, Self.maxClaimCells)
      }
    }
  }
}
