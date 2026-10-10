import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { trackingErrorMessage } from '../../domain/trackingError';
import { emitTrackingError, ingestLocations } from './ingest';

export const LOCATION_TASK = 'runner-activity-location';

/**
 * Must be defined at module top level and imported from the app entry point,
 * so the OS can deliver locations even when no screen is mounted.
 */
TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    const message = trackingErrorMessage(error.message);
    if (message) emitTrackingError(message);
    return;
  }
  if (data?.locations?.length) {
    await ingestLocations(data.locations);
  }
});

