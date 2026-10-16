import ExpoModulesCore
import MapKit

/**
 * Street routes from Apple Maps (no API key). The smart route builds a loop
 * from a few waypoints; each leg is routed here so the suggestion follows
 * walkable streets instead of crossing water or buildings.
 */
public class RunnerDirectionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RunnerDirections")

    /// Route through `waypoints` ([[lat, lng], …]) in order. Resolves the
    /// polyline as [[lat, lng], …] and its length in meters, or null when a
    /// leg has no route (e.g. a waypoint in open water far from any path).
    AsyncFunction("route") { (waypoints: [[Double]], mode: String, promise: Promise) in
      let points = waypoints.compactMap { $0.count >= 2 ? CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) : nil }
      guard points.count >= 2 else {
        promise.resolve(nil)
        return
      }
      Task {
        var line: [[Double]] = []
        var distance: Double = 0
        for i in 1..<points.count {
          let request = MKDirections.Request()
          request.source = MKMapItem(placemark: MKPlacemark(coordinate: points[i - 1]))
          request.destination = MKMapItem(placemark: MKPlacemark(coordinate: points[i]))
          // Cycling directions need iOS 17+ in some regions; walking is the safe default.
          request.transportType = .walking
          if mode == "cycling", #available(iOS 17.0, *) {
            request.transportType = .cycling
          }
          do {
            let response = try await MKDirections(request: request).calculate()
            guard let route = response.routes.first else {
              promise.resolve(nil)
              return
            }
            distance += route.distance
            let poly = route.polyline
            var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: poly.pointCount)
            poly.getCoordinates(&coords, range: NSRange(location: 0, length: poly.pointCount))
            for (k, c) in coords.enumerated() where !(k == 0 && !line.isEmpty) {
              line.append([c.latitude, c.longitude])
            }
          } catch {
            promise.resolve(nil)
            return
          }
        }
        promise.resolve(["points": line, "distanceM": distance])
      }
    }
  }
}
