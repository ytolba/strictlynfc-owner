import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { newId } from './storage';
import type { WorkoutSession } from './types';

// Workouts are written straight to Supabase (RLS: members can only touch their own rows).
// Called when the first tag starts a workout and again when it finishes; the upsert is idempotent.
export async function saveWorkoutToCloud(session: Session | null, workout: WorkoutSession) {
  if (!session) return false;
  const exerciseCount = new Set(workout.sets.map((set) => `${set.publicId}:${set.exerciseSlug || ''}`)).size;
  const volume = workout.sets.reduce((sum, set) => sum + set.weight * set.reps, 0);
  const row = {
    id: workout.id,
    user_id: session.user.id,
    gym_slug: workout.gymId,
    gym_name: workout.gymName,
    started_at: workout.startedAt,
    finished_at: workout.finishedAt ?? null,
    set_count: workout.sets.length,
    exercise_count: exerciseCount,
    volume_lb: Math.round(volume),
    avg_heart_rate: workout.health?.avgHeartRate ?? null,
    max_heart_rate: workout.health?.maxHeartRate ?? null,
    active_calories: workout.health?.activeCalories ?? null,
    health_source: workout.health?.source ?? null,
    sets: workout.sets.map(({ syncState, ...set }) => set)
  };
  const { error } = await supabase.from('member_workouts').upsert(row);
  if (!error) return true;
  // 42501: this workout id was started under an earlier anonymous session, so RLS blocks updating it.
  // Save the finished workout under a fresh id for the current member instead of retrying forever.
  if (error.code === '42501' && workout.finishedAt) {
    const retry = await supabase.from('member_workouts').insert({ ...row, id: newId() });
    if (!retry.error) return true;
    throw new Error(retry.error.message);
  }
  throw new Error(error.message);
}

export function workoutMinutes(workout: WorkoutSession) {
  return Math.max(1, Math.round((new Date(workout.finishedAt || Date.now()).getTime() - new Date(workout.startedAt).getTime()) / 60000));
}
