import { Platform } from 'react-native';
import type { WorkoutHealthStats, WorkoutSession } from './types';

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

const HEART_RATE = 'HKQuantityTypeIdentifierHeartRate' as const;
const ACTIVE_ENERGY = 'HKQuantityTypeIdentifierActiveEnergyBurned' as const;

export function isHealthKitSupported() {
  const kit = healthKit();
  if (!kit) return false;
  try { return kit.isHealthDataAvailable(); } catch { return false; }
}

// Safe to call repeatedly: iOS only prompts for types the member hasn't answered yet.
export async function requestHealthKitAccess() {
  const kit = healthKit();
  if (!kit || !kit.isHealthDataAvailable()) throw new Error('Apple Health is not available on this device.');
  return kit.requestAuthorization({
    toShare: ['HKWorkoutTypeIdentifier'],
    toRead: ['HKWorkoutTypeIdentifier', HEART_RATE, ACTIVE_ENERGY]
  });
}

type Range = { startDate: Date; endDate: Date };

// An Apple Watch workout that covers most of the gym session records heart rate every few seconds,
// so when one exists we measure over its window and skip saving a duplicate workout to Health.
async function findWatchWorkout(kit: HealthKitModule, session: Range) {
  const padding = 30 * 60 * 1000;
  const candidates = await kit.queryWorkoutSamples({
    limit: 20,
    filter: { date: { startDate: new Date(session.startDate.getTime() - padding), endDate: new Date(session.endDate.getTime() + padding) } }
  });
  const sessionMs = Math.max(1, session.endDate.getTime() - session.startDate.getTime());
  let best: { range: Range; overlap: number } | null = null;
  for (const workout of candidates) {
    if (!workout.sourceRevision?.productType?.startsWith('Watch')) continue;
    const overlap = Math.min(session.endDate.getTime(), workout.endDate.getTime()) - Math.max(session.startDate.getTime(), workout.startDate.getTime());
    if (overlap / sessionMs < 0.5) continue;
    if (!best || overlap > best.overlap) best = { range: { startDate: workout.startDate, endDate: workout.endDate }, overlap };
  }
  return best?.range ?? null;
}

const rounded = (value?: number) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

export async function readWorkoutHealthStats(workout: WorkoutSession): Promise<WorkoutHealthStats | null> {
  const kit = healthKit();
  if (!kit || !workout.finishedAt || !kit.isHealthDataAvailable()) return null;
  await requestHealthKitAccess().catch(() => undefined);

  const session: Range = { startDate: new Date(workout.startedAt), endDate: new Date(workout.finishedAt) };
  const watch = await findWatchWorkout(kit, session).catch(() => null);
  const range = watch ?? session;

  const [heartRate, energy] = await Promise.all([
    kit.queryStatisticsForQuantity(HEART_RATE, ['discreteAverage', 'discreteMax'], { unit: 'count/min', filter: { date: range } }).catch(() => null),
    kit.queryStatisticsForQuantity(ACTIVE_ENERGY, ['cumulativeSum'], { unit: 'kcal', filter: { date: range } }).catch(() => null)
  ]);

  const stats: WorkoutHealthStats = {
    avgHeartRate: rounded(heartRate?.averageQuantity?.quantity),
    maxHeartRate: rounded(heartRate?.maximumQuantity?.quantity),
    activeCalories: rounded(energy?.sumQuantity?.quantity),
    source: watch ? 'watch_workout' : 'health_samples'
  };
  if (stats.avgHeartRate === null && stats.maxHeartRate === null && !stats.activeCalories) return null;
  return stats;
}

export async function saveWorkoutToHealth(workout: WorkoutSession): Promise<'saved' | 'matched' | false> {
  const kit = healthKit();
  if (!kit || !workout.finishedAt) return false;
  if (workout.health?.source === 'watch_workout') return 'matched';
  await kit.saveWorkoutSample(
    kit.WorkoutActivityType.traditionalStrengthTraining,
    [],
    new Date(workout.startedAt),
    new Date(workout.finishedAt),
    workout.health?.activeCalories ? { energyBurned: workout.health.activeCalories } : undefined,
    { HKExternalUUID: workout.id, StrictlyVisionGym: workout.gymName }
  );
  return 'saved';
}
