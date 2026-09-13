import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { MemberMachine, MemberPreferences, WorkoutSession, WorkoutSet } from './types';

const ACTIVE_KEY = 'strictlyvision.member.active-workout.v1';
const FINISHED_KEY = 'strictlyvision.member.finished-workouts.v1';
const PREFERENCES_KEY = 'strictlyvision.member.preferences.v1';
const RECENT_KEY = 'strictlyvision.member.recent-machines.v1';

export const newId = () => Crypto.randomUUID();

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export async function loadActiveWorkout() {
  return readJson<WorkoutSession | null>(ACTIVE_KEY, null);
}

export async function saveActiveWorkout(workout: WorkoutSession | null) {
  if (!workout) return AsyncStorage.removeItem(ACTIVE_KEY);
  return AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(workout));
}

// A workout left open this long was almost certainly forgotten; a new tap starts a fresh one.
const STALE_WORKOUT_MS = 6 * 60 * 60 * 1000;

export async function ensureActiveWorkout(gymId: string, gymName: string) {
  const current = await loadActiveWorkout();
  if (current && !current.finishedAt) {
    const age = Date.now() - new Date(current.startedAt).getTime();
    if (age < STALE_WORKOUT_MS) return current;
    const lastSet = current.sets[current.sets.length - 1];
    if (lastSet) await finishActiveWorkout(new Date(new Date(lastSet.createdAt).getTime() + 60_000).toISOString());
  }
  const next: WorkoutSession = { id: newId(), gymId, gymName, startedAt: new Date().toISOString(), sets: [] };
  await saveActiveWorkout(next);
  return next;
}

export async function appendWorkoutSet(gymId: string, gymName: string, set: WorkoutSet) {
  const workout = await ensureActiveWorkout(gymId, gymName);
  const next = { ...workout, sets: [...workout.sets, set] };
  await saveActiveWorkout(next);
  return next;
}

export async function replaceWorkoutSet(clientLogId: string, update: Partial<WorkoutSet>) {
  const workout = await loadActiveWorkout();
  if (!workout) return null;
  const next = { ...workout, sets: workout.sets.map((set) => set.clientLogId === clientLogId ? { ...set, ...update } : set) };
  await saveActiveWorkout(next);
  return next;
}

export async function loadPendingWorkoutSets() {
  const active = await loadActiveWorkout();
  const finished = await readJson<WorkoutSession[]>(FINISHED_KEY, []);
  return [...(active?.sets || []), ...finished.flatMap((workout) => workout.sets)]
    .filter((set) => set.syncState === 'pending');
}

export async function markWorkoutSetSynced(clientLogId: string) {
  const active = await loadActiveWorkout();
  const finished = await readJson<WorkoutSession[]>(FINISHED_KEY, []);
  const updateSets = (sets: WorkoutSet[]) => sets.map((set) => set.clientLogId === clientLogId
    ? { ...set, syncState: 'synced' as const }
    : set);
  const writes: [string, string][] = [[FINISHED_KEY, JSON.stringify(finished.map((workout) => ({ ...workout, sets: updateSets(workout.sets) })))]];
  if (active) writes.push([ACTIVE_KEY, JSON.stringify({ ...active, sets: updateSets(active.sets) })]);
  await AsyncStorage.multiSet(writes);
}

export async function discardActiveWorkout() {
  await AsyncStorage.setItem(ACTIVE_KEY, 'null');
}

export async function finishActiveWorkout(finishedAt = new Date().toISOString()) {
  const current = await loadActiveWorkout();
  if (!current) return null;
  const finished = { ...current, finishedAt };
  const previous = await readJson<WorkoutSession[]>(FINISHED_KEY, []);
  await AsyncStorage.multiSet([
    [FINISHED_KEY, JSON.stringify([finished, ...previous].slice(0, 50))],
    [ACTIVE_KEY, 'null']
  ]);
  return finished;
}

export async function loadFinishedWorkouts() {
  return readJson<WorkoutSession[]>(FINISHED_KEY, []);
}

export async function updateFinishedWorkout(id: string, update: Partial<WorkoutSession>) {
  const finished = await readJson<WorkoutSession[]>(FINISHED_KEY, []);
  const next = finished.map((workout) => workout.id === id ? { ...workout, ...update } : workout);
  await AsyncStorage.setItem(FINISHED_KEY, JSON.stringify(next));
  return next.find((workout) => workout.id === id) ?? null;
}

export async function markWorkoutCloudSynced(id: string) {
  const finished = await readJson<WorkoutSession[]>(FINISHED_KEY, []);
  await AsyncStorage.setItem(FINISHED_KEY, JSON.stringify(finished.map((workout) => workout.id === id ? { ...workout, cloudSynced: true } : workout)));
}

export async function loadPreferences() {
  return readJson<MemberPreferences>(PREFERENCES_KEY, { favoriteGymIds: ['vault-fitness-club'], weightUnit: 'lb' });
}

export async function savePreferences(preferences: MemberPreferences) {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

export async function rememberMachine(machine: MemberMachine) {
  const previous = await readJson<MemberMachine[]>(RECENT_KEY, []);
  const next = [machine, ...previous.filter((item) => item.publicId !== machine.publicId)].slice(0, 8);
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

export async function loadRecentMachines() {
  return readJson<MemberMachine[]>(RECENT_KEY, []);
}

export async function clearMemberData() {
  await AsyncStorage.multiRemove([ACTIVE_KEY, FINISHED_KEY, PREFERENCES_KEY, RECENT_KEY]);
}
