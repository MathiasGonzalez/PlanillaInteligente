import type { APIRoute } from 'astro';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import {
  clearOAuthCookies,
  createUserSession,
  exchangeGoogleCode,
  readOAuthCookies,
  upsertGoogleUser,
} from '../../../../lib/auth';

export const GET: APIRoute = async ({ url, cookies, redirect, locals }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stored = readOAuthCookies(cookies);
  clearOAuthCookies(cookies);

  if (!code) {
    return redirect('/login?error=missing_code');
  }

  if (!state || !stored.state || !stored.verifier || state !== stored.state) {
    return redirect('/login?error=invalid_state');
  }

  const clientId = cloudflareEnv.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = cloudflareEnv.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return redirect('/login?error=config');
  }

  const profile = await exchangeGoogleCode({
    clientId,
    clientSecret,
    origin: url.origin,
    code,
    verifier: stored.verifier,
  });

  if (!profile) {
    return redirect('/login?error=oauth_failed');
  }

  try {
    const { user, tenantId } = await upsertGoogleUser(locals.db, profile);
    await createUserSession(locals.db, cloudflareEnv.SESSION_KV, cookies, url, user, tenantId);
  } catch {
    return redirect('/login?error=oauth_failed');
  }

  return redirect('/');
};
