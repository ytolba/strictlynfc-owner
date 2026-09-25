Deno.env.set('WORKOUT_PLANNER_TEST', '1');
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'test-publishable-key');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
Deno.env.set('TYPESAFE_API_KEY', 'test-typesafe-key');
const { handleRequest } = await import('./index.ts');
const originalFetch = globalThis.fetch;
type PlannedItem = { publicId: string; exerciseSlug: string | null; targetArea: string; name: string; sets: number };
const userId = '00000000-0000-4000-8000-000000000001';
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const request = (focus: string, action = 'generate', durationMinutes = 60) => new Request('https://example.supabase.co/functions/v1/generate-workout', {
  method: 'POST', headers: { Authorization: 'Bearer test-member-token' },
  body: JSON.stringify({ action, gymId: 'vault-fitness-club', focus, durationMinutes })
});
const catalog = [
  { publicId: 'powerrack', stationName: 'Power Rack', stationCode: '27', category: 'Lower Body', exerciseSlug: 'back-squat', exerciseName: 'Back Squat', primaryMuscles: ['Quads'] },
  { publicId: 'powerrack', stationName: 'Power Rack', stationCode: '27', category: 'Chest', exerciseSlug: 'barbell-bench-press', exerciseName: 'Barbell Bench Press', primaryMuscles: ['Chest'] },
  { publicId: 'powerrack', stationName: 'Power Rack', stationCode: '27', category: 'Back', exerciseSlug: 'barbell-row', exerciseName: 'Barbell Row', primaryMuscles: ['Lats'] },
  { publicId: 'incline-press', stationName: 'Incline Chest Press', stationCode: '01', category: 'Chest', exerciseSlug: null, exerciseName: 'Incline Chest Press', primaryMuscles: ['Chest'] },
  { publicId: 'decline-press', stationName: 'Decline Chest Press', stationCode: '02', category: 'Chest', exerciseSlug: null, exerciseName: 'Decline Chest Press', primaryMuscles: ['Chest'] },
  { publicId: 'assisted-dip', stationName: 'Assisted Dip', stationCode: '36', category: 'Chest', exerciseSlug: null, exerciseName: 'Assisted Dip', primaryMuscles: ['Chest', 'Triceps'] },
  { publicId: 'lat-pulldown', stationName: 'Lat Pulldown', stationCode: '03', category: 'Back', exerciseSlug: null, exerciseName: 'Lat Pulldown', primaryMuscles: ['Lats'] },
  { publicId: 'back-extension', stationName: 'Back Extension', stationCode: '04', category: 'Posterior Chain', exerciseSlug: null, exerciseName: '45-Degree Back Extension', primaryMuscles: ['Hamstrings', 'Glutes'] },
  { publicId: 'leg-curl', stationName: 'Leg Curl', stationCode: '16', category: 'Lower Body', exerciseSlug: null, exerciseName: 'Leg Curl', primaryMuscles: ['Hamstrings'] },
  { publicId: 'shoulder-press', stationName: 'Shoulder Press', stationCode: '11', category: 'Shoulders', exerciseSlug: null, exerciseName: 'Shoulder Press', primaryMuscles: ['Shoulders'] },
  { publicId: 'lateral-raise', stationName: 'Lateral Raise', stationCode: '12', category: 'Shoulders', exerciseSlug: null, exerciseName: 'Lateral Raise', primaryMuscles: ['Side Delts'] },
  { publicId: 'rear-delt', stationName: 'Reverse Pec Deck', stationCode: '13', category: 'Shoulders', exerciseSlug: null, exerciseName: 'Reverse Pec Deck', primaryMuscles: ['Rear Delts'] },
  { publicId: 'ab-crunch', stationName: 'Ab Crunch', stationCode: '22', category: 'Core', exerciseSlug: null, exerciseName: 'Ab Crunch', primaryMuscles: ['Core'] }
];

function mockFetch(state: 'reserved' | 'ready' | 'pending' | 'quota', urls: string[], catalogRows = catalog) {
  globalThis.fetch = (input) => {
    const url = String(input); urls.push(url);
    if (url.endsWith('/auth/v1/user')) return Promise.resolve(respond({ id: userId }));
    if (url.endsWith('/rpc/reserve_planner_request')) {
      if (state === 'ready') return Promise.resolve(respond({ state, plan: { gymId: 'vault-fitness-club', cached: true } }));
      if (state === 'pending') return Promise.resolve(respond({ state, retryAfterSeconds: 3 }));
      if (state === 'quota') return Promise.resolve(respond({ state }));
      return Promise.resolve(respond({ state, id: '00000000-0000-4000-8000-000000000002', token: '00000000-0000-4000-8000-000000000003', gymName: 'Vault Fitness Club', validUntil: '2026-09-21T07:00:00Z' }));
    }
    if (url.endsWith('/rpc/reserve_planner_catalog')) return Promise.resolve(respond({ state: 'claimed', token: '00000000-0000-4000-8000-000000000004', catalog: [] }));
    if (url.endsWith('/api/member/gyms/vault-fitness-club/exercises')) return Promise.resolve(respond({ exercises: catalogRows }));
    if (url.endsWith('/rpc/finish_planner_catalog') || url.endsWith('/rpc/finish_planner_request')) return Promise.resolve(respond(true));
    if (url.endsWith('/rpc/get_planner_today')) return Promise.resolve(respond({ gymId: 'vault-fitness-club', cached: true }));
    if (url.endsWith('/v1/systemone')) return Promise.resolve(respond({ answers: {
      training_focus: { choice: 'full_body', confidence: .94 }, needs_professional_guidance: { noul: 0.02 }
    } }));
    throw new Error(`Unexpected request: ${url}`);
  };
}

Deno.test('plans use the batched gym catalog and keep multi-exercise slugs', async () => {
  const urls: string[] = []; mockFetch('reserved', urls);
  try {
    const response = await handleRequest(request('chest and back', 'generate', 45));
    const data = await response.json();
    if (response.status !== 200) throw new Error(JSON.stringify(data));
    if (!Array.isArray(data.plan.exercises) || data.plan.exercises.length < 4) throw new Error('Plan was incomplete.');
    if (!data.plan.exercises.some((exercise: PlannedItem) => exercise.publicId === 'powerrack' && exercise.exerciseSlug === 'barbell-bench-press'))
      throw new Error('Rack exercise slug was lost.');
    if (urls.some((url) => url.includes('/api/nfc/resolve/'))) throw new Error('N+1 station lookup returned.');
    if (urls.filter((url) => url.includes('/api/member/gyms/vault-fitness-club/exercises')).length !== 1)
      throw new Error('Catalog was not fetched once.');
    if (!urls.some((url) => url.includes('typesafe.ai'))) throw new Error('Jev was not called.');
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test('free-text chest and back covers incline, flat, decline, vertical pull, row and posterior chain', async () => {
  const urls: string[] = []; mockFetch('reserved', urls);
  try {
    const response = await handleRequest(request('chest and back'));
    const data = await response.json();
    if (response.status !== 200) throw new Error(JSON.stringify(data));
    const covered = data.plan.coverage.covered as string[];
    if (covered.length !== 6 || data.plan.coverage.missing.length) throw new Error(`Unexpected coverage: ${JSON.stringify(data.plan.coverage)}`);
    for (const label of ['Upper chest', 'Mid chest', 'Lower chest', 'Back width', 'Mid/upper back', 'Lower back'])
      if (!covered.some((area) => area.startsWith(label))) throw new Error(`Missing ${label}`);
    if (data.plan.exercises.length !== 6 || data.plan.exercises.some((item: PlannedItem) => !item.targetArea))
      throw new Error('Exercise-area mapping was incomplete.');
    if (data.plan.exercises.find((item: PlannedItem) => item.targetArea.startsWith('Mid chest'))?.name === 'Assisted Dip')
      throw new Error('A dip was incorrectly labeled as a flat/fly chest movement.');
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test('unavailable muscle area is disclosed, not falsely marked as covered', async () => {
  const urls: string[] = []; mockFetch('reserved', urls, catalog.filter((item) => item.exerciseName !== 'Decline Chest Press'));
  try {
    const response = await handleRequest(request('chest and back'));
    const data = await response.json();
    if (response.status !== 200 || data.plan.coverage.covered.length !== 5 || !data.plan.coverage.missing.some((area: string) => area.startsWith('Lower chest')))
      throw new Error(`Missing-area warning failed: ${JSON.stringify(data)}`);
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test('20-minute full-body plan prioritizes push, pull and legs and names deferred areas', async () => {
  const urls: string[] = []; mockFetch('reserved', urls);
  try {
    const response = await handleRequest(request('full body', 'generate', 20));
    const data = await response.json();
    if (response.status !== 200) throw new Error(JSON.stringify(data));
    const covered = data.plan.coverage.covered as string[];
    if (covered.length !== 3 || !['Quads', 'Back · pull', 'Chest'].every((area) => covered.includes(area)))
      throw new Error(`Short full-body priorities were wrong: ${JSON.stringify(data.plan.coverage)}`);
    if (data.plan.exercises.find((item: PlannedItem) => item.targetArea === 'Back · pull')?.name !== 'Lat Pulldown')
      throw new Error('Short full-body plan should favor a quick upper-body pull over a rack setup.');
    if (data.plan.exercises.some((item: PlannedItem) => item.sets !== 2) || data.plan.pacing.totalSets !== 6)
      throw new Error('Short plan did not reduce working sets.');
    if (!data.plan.coverage.deferred.length || data.plan.coverage.missing.includes('Shoulders'))
      throw new Error('Time-deferred areas were confused with unavailable equipment.');
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test('shoulders and back cover front, side, rear, width, row and posterior chain when time allows', async () => {
  const urls: string[] = []; mockFetch('reserved', urls);
  try {
    const response = await handleRequest(request('shoulders and back', 'generate', 45));
    const data = await response.json();
    if (response.status !== 200) throw new Error(JSON.stringify(data));
    const covered = data.plan.coverage.covered as string[];
    for (const label of ['Front shoulders', 'Side shoulders', 'Rear shoulders', 'Back width', 'Mid/upper back', 'Lower back'])
      if (!covered.some((area) => area.startsWith(label))) throw new Error(`Missing ${label}: ${JSON.stringify(data.plan.coverage)}`);
    if (data.plan.coverage.deferred.length || data.plan.coverage.missing.length) throw new Error('A supported area was omitted.');
    if (data.plan.exercises.length !== 6 || data.plan.pacing.totalSets !== 14)
      throw new Error('45-minute plan volume did not fit the time budget.');
    if (data.plan.exercises.find((item: PlannedItem) => item.targetArea.startsWith('Side shoulders'))?.name !== 'Lateral Raise')
      throw new Error('Side delts were not mapped to the lateral raise.');
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test('20-minute shoulders and back remain balanced and show what needs a longer session', async () => {
  const urls: string[] = []; mockFetch('reserved', urls);
  try {
    const response = await handleRequest(request('shoulders and back', 'generate', 20));
    const data = await response.json();
    if (response.status !== 200) throw new Error(JSON.stringify(data));
    if (data.plan.exercises.length !== 3 || data.plan.pacing.totalSets !== 6) throw new Error('Short plan is too large.');
    if (!data.plan.coverage.covered.some((area: string) => area.includes('shoulders')) || !data.plan.coverage.covered.some((area: string) => area.includes('Back')))
      throw new Error('One requested muscle group was dropped.');
    if (data.plan.coverage.deferred.length !== 3) throw new Error('Deferred areas were not disclosed.');
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test('every offered time choice returns a plan whose estimated work fits the selected window', async () => {
  for (const duration of [20, 30, 45, 60, 75, 90]) {
    const urls: string[] = []; mockFetch('reserved', urls);
    try {
      const response = await handleRequest(request('shoulders and back', 'generate', duration));
      const data = await response.json();
      if (response.status !== 200 || data.plan.durationMinutes !== duration || data.plan.pacing.estimatedMinutes > duration)
        throw new Error(`${duration}-minute option failed: ${JSON.stringify(data)}`);
    } finally { globalThis.fetch = originalFetch; }
  }
});

Deno.test('same request returns the shared stored plan without an AI call', async () => {
  const urls: string[] = []; mockFetch('ready', urls);
  try {
    const response = await handleRequest(request('full body'));
    const data = await response.json();
    if (response.status !== 200 || !data.plan.cached) throw new Error('Stored plan was not returned.');
    if (urls.some((url) => url.includes('typesafe.ai'))) throw new Error('Cached plan still used Jev.');
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test('concurrent reservation and daily quota do not call AI', async () => {
  for (const state of ['pending', 'quota'] as const) {
    const urls: string[] = []; mockFetch(state, urls);
    try {
      const response = await handleRequest(request('legs'));
      if (response.status !== (state === 'pending' ? 202 : 429)) throw new Error(`Unexpected ${state} response.`);
      if (urls.some((url) => url.includes('typesafe.ai'))) throw new Error(`${state} used Jev.`);
    } finally { globalThis.fetch = originalFetch; }
  }
});

Deno.test('today reads only the authenticated member’s server plan', async () => {
  const urls: string[] = []; mockFetch('reserved', urls);
  try {
    const response = await handleRequest(request('', 'today'));
    const data = await response.json();
    if (response.status !== 200 || !data.plan.cached) throw new Error('Today plan was not returned.');
    if (urls.some((url) => url.includes('typesafe.ai'))) throw new Error('Today lookup used Jev.');
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test('medical requests stop before storage or the third-party model', async () => {
  const urls: string[] = []; mockFetch('reserved', urls);
  try {
    const response = await handleRequest(request('legs with knee pain'));
    if (response.status !== 422) throw new Error(`Expected 422, got ${response.status}`);
    if (urls.some((url) => url.includes('/rest/v1/rpc/') || url.includes('typesafe.ai')))
      throw new Error('Medical text was sent onward.');
  } finally { globalThis.fetch = originalFetch; }
});
