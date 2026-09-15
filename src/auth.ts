import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase';

// Member and owner modes sign in the same way. Owner access is still decided server-side by gym membership,
// so an Apple or Google account only reaches owner tools when its email matches an invitation.
export const PASSWORD_RESET_URL = 'https://strictlyinc.com/owner?mode=reset';

const canceled = () => Object.assign(new Error('Sign-in canceled.'), { canceled: true });
export const isCanceled = (reason: unknown) => !!(reason as { canceled?: boolean } | null)?.canceled;

// Supabase reports a switched-off provider as "Unsupported provider" / "provider is not enabled".
function providerError(error: unknown, provider: string) {
  const message = error instanceof Error ? error.message : '';
  if (/not enabled|unsupported provider|provider.*disabled/i.test(message)) return new Error(`${provider} sign-in isn't available yet. Use email for now.`);
  return error instanceof Error ? error : new Error(`${provider} sign-in did not finish.`);
}

export type AuthProviders = { apple: boolean; google: boolean };
let providersRequest: Promise<AuthProviders> | null = null;

// Sign-in buttons appear only for providers switched on in Supabase, so nobody (App Review included)
// meets a button that can't finish. A failed lookup hides them and is retried on the next screen.
export function loadEnabledProviders() {
  if (!providersRequest) {
    providersRequest = fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Auth settings unavailable.')))
      .then((settings: { external?: Record<string, boolean> }) => ({ apple: !!settings.external?.apple, google: !!settings.external?.google }))
      .catch(() => { providersRequest = null; return { apple: false, google: false }; });
  }
  return providersRequest;
}

export async function isAppleSignInAvailable() {
  return Platform.OS === 'ios' && AppleAuthentication.isAvailableAsync();
}

export async function signInWithApple() {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL, AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
      nonce: hashedNonce
    });
  } catch (reason) {
    if ((reason as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw canceled();
    throw providerError(reason, 'Apple');
  }
  if (!credential.identityToken) throw new Error('Apple did not return a sign-in token.');
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
  if (error) throw providerError(error, 'Apple');
}

export async function signInWithGoogle() {
  const redirectTo = ExpoLinking.createURL('auth/callback');
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } });
  if (error || !data.url) throw providerError(error, 'Google');
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') throw canceled();
  // Implicit flow returns tokens in the fragment; PKCE returns a code in the query.
  const params = new URL(result.url.replace('#', '?')).searchParams;
  const code = params.get('code');
  const accessToken = params.get('access_token'); const refreshToken = params.get('refresh_token');
  const sessionError = code
    ? (await supabase.auth.exchangeCodeForSession(code)).error
    : accessToken && refreshToken
      ? (await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })).error
      : new Error(params.get('error_description') || 'Google sign-in did not return a session.');
  if (sessionError) throw providerError(sessionError, 'Google');
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: PASSWORD_RESET_URL });
  if (error) throw error;
}
