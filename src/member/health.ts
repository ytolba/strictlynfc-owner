import { Platform } from 'react-native';
import type { WorkoutSession } from './types';

// Loaded lazily so Android and simulators without the native module never crash on import.
type HealthKitModule = typeof import('@kingstinct/react-native-healthkit');
let cached: HealthKitModule | null | undefined;

function healthKit(): HealthKitModule | null {
  if (Platform.OS !== 'ios') return null;
  if (cached !== undefined) return cached;
  try { cached = require('@kingstinct/react-native-healthkit') as HealthKitModule; }
  catch { cached = null; }
  return cached;
}

export function isHealthKitSupported() {
  const kit = healthKit();
  if (!kit) return false;
  try { return kit.isHealthDataAvailable(); } catch { return false; }
}

export async function requestHealthKitAccess() {
  const kit = healthKit();
  if (!kit || !kit.isHealthDataAvailable()) throw new Error('Apple Health is not available on this device.');
  return kit.requestAuthorization({ toShare: ['HKWorkoutTypeIdentifier'], toRead: ['HKWorkoutTypeIdentifier'] });
}

export async function saveWorkoutToHealth(workout: WorkoutSession) {
  const kit = healthKit();
  if (!kit || !workout.finishedAt) return false;
  await kit.saveWorkoutSample(
    kit.WorkoutActivityType.traditionalStrengthTraining,
    [],
    new Date(workout.startedAt),
    new Date(workout.finishedAt),
    undefined,
    { HKExternalUUID: workout.id, StrictlyVisionGym: workout.gymName }
  );
  return true;
}
