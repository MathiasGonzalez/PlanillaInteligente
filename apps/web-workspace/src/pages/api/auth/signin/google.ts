import type { APIRoute } from 'astro';
import { verifyTurnstileToken } from '../../../../lib/turnstile';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import {
  buildGoogleAuthorizationUrl,
  createOAuthChallenge,
  storeOAuthCookies,
} from '../../../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, url, clientAddress, redirect }) => {
  const formData = await request.formData().catch(() => null);
  const turnstileToken =
    formData?.get('cf-turnstile-response')?.toString() ?? formData?.get('turnstileToken')?.toString() ?? '';

  const verification = await verifyTurnstileToken({
    token: turnstileToken,
    secretKey: cloudflareEnv.TURNSTILE_SECRET_KEY,
    remoteIp: clientAddress,
    idempotencyKey: crypto.randomUUID(),
  });

  if (!verification.success) {
    return redirect('/login?error=turnstile');
  }

  const clientId = cloudflareEnv.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = cloudflareEnv.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return redirect('/login?error=config');
  }

  const challenge = await createOAuthChallenge();
  storeOAuthCookies(cookies, url, challenge);

  return redirect(
    buildGoogleAuthorizationUrl({
      clientId,
      origin: url.origin,
      state: challenge.state,
      challenge: challenge.challenge,
    }),
  );
};
