import { Platform } from 'react-native';
import type { WorkoutHealthStats, WorkoutSession } from './types';

// iPhone reads Apple Health; Android reads Health Connect. Both modules load lazily so a platform
// never imports the other's native code.
type HealthKitModule = typeof import('@kingstinct/react-native-healthkit');
type HealthConnectModule = typeof import('react-native-health-connect');
let healthKitCache: HealthKitModule | null | undefined;
let healthConnectCache: HealthConnectModule | null | undefined;

function healthKit(): HealthKitModule | null {
  if (Platform.OS !== 'ios') return null;
  if (healthKitCache !== undefined) return healthKitCache;
  try { healthKitCache = require('@kingstinct/react-native-healthkit') as HealthKitModule; }
  catch { healthKitCache = null; }
  return healthKitCache;
}

function healthConnect(): HealthConnectModule | null {
  if (Platform.OS !== 'android') return null;
  if (healthConnectCache !== undefined) return healthConnectCache;
  try { healthConnectCache = require('react-native-health-connect') as HealthConnectModule; }
  catch { healthConnectCache = null; }
  return healthConnectCache;
}

export const healthProviderName = () => Platform.OS === 'android' ? 'Health Connect' : 'Apple Health';

export function isHealthKitSupported() {
  if (Platform.OS === 'android') return !!healthConnect();
  const kit = healthKit();
  if (!kit) return false;
  try { return kit.isHealthDataAvailable(); } catch { return false; }
}

type Range = { startDate: Date; endDate: Date };
const rounded = (value?: number) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
const SESSION_PADDING_MS = 30 * 60 * 1000;

// A watch workout that covers most of the gym session samples heart rate every few seconds, so when one
// exists we measure over its window and skip saving a duplicate workout.
function bestOverlap<T>(session: Range, candidates: { item: T; range: Range }[]) {
  const sessionMs = Math.max(1, session.endDate.getTime() - session.startDate.getTime());
  let best: { item: T; range: Range; overlap: number } | null = null;
  for (const candidate of candidates) {
    const overlap = Math.min(session.endDate.getTime(), candidate.range.endDate.getTime()) - Math.max(session.startDate.getTime(), candidate.range.startDate.getTime());
    if (overlap / sessionMs < 0.5) continue;
    if (!best || overlap > best.overlap) best = { ...candidate, overlap };
  }
  return best;
}

/* ------------------------------ Apple Health ------------------------------ */

const HEART_RATE = 'HKQuantityTypeIdentifierHeartRate' as const;
const ACTIVE_ENERGY = 'HKQuantityTypeIdentifierActiveEnergyBurned' as const;

async function requestAppleHealth(kit: HealthKitModule) {
  if (!kit.isHealthDataAvailable()) throw new Error('Apple Health is not available on this device.');
  return kit.requestAuthorization({ toShare: ['HKWorkoutTypeIdentifier'], toRead: ['HKWorkoutTypeIdentifier', HEART_RATE, ACTIVE_ENERGY] });
}

async function readAppleHealthStats(kit: HealthKitModule, session: Range): Promise<WorkoutHealthStats | null> {
  // Safe to repeat: iOS only prompts for types the member hasn't answered yet.
  await requestAppleHealth(kit).catch(() => undefined);
  const candidates = await kit.queryWorkoutSamples({
    limit: 20,
    filter: { date: { startDate: new Date(session.startDate.getTime() - SESSION_PADDING_MS), endDate: new Date(session.endDate.getTime() + SESSION_PADDING_MS) } }
  }).catch(() => []);
  const watch = bestOverlap(session, candidates
    .filter((workout) => workout.sourceRevision?.productType?.startsWith('Watch'))
    .map((workout) => ({ item: workout, range: { startDate: workout.startDate, endDate: workout.endDate } })));
  const range = watch?.range ?? session;

  const [heartRate, energy] = await Promise.all([
    kit.queryStatisticsForQuantity(HEART_RATE, ['discreteAverage', 'discreteMax'], { unit: 'count/min', filter: { date: range } }).catch(() => null),
    kit.queryStatisticsForQuantity(ACTIVE_ENERGY, ['cumulativeSum'], { unit: 'kcal', filter: { date: range } }).catch(() => null)
  ]);
  return {
    avgHeartRate: rounded(heartRate?.averageQuantity?.quantity),
    maxHeartRate: rounded(heartRate?.maximumQuantity?.quantity),
    activeCalories: rounded(energy?.sumQuantity?.quantity),
    source: watch ? 'watch_workout' : 'health_samples'
  };
}

/* ----------------------------- Health Connect ----------------------------- */

const ANDROID_PACKAGE = 'com.strictlyinc.strictlyvision';
// Health Connect Device.type values for wearables: watch, ring, fitness band, chest strap.
const WEARABLE_DEVICE_TYPES = [1, 4, 6, 7];
const STRENGTH_TRAINING = 70;
const HEALTH_CONNECT_PERMISSIONS = [
  { accessType: 'read', recordType: 'HeartRate' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'ExerciseSession' },
  { accessType: 'write', recordType: 'ExerciseSession' }
] as const;

async function readyHealthConnect() {
  const hc = healthConnect();
  if (!hc) return null;
  const status = await hc.getSdkStatus();
  if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return null;
  await hc.initialize();
  return hc;
}

async function grantedHealthConnect(hc: HealthConnectModule) {
  const granted = await hc.getGrantedPermissions();
  return (accessType: 'read' | 'write', recordType: string) => granted.some((permission) => permission.accessType === accessType && permission.recordType === recordType);
}

async function requestHealthConnect() {
  const hc = await readyHealthConnect();
  if (!hc) throw new Error('Install or update Health Connect from Google Play, then try again.');
  const granted = await hc.requestPermission([...HEALTH_CONNECT_PERMISSIONS]);
  if (!granted.some((permission) => permission.recordType === 'HeartRate' || permission.recordType === 'ActiveCaloriesBurned')) {
    throw new Error('Allow heart rate or calories in Health Connect to add them to your workouts.');
  }
  return true;
}

async function readHealthConnectStats(session: Range): Promise<WorkoutHealthStats | null> {
  const hc = await readyHealthConnect();
  if (!hc) return null;
  // Never open the permission sheet at Finish on Android; use what the member already granted.
  const can = await grantedHealthConnect(hc);

  let watch: ReturnType<typeof bestOverlap<unknown>> = null;
  if (can('read', 'ExerciseSession')) {
    const result = await hc.readRecords('ExerciseSession', {
      timeRangeFilter: { operator: 'between', startTime: new Date(session.startDate.getTime() - SESSION_PADDING_MS).toISOString(), endTime: new Date(session.endDate.getTime() + SESSION_PADDING_MS).toISOString() }
    }).catch(() => null);
    watch = bestOverlap(session, (result?.records ?? [])
      .filter((record) => record.metadata?.dataOrigin !== ANDROID_PACKAGE && WEARABLE_DEVICE_TYPES.includes(Number(record.metadata?.device?.type ?? -1)))
      .map((record) => ({ item: record as unknown, range: { startDate: new Date(record.startTime), endDate: new Date(record.endTime) } })));
  }
  const range = watch?.range ?? session;
  const timeRangeFilter = { operator: 'between' as const, startTime: range.startDate.toISOString(), endTime: range.endDate.toISOString() };

  const [heartRate, energy] = await Promise.all([
    can('read', 'HeartRate') ? hc.aggregateRecord({ recordType: 'HeartRate', timeRangeFilter }).catch(() => null) : null,
    can('read', 'ActiveCaloriesBurned') ? hc.aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter }).catch(() => null) : null
  ]);
  const measured = !!heartRate?.MEASUREMENTS_COUNT;
  return {
    avgHeartRate: measured ? rounded(heartRate?.BPM_AVG) : null,
    maxHeartRate: measured ? rounded(heartRate?.BPM_MAX) : null,
    activeCalories: rounded(energy?.ACTIVE_CALORIES_TOTAL?.inKilocalories),
    source: watch ? 'watch_workout' : 'health_samples'
  };
}

/* --------------------------------- Shared --------------------------------- */

export async function requestHealthKitAccess() {
  if (Platform.OS === 'android') return requestHealthConnect();
  const kit = healthKit();
  if (!kit) throw new Error('Apple Health is not available on this device.');
  return requestAppleHealth(kit);
}

export async function readWorkoutHealthStats(workout: WorkoutSession): Promise<WorkoutHealthStats | null> {
  if (!workout.finishedAt) return null;
  const session: Range = { startDate: new Date(workout.startedAt), endDate: new Date(workout.finishedAt) };
  let stats: WorkoutHealthStats | null = null;
  if (Platform.OS === 'android') stats = await readHealthConnectStats(session);
  else {
    const kit = healthKit();
    if (kit?.isHealthDataAvailable()) stats = await readAppleHealthStats(kit, session);
  }
  if (!stats || (stats.avgHeartRate === null && stats.maxHeartRate === null && !stats.activeCalories)) return null;
  return stats;
}

export async function saveWorkoutToHealth(workout: WorkoutSession): Promise<'saved' | 'matched' | false> {
  if (!workout.finishedAt) return false;
  if (workout.health?.source === 'watch_workout') return 'matched';

  if (Platform.OS === 'android') {
    const hc = await readyHealthConnect();
    if (!hc) return false;
    const can = await grantedHealthConnect(hc);
    if (!can('write', 'ExerciseSession')) return false;
    await hc.insertRecords([{
      recordType: 'ExerciseSession',
      exerciseType: STRENGTH_TRAINING,
      title: `Strength · ${workout.gymName}`,
      startTime: workout.startedAt,
      endTime: workout.finishedAt,
      metadata: { clientRecordId: workout.id }
    }]);
    return 'saved';
  }

  const kit = healthKit();
  if (!kit) return false;
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
