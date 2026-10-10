// The background location task must be registered before anything else runs,
// including when the OS launches the app headlessly to deliver locations.
import './src/services/location/trackingTask';
import 'expo-router/entry';
