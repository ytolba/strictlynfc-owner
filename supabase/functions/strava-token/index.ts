// Exchanges Strava OAuth codes and refresh tokens so the client secret never ships in the app.
// Secrets: supabase secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=...
// Deploy:  supabase functions deploy strava-token   (JWT verification stays on; members use their Supabase session)

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const clientId = Deno.env.get('STRAVA_CLIENT_ID');
  const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET');
  if (!clientId || !clientSecret) return json({ error: 'Strava is not configured on the server.' }, 500);

  let body: { grant_type?: string; code?: string; refresh_token?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }

  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
  if (body.grant_type === 'authorization_code' && body.code) {
    form.set('grant_type', 'authorization_code');
    form.set('code', body.code);
  } else if (body.grant_type === 'refresh_token' && body.refresh_token) {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', body.refresh_token);
  } else {
    return json({ error: 'Unsupported grant.' }, 400);
  }

  const response = await fetch('https://www.strava.com/oauth/token', { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: data.message || 'Strava rejected the request.' }, 400);

  return json({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete: data.athlete ? { firstname: data.athlete.firstname } : undefined
  });
});
