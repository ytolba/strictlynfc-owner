import type { Session } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './supabase';
import type { DashboardData, Machine, MachineDraft, MachineTag } from './types';

const API_URL = 'https://strictlyinc.com';

const authHeaders = (session: Session, json = true) => ({
  Authorization: `Bearer ${session.access_token}`,
  ...(json ? { 'Content-Type': 'application/json' } : {})
});

async function parsed<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || 'That request could not be completed.');
  return body as T;
}

export async function loadDashboard(session: Session, gymId?: string | null) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/owner_dashboard_data`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_gym_id: gymId || null })
  });
  return parsed<DashboardData>(response);
}

export async function saveMachine(session: Session, gymId: string, draft: MachineDraft) {
  const response = await fetch(`${API_URL}/api/owner/machine`, {
    method: 'POST', headers: authHeaders(session), body: JSON.stringify({ gymId, ...draft })
  });
  return parsed<{ ok: boolean; machineId: string }>(response);
}

export async function loadMachine(session: Session, gymId: string, machineId: string) {
  const response = await fetch(`${API_URL}/api/owner/machine?gymId=${encodeURIComponent(gymId)}&machineId=${encodeURIComponent(machineId)}`, {
    headers: authHeaders(session, false)
  });
  return parsed<{ machine: Machine }>(response);
}

export async function assignTag(session: Session, gymId: string, machineId: string, tag: MachineTag) {
  const response = await fetch(`${API_URL}/api/owner/tag`, {
    method: 'POST', headers: authHeaders(session), body: JSON.stringify({
      gymId, machineId, publicId: tag.publicId, labelCode: tag.labelCode, tagType: tag.type, status: tag.status
    })
  });
  return parsed<{ ok: boolean; url: string }>(response);
}

export async function uploadMachineVideo(session: Session, gymId: string, machineId: string, file: { uri: string; mimeType?: string | null }) {
  const blob = await (await fetch(file.uri)).blob();
  const response = await fetch(`${API_URL}/api/owner/video?gymId=${encodeURIComponent(gymId)}&machineId=${encodeURIComponent(machineId)}`, {
    method: 'POST', headers: { ...authHeaders(session, false), 'Content-Type': file.mimeType || 'video/mp4' }, body: blob
  });
  return parsed<{ ok: boolean; videoUrl: string }>(response);
}

export async function inviteOwner(session: Session, gymId: string, email: string, role: 'owner' | 'manager' | 'viewer') {
  const response = await fetch(`${API_URL}/api/owner/invite`, {
    method: 'POST', headers: authHeaders(session), body: JSON.stringify({ gymId, email, role })
  });
  return parsed<{ ok: boolean; message: string }>(response);
}
