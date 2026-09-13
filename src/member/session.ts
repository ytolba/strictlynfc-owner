import { supabase } from '../supabase';

// Guests get one anonymous Supabase account that owns their workouts. Always check the live session
// (React state can be stale inside listeners) and share a single in-flight sign-in, otherwise every tag
// tap or remount creates a new anonymous user and orphans the workouts saved under the previous one.
let pending: Promise<void> | null = null;

export function ensureMemberSession() {
  if (!pending) {
    pending = (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) return;
      const { error } = await supabase.auth.signInAnonymously();
      if (error) console.warn('Anonymous member session unavailable; continuing with local workout storage.', error.message);
    })().finally(() => { pending = null; });
  }
  return pending;
}
