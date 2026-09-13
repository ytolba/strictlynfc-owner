import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from '../supabase';
import type { WorkoutSession } from './types';

// Public client ID from https://www.strava.com/settings/api. The client secret lives only in the
// `strava-token` Supabase edge function. Set the app's Authorization Callback Domain to strictlyinc.com.
export const STRAVA_CLIENT_ID = '';
const REDIRECT_URI = 'strictlyvision://strictlyinc.com/strava';
const TOKEN_KEY = 'strictlyvision.strava.tokens.v1';

type StravaTokens = { accessToken: string; refreshToken: string; expiresAt: number; athleteName?: string | null };

export const isStravaConfigured = () => STRAVA_CLIENT_ID.length > 0;

export async function loadStravaConnection() {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as StravaTokens; } catch { return null; }
}

async function saveTokens(tokens: StravaTokens) {
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(tokens));
  return tokens;
}

export async function disconnectStrava() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function exchange(session: Session | null, body: Record<string, string>): Promise<StravaTokens> {
  if (!session) throw new Error('Open your profile once so StrictlyVision can create a member session, then try again.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/strava-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Strava could not be connected.');
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at, athleteName: data.athlete?.firstname ?? null };
}

export async function connectStrava(session: Session | null) {
  if (!isStravaConfigured()) throw new Error('Strava is not configured for this build yet.');
  const params = new URLSearchParams({ client_id: STRAVA_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', approval_prompt: 'auto', scope: 'activity:write' });
  const result = await WebBrowser.openAuthSessionAsync(`https://www.strava.com/oauth/mobile/authorize?${params}`, REDIRECT_URI);
  if (result.type !== 'success') throw new Error('Strava connection was canceled.');
  const query = new URL(result.url).searchParams;
  if (query.get('error')) throw new Error('Strava access was not approved.');
  if (!query.get('scope')?.includes('activity:write')) throw new Error('Allow StrictlyVision to upload activities to finish connecting Strava.');
  const code = query.get('code');
  if (!code) throw new Error('Strava did not return an authorization code.');
  return saveTokens(await exchange(session, { grant_type: 'authorization_code', code }));
}

async function freshTokens(session: Session | null) {
  const tokens = await loadStravaConnection();
  if (!tokens) return null;
  if (tokens.expiresAt * 1000 > Date.now() + 60_000) return tokens;
  const refreshed = await exchange(session, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
  return saveTokens({ ...refreshed, athleteName: refreshed.athleteName ?? tokens.athleteName });
}

export async function uploadWorkoutToStrava(session: Session | null, workout: WorkoutSession) {
  if (!workout.finishedAt) return false;
  const tokens = await freshTokens(session);
  if (!tokens) return false;
  const elapsed = Math.max(60, Math.round((new Date(workout.finishedAt).getTime() - new Date(workout.startedAt).getTime()) / 1000));
  const exercises = [...new Set(workout.sets.map((set) => set.exerciseName || set.machineName))];
  const volume = Math.round(workout.sets.reduce((sum, set) => sum + set.weight * set.reps, 0));
  const form = new URLSearchParams({
    name: `Strength · ${workout.gymName}`,
    sport_type: 'WeightTraining',
    start_date_local: workout.startedAt,
    elapsed_time: String(elapsed),
    description: `${workout.sets.length} sets · ${exercises.length} exercises · ${volume.toLocaleString()} lb volume\n${exercises.join(', ')}\nLogged with StrictlyVision`
  });
  const response = await fetch('https://www.strava.com/api/v3/activities', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  if (!response.ok) throw new Error(`Strava upload failed (${response.status}).`);
  return true;
}
