import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { WorkoutSession } from './types';

// Workouts are written straight to Supabase (RLS: members can only touch their own rows).
// Called when the first tag starts a workout and again when it finishes; the upsert is idempotent.
export async function saveWorkoutToCloud(session: Session | null, workout: WorkoutSession) {
  if (!session) return false;
  const exerciseCount = new Set(workout.sets.map((set) => `${set.publicId}:${set.exerciseSlug || ''}`)).size;
  const volume = workout.sets.reduce((sum, set) => sum + set.weight * set.reps, 0);
  const { error } = await supabase.from('member_workouts').upsert({
    id: workout.id,
    user_id: session.user.id,
    gym_slug: workout.gymId,
    gym_name: workout.gymName,
    started_at: workout.startedAt,
    finished_at: workout.finishedAt ?? null,
    set_count: workout.sets.length,
    exercise_count: exerciseCount,
    volume_lb: Math.round(volume),
    sets: workout.sets.map(({ syncState, ...set }) => set)
  });
  if (error) throw new Error(error.message);
  return true;
}

export function workoutMinutes(workout: WorkoutSession) {
  return Math.max(1, Math.round((new Date(workout.finishedAt || Date.now()).getTime() - new Date(workout.startedAt).getTime()) / 60000));
}
