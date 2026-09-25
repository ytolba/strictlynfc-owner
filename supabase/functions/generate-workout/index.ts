// Jev classifies the requested focus; only the selected gym's real exercises may enter a plan.
const SITE = 'https://strictlyinc.com';
const DURATION_OPTIONS = [20, 30, 45, 60, 75, 90] as const;
const SESSION_BUDGETS: Record<number, { exercises: number; workingSets: number }> = {
  20: { exercises: 3, workingSets: 6 }, 30: { exercises: 4, workingSets: 8 },
  45: { exercises: 6, workingSets: 14 }, 60: { exercises: 7, workingSets: 20 },
  75: { exercises: 8, workingSets: 24 }, 90: { exercises: 10, workingSets: 28 }
};
const INTENTS = ['full_body', 'chest', 'back', 'shoulders', 'legs', 'arms', 'push', 'pull', 'upper', 'lower', 'custom'] as const;
type Intent = typeof INTENTS[number];
type Candidate = { publicId: string; stationName: string; stationCode: string; category: string; exerciseSlug: string | null; exerciseName: string; primaryMuscles: string[]; group: string };
type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'legs' | 'arms' | 'core';
type Area = { key: string; label: string; matches: (item: Candidate) => boolean };
type Reservation = { state: string; id?: string; token?: string; gymName?: string; validUntil?: string; plan?: unknown; catalog?: unknown; retryAfterSeconds?: number };
class PlannerError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
function groupFor(name: string, category: string, muscles: string[]) {
  const movement = name.toLowerCase();
  const context = `${category} ${muscles.join(' ')}`.toLowerCase();
  // Identify the exercise before its broad catalog category: a lateral raise is not a lat
  // exercise, and a hip thrust does not become a quad exercise in a "Lower Body" category.
  if (/calf|calves/.test(movement)) return 'calves';
  if (/leg curl|hamstring|romanian deadlift|\brdl\b/.test(movement)) return 'hamstrings';
  if (/hip thrust|glute bridge|glute kickback|abductor/.test(movement)) return 'glutes';
  if (/squat|leg press|leg extension|lunge|split squat/.test(movement)) return 'quads';
  if (/rear delt|reverse pec deck|reverse fly|face pull/.test(movement)) return 'shoulders';
  if (/chest|pec|bench press|chest fly/.test(movement)) return 'chest';
  if (/shoulder|deltoid|\bdelt\b|overhead press|lateral raise|face pull|reverse fly/.test(movement)) return 'shoulders';
  if (/pulldown|pull-up|pullup|chin-up|\brow\b|back extension|rack pull|deadlift|good morning/.test(movement)) return 'back';
  if (/bicep|preacher|\bcurl\b/.test(movement)) return 'biceps';
  if (/tricep|pushdown|\bdip\b/.test(movement)) return 'triceps';
  if (/core|\bab\b|crunch|plank/.test(movement)) return 'core';
  if (/calf|calves/.test(context)) return 'calves';
  if (/hamstring/.test(context)) return 'hamstrings';
  if (/glute/.test(context)) return 'glutes';
  if (/quad/.test(context)) return 'quads';
  if (/chest|pec/.test(context)) return 'chest';
  if (/shoulder|deltoid|\bdelt\b/.test(context)) return 'shoulders';
  if (/\blat\b|\bback\b|rhomboid/.test(context)) return 'back';
  if (/bicep/.test(context)) return 'biceps';
  if (/tricep/.test(context)) return 'triceps';
  if (/core|abdominal/.test(context)) return 'core';
  return '';
}
const nameHas = (item: Candidate, pattern: RegExp) => pattern.test(item.exerciseName);
const inGroup = (group: string): Area => ({ key: group, label: group[0].toUpperCase() + group.slice(1), matches: (item) => item.group === group });
const groupAreas: Record<MuscleGroup, Area[]> = {
  // These are movement angles / major regions, not a claim that each anatomical fiber can be isolated.
  chest: [
    { key: 'upper-chest', label: 'Upper chest · incline', matches: (item) => item.group === 'chest' && nameHas(item, /incline/i) },
    { key: 'mid-chest', label: 'Mid chest · flat or fly', matches: (item) => item.group === 'chest' && nameHas(item, /flat|seated chest press|bench press|chest fly|pec deck/i) && !nameHas(item, /incline|decline|close-grip/i) },
    { key: 'lower-chest', label: 'Lower chest · decline', matches: (item) => item.group === 'chest' && nameHas(item, /decline/i) }
  ],
  back: [
    { key: 'back-width', label: 'Back width · vertical pull', matches: (item) => nameHas(item, /pulldown|pull-up|pullup|chin-up/i) },
    { key: 'back-thickness', label: 'Mid/upper back · row', matches: (item) => item.group === 'back' && nameHas(item, /row/i) },
    { key: 'posterior-chain', label: 'Lower back · posterior chain', matches: (item) => nameHas(item, /back extension|rack pull|deadlift|good morning/i) }
  ],
  shoulders: [
    { key: 'front-delts', label: 'Front shoulders · press', matches: (item) => item.group === 'shoulders' && nameHas(item, /press|front raise/i) },
    { key: 'side-delts', label: 'Side shoulders · raise', matches: (item) => nameHas(item, /lateral raise/i) },
    { key: 'rear-delts', label: 'Rear shoulders · pull', matches: (item) => nameHas(item, /face pull|rear delt|reverse fly|reverse pec deck/i) }
  ],
  legs: [
    { key: 'quads', label: 'Quads', matches: (item) => item.group === 'quads' },
    { key: 'hamstrings', label: 'Hamstrings', matches: (item) => item.group === 'hamstrings' && !nameHas(item, /back extension/i) },
    { key: 'glutes', label: 'Glutes', matches: (item) => item.group === 'glutes' || nameHas(item, /hip thrust|glute bridge/i) },
    { key: 'calves', label: 'Calves', matches: (item) => item.group === 'calves' }
  ],
  arms: [inGroup('biceps'), inGroup('triceps')],
  core: [inGroup('core')]
};
const majorAreas: Area[] = [
  inGroup('quads'),
  { key: 'back', label: 'Back · pull', matches: (item) => item.group === 'back' && nameHas(item, /pulldown|pull-up|pullup|chin-up|\brow\b/i) },
  { key: 'chest', label: 'Chest', matches: (item) => item.group === 'chest' && nameHas(item, /chest press|bench press|pec deck|chest fly/i) && !nameHas(item, /close-grip/i) },
  inGroup('hamstrings'),
  { key: 'shoulders', label: 'Shoulders · press', matches: (item) => item.group === 'shoulders' && nameHas(item, /press/i) },
  inGroup('core'),
  { key: 'glutes', label: 'Glutes', matches: (item) => item.group === 'glutes' || nameHas(item, /hip thrust/i) },
  inGroup('calves'), inGroup('biceps'), inGroup('triceps')];
function explicitGroups(focus: string): MuscleGroup[] {
  const checks: [MuscleGroup, RegExp][] = [
    ['chest', /\b(chest|pecs?|pectorals?)\b/i], ['back', /\b(back|lats?|traps?|rhomboids?)\b/i],
    ['shoulders', /\b(shoulders?|delts?|deltoids?)\b/i], ['legs', /\b(legs?|quads?|hamstrings?|glutes?|calves|calf)\b/i],
    ['arms', /\b(arms?|biceps?|triceps?)\b/i], ['core', /\b(core|abs?|abdominals?)\b/i]
  ];
  return checks.map(([group, pattern]) => ({ group, position: focus.search(pattern) }))
    .filter((match) => match.position >= 0).sort((a, b) => a.position - b.position).map((match) => match.group);
}
function interleave(...lists: Area[][]): Area[] {
  const ordered: Area[] = [];
  for (let index = 0; index < Math.max(...lists.map((list) => list.length)); index++)
    for (const list of lists) if (list[index]) ordered.push(list[index]);
  return ordered;
}
function areasFor(focus: string, intent: Intent): Area[] {
  if (/\b(full[ -]?body|whole body|all muscles?)\b/i.test(focus)) return majorAreas;
  const groups = explicitGroups(focus);
  if (groups.length) return interleave(...groups.map((group) => groupAreas[group]));
  if (intent === 'full_body') return majorAreas;
  if (intent === 'push') return interleave(groupAreas.chest, groupAreas.shoulders, [inGroup('triceps')]);
  if (intent === 'pull') return interleave(groupAreas.back, [inGroup('biceps')]);
  if (intent === 'upper') return [inGroup('chest'), inGroup('back'), inGroup('shoulders'), inGroup('biceps'), inGroup('triceps')];
  if (intent === 'lower') return [...groupAreas.legs, inGroup('core')];
  return groupAreas[intent as MuscleGroup] || majorAreas;
}
function selectExercises(areas: Area[], candidates: Candidate[], limit: number, duration: number) {
  const used = new Set<string>(), usedStations = new Set<string>();
  const selected: { item: Candidate; area: Area }[] = [], missing: string[] = [], deferred: string[] = [];
  for (const area of areas) {
    if (selected.length >= limit) { deferred.push(area.label); continue; }
    const choice = candidates.filter((item) => area.matches(item) && !used.has(`${item.publicId}:${item.exerciseSlug || ''}`))
      .sort((a, b) => {
        const setupCost = (item: Candidate) => duration <= 30 && /barbell|power rack|squat rack|deadlift|good morning/i.test(`${item.stationName} ${item.exerciseName}`) ? 1 : 0;
        return setupCost(a) - setupCost(b) || Number(usedStations.has(a.publicId)) - Number(usedStations.has(b.publicId))
          || a.exerciseName.localeCompare(b.exerciseName);
      })[0];
    if (!choice) { missing.push(area.label); continue; }
    selected.push({ item: choice, area }); used.add(`${choice.publicId}:${choice.exerciseSlug || ''}`); usedStations.add(choice.publicId);
  }
  return { selected, missing, deferred };
}
function workingSets(count: number, duration: number): number[] {
  const sets = Array(count).fill(2) as number[];
  let extra = Math.min(Math.max(SESSION_BUDGETS[duration].workingSets - count * 2, 0), count);
  for (let index = 0; index < count && extra > 0; index++, extra--) sets[index]++;
  return sets;
}
function pacingFor(duration: number, sets: number[], count: number) {
  const totalSets = sets.reduce((sum, value) => sum + value, 0);
  const estimatedMinutes = Math.ceil(5 + totalSets * 2 + Math.max(0, count - 1) * 1.5);
  return {
    totalSets, estimatedMinutes,
    emphasis: duration <= 30 ? 'Short session: fewer working sets. Make them challenging while keeping every rep controlled; stop with about 2 good reps left.'
      : 'Use controlled reps and a load that leaves about 2–3 good reps before form breaks down.',
    recovery: duration <= 30 ? 'Warm up first. Rest about 60–90 seconds on smaller lifts and longer after demanding compound lifts.'
      : 'Warm up first and rest long enough to repeat each set with good form.'
  };
}
async function rpc<T>(name: string, args: Record<string, unknown>, url: string, key: string): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', signal: AbortSignal.timeout(7000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!response.ok) throw new Error(`Planner storage failed (${response.status}).`);
  return response.json() as Promise<T>;
}
async function catalogForGym(gymId: string, url: string, key: string): Promise<Candidate[]> {
  const reservation = await rpc<Reservation>('reserve_planner_catalog', { p_gym_slug: gymId }, url, key);
  if (reservation.state === 'invalid_gym') throw new Error('Gym is not available.');
  let raw = reservation.catalog;
  if (reservation.state === 'claimed') {
    try {
      const response = await fetch(`${SITE}/api/member/gyms/${encodeURIComponent(gymId)}/exercises`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!response.ok) throw new Error('Gym catalog is unavailable.');
      const data = await response.json();
      if (!Array.isArray(data.exercises) || data.exercises.length > 5000) throw new Error('Invalid gym catalog.');
      raw = data.exercises;
      const saved = await rpc<boolean>('finish_planner_catalog', { p_gym_slug: gymId, p_token: reservation.token, p_catalog: raw }, url, key);
      if (saved !== true) throw new Error('Catalog refresh expired.');
    } catch (error) {
      if (!Array.isArray(raw) || !raw.length) throw error;
      // Continue with a recently verified stale catalog during an upstream outage.
    }
  } else if (reservation.state === 'waiting') throw new PlannerError('The gym catalog is being refreshed. Try again in a moment.', 503);
  if (!Array.isArray(raw)) throw new Error('Gym catalog is unavailable.');
  return raw.filter((row) => row && typeof row.publicId === 'string' && typeof row.exerciseName === 'string'
    && /^[a-z0-9][a-z0-9-]{2,63}$/.test(row.publicId)
    && (row.exerciseSlug == null || /^[a-z0-9][a-z0-9-]{2,79}$/.test(row.exerciseSlug)))
    .map((row): Candidate => ({
      publicId: row.publicId, stationName: String(row.stationName || row.exerciseName),
      stationCode: String(row.stationCode || ''), category: String(row.category || ''),
      exerciseSlug: row.exerciseSlug || null, exerciseName: row.exerciseName,
      primaryMuscles: Array.isArray(row.primaryMuscles) ? row.primaryMuscles.filter((value: unknown) => typeof value === 'string').slice(0, 10) : [],
      group: groupFor(row.exerciseName, row.category || '', Array.isArray(row.primaryMuscles) ? row.primaryMuscles : [])
    })).filter((row) => row.group && !/cardio|mobility/i.test(row.category));
}
async function classifyFocus(focus: string, apiKey: string): Promise<Intent> {
  const response = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state: { member_request: focus }, questions: {
      training_focus: { type: 'choice', instructions: 'Choose the strength-training focus explicitly requested. Use custom when two or more muscle groups are named. Use other for cardio, recovery, unclear, or unrelated requests.', criteria: {
        full_body: 'Balanced full-body strength', chest: 'Chest or pecs', back: 'Back or lats', shoulders: 'Shoulders or delts', legs: 'Legs generally', arms: 'Biceps and triceps',
        push: 'Chest, shoulders and triceps', pull: 'Back and biceps', upper: 'Upper body generally', lower: 'Lower body generally', custom: 'Two or more explicitly named muscle groups', other: 'Not a clear supported strength focus'
      } }, needs_professional_guidance: { type: 'noul', instructions: 'Does the member mention injury, pain, pregnancy, a medical condition, rehabilitation, or ask for medical guidance?' }
    } }) });
  if (!response.ok) throw new Error('Workout planning is temporarily unavailable.');
  const answers = (await response.json()).answers;
  if (typeof answers?.needs_professional_guidance?.noul !== 'number' || !Number.isFinite(Number(answers?.training_focus?.confidence)))
    throw new Error('Workout planning returned an incomplete result.');
  if (answers.needs_professional_guidance.noul >= 0.5) throw new PlannerError('This planner cannot tailor workouts for medical conditions.', 422);
  const intent = answers.training_focus.choice as Intent;
  if ((!INTENTS.includes(intent) || Number(answers.training_focus.confidence) < 0.55) && explicitGroups(focus).length === 0)
    throw new PlannerError('Choose a clearer strength focus, such as legs, push, pull, or full body.', 422);
  return INTENTS.includes(intent) ? intent : 'custom';
}
async function requestHash(gymId: string, focus: string, duration: number) {
  const bytes = new TextEncoder().encode(`coverage-v4|${gymId}|${focus.toLowerCase().replace(/\s+/g, ' ')}|${duration}`);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (Number(req.headers.get('content-length') || 0) > 4096) return json({ error: 'Request too large.' }, 413);
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  const url = Deno.env.get('SUPABASE_URL'), anonKey = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!token || !url || !anonKey || !serviceKey) return json({ error: 'Sign in is required to create a plan.' }, 401);
  const auth = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anonKey }, signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!auth?.ok) return json({ error: 'Your session expired. Sign in again.' }, 401);
  const user = await auth.json().catch(() => null);
  if (!user?.id || !/^[0-9a-f-]{36}$/i.test(user.id)) return json({ error: 'Your session is invalid.' }, 401);
  let body: { action?: string; gymId?: string; focus?: string; durationMinutes?: number };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400);
  const gymId = String(body.gymId || '');
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(gymId)) return json({ error: 'Choose a valid partner gym.' }, 400);
  if (body.action === 'today') {
    try { return json({ plan: await rpc<unknown>('get_planner_today', { p_user_id: user.id, p_gym_slug: gymId }, url, serviceKey) || null }); }
    catch (error) { console.error('Planner today failed', error); return json({ error: 'Could not load today’s plan.' }, 502); }
  }
  if (body.action && body.action !== 'generate') return json({ error: 'Unknown action.' }, 400);
  const focus = String(body.focus || '').trim().slice(0, 160), duration = Number(body.durationMinutes);
  if (focus.length < 2 || !DURATION_OPTIONS.includes(duration as typeof DURATION_OPTIONS[number])) return json({ error: 'Choose a training focus and an available time.' }, 400);
  if (/pain|injur|rehab|pregnan|surgery|medical|arthritis|disabilit|concussion/i.test(focus))
    return json({ error: 'This planner does not tailor workouts for medical conditions or injuries. Please check with a qualified professional.' }, 422);
  const apiKey = Deno.env.get('TYPESAFE_API_KEY');
  if (!apiKey) return json({ error: 'Workout planning is not configured yet.' }, 503);
  let reservation: Reservation | null = null;
  try {
    reservation = await rpc<Reservation>('reserve_planner_request', { p_user_id: user.id, p_gym_slug: gymId, p_request_hash: await requestHash(gymId, focus, duration) }, url, serviceKey);
    if (reservation?.state === 'invalid_gym') return json({ error: 'That gym is not available.' }, 404);
    if (reservation?.state === 'invalid_request') return json({ error: 'Invalid plan request.' }, 400);
    if (reservation?.state === 'quota') return json({ error: 'You have reached today’s plan limit. Your existing plan is still available.' }, 429);
    if (reservation?.state === 'pending') return json({ pending: true, retryAfterSeconds: reservation.retryAfterSeconds || 3 }, 202);
    if (reservation?.state === 'ready') return json({ plan: reservation.plan });
    if (reservation?.state !== 'reserved' || !reservation.id || !reservation.token) throw new Error('Could not reserve this plan.');
    const candidates = await catalogForGym(gymId, url, serviceKey);
    if (!candidates.length) throw new PlannerError('This gym has no strength exercises ready for planning.', 422);
    const intent = await classifyFocus(focus, apiKey);
    const areas = areasFor(focus, intent);
    const { selected, missing, deferred } = selectExercises(areas, candidates, SESSION_BUDGETS[duration].exercises, duration);
    if (selected.length < 1) throw new PlannerError('There are no matching stations at this gym for that focus.', 422);
    const sets = workingSets(selected.length, duration);
    const pacing = pacingFor(duration, sets, selected.length);
    const plan = { gymId, gymName: reservation.gymName, createdAt: new Date().toISOString(), validUntil: reservation.validUntil,
      focus, intent, durationMinutes: duration, pacing, coverage: { covered: selected.map(({ area }) => area.label), deferred, missing }, exercises: selected.map(({ item, area }, index) => ({
        publicId: item.publicId, exerciseSlug: item.exerciseSlug, name: item.exerciseName, stationName: item.stationName,
        stationCode: item.stationCode, primaryMuscles: item.primaryMuscles, targetArea: area.label, sets: sets[index], reps: item.group === 'core' ? '10–15' : '8–12'
      })) };
    const committed = await rpc<boolean>('finish_planner_request', { p_id: reservation.id, p_user_id: user.id, p_token: reservation.token, p_plan: plan, p_success: true }, url, serviceKey);
    if (committed !== true) throw new Error('Plan reservation expired. Please try again.');
    return json({ plan });
  } catch (error) {
    if (reservation?.state === 'reserved' && reservation.id && reservation.token)
      await rpc<boolean>('finish_planner_request', { p_id: reservation.id, p_user_id: user.id, p_token: reservation.token, p_plan: null, p_success: false }, url, serviceKey).catch(() => {});
    const message = error instanceof Error ? error.message : 'Could not build this workout right now.';
    console.error('generate-workout failed', message);
    return json({ error: message }, error instanceof PlannerError ? error.status : 502);
  }
}
if (Deno.env.get('WORKOUT_PLANNER_TEST') !== '1') Deno.serve(handleRequest);
