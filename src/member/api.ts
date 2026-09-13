import type { Session } from '@supabase/supabase-js';
import type { MachineHistoryItem, MemberMachine, PartnerGym, WorkoutSet } from './types';
import { VAULT_GYM } from './vaultCatalog';

const API_URL = 'https://strictlyinc.com';

async function parsed<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || 'That request could not be completed.');
  return body as T;
}

const memberHeaders = (session: Session | null, json = true) => ({
  ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  ...(json ? { 'Content-Type': 'application/json' } : {})
});

export function machineLinkFromUrl(raw: string) {
  try {
    const url = new URL(raw);
    const tag = url.pathname.match(/^\/t\/([a-z0-9][a-z0-9-]{2,63})\/?$/i);
    if (tag?.[1]) return { publicId: tag[1].toLowerCase(), exerciseSlug: url.searchParams.get('exercise') || undefined };
    const vault = url.pathname.match(/^\/vaultclub\/([a-z0-9][a-z0-9-]{1,63})\/?$/i);
    if (vault?.[1]) return { publicId: vault[1].toLowerCase(), exerciseSlug: url.searchParams.get('exercise') || undefined };
  } catch {
    if (/^[a-z0-9][a-z0-9-]{1,63}$/i.test(raw.trim())) return { publicId: raw.trim().toLowerCase() };
  }
  return null;
}

export async function resolveMachine(publicId: string, exerciseSlug?: string | null) {
  const query = exerciseSlug ? `?exercise=${encodeURIComponent(exerciseSlug)}` : '';
  const response = await fetch(`${API_URL}/api/nfc/resolve/${encodeURIComponent(publicId)}${query}`);
  const data = await parsed<{ machine: MemberMachine }>(response);
  if (data.machine.videoUrl?.startsWith('/')) data.machine.videoUrl = `${API_URL}${data.machine.videoUrl}`;
  return data.machine;
}

export async function recordTap(publicId: string, sessionId: string, session: Session | null) {
  const response = await fetch(`${API_URL}/api/nfc/tap`, {
    method: 'POST', headers: memberHeaders(session), body: JSON.stringify({ tagId: publicId, sessionId })
  });
  if (!response.ok && response.status !== 204) throw new Error('The machine opened, but the tap could not be counted.');
}

export async function recordSet(set: WorkoutSet, sessionId: string, session: Session | null) {
  const response = await fetch(`${API_URL}/api/nfc/set`, {
    method: 'POST',
    headers: memberHeaders(session),
    body: JSON.stringify({
      tagId: set.publicId,
      exerciseSlug: set.exerciseSlug || '',
      sessionId,
      clientLogId: set.clientLogId,
      workoutSessionId: set.workoutSessionId || null,
      weight: set.weight,
      reps: set.reps,
      seatSetting: set.seatSetting || '',
      notes: set.notes || '',
      createdAt: set.createdAt
    })
  });
  return parsed<{ saved: boolean }>(response);
}

export async function startOrResumeWorkout(session: Session | null, workout: { id: string; gymId: string; startedAt: string }) {
  if (!session) return null;
  const response = await fetch(`${API_URL}/api/member/workout`, {
    method: 'POST', headers: memberHeaders(session), body: JSON.stringify({
      action: 'start', clientSessionId: workout.id, gymId: workout.gymId, startedAt: workout.startedAt
    })
  });
  return parsed<{ workoutId: string }>(response);
}

export async function finishMemberWorkout(session: Session | null, clientSessionId: string, finishedAt: string) {
  if (!session) return null;
  const response = await fetch(`${API_URL}/api/member/workout`, {
    method: 'POST', headers: memberHeaders(session), body: JSON.stringify({ action: 'finish', clientSessionId, finishedAt })
  });
  return parsed<{ ok: boolean }>(response);
}

export async function loadHistory(publicId: string, sessionId: string, session: Session | null, exerciseSlug?: string | null) {
  const query = new URLSearchParams({ tagId: publicId, sessionId });
  if (exerciseSlug) query.set('exercise', exerciseSlug);
  const response = await fetch(`${API_URL}/api/nfc/history?${query}`, { headers: memberHeaders(session, false) });
  const result = await parsed<{ history: MachineHistoryItem[] }>(response);
  return result.history;
}

export async function loadPartnerGyms(): Promise<PartnerGym[]> {
  try {
    const response = await fetch(`${API_URL}/api/member/gyms`);
    const data = await parsed<{ gyms: PartnerGym[] }>(response);
    return data.gyms.length ? data.gyms : [VAULT_GYM];
  } catch {
    return [VAULT_GYM];
  }
}

export async function exportMemberData(session: Session) {
  const response = await fetch(`${API_URL}/api/member/export`, { headers: memberHeaders(session, false) });
  return parsed<{ downloadUrl?: string; data?: unknown }>(response);
}

export async function deleteMemberAccount(session: Session) {
  const response = await fetch(`${API_URL}/api/member/account`, {
    method: 'DELETE', headers: memberHeaders(session, false)
  });
  return parsed<{ ok: boolean }>(response);
}
