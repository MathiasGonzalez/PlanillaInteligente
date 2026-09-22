import type { APIRoute } from 'astro';
import { and, desc, eq, gt } from 'drizzle-orm';
import { emailLoginChallenges } from '@planilla/cloudflare/d1/schema';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { sendLoginCode } from '@planilla/cloudflare/mailer';
import { json } from '../../../../app/http/responses';
import { EMAIL_CHALLENGE_COOKIE } from '../../../../lib/auth';
import { hmacHex, normalizeEmail, randomId, randomOtp } from '../../../../lib/email-otp';
import { verifyTurnstileToken } from '../../../../lib/turnstile';

const GENERIC = { ok: true };
const TEN_MINUTES = 10 * 60;
const UNAVAILABLE = 'No se pudo enviar el código. El correo no está disponible en este entorno.';

export const POST: APIRoute = async ({ request, locals, cookies, clientAddress, url }) => {
  const form = await request.formData().catch(() => null);
  const email = normalizeEmail(form?.get('email')?.toString() ?? '');
  const token = form?.get('cf-turnstile-response')?.toString() ?? form?.get('turnstileToken')?.toString() ?? '';
  const verification = await verifyTurnstileToken({
    token,
    secretKey: cloudflareEnv.TURNSTILE_SECRET_KEY,
    remoteIp: clientAddress,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!verification.success || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'No pudimos enviar el código.' }, 400);
  }
  const key = cloudflareEnv.AUTH_HMAC_KEY?.trim();
  if (!key) return json({ error: UNAVAILABLE }, 503);
  const emailHash = await hmacHex(key, email);
  const recent = await locals.db.select({ createdAt: emailLoginChallenges.createdAt }).from(emailLoginChallenges).where(and(
    eq(emailLoginChallenges.emailHash, emailHash),
    gt(emailLoginChallenges.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
  )).orderBy(desc(emailLoginChallenges.createdAt));
  const latest = recent[0]?.createdAt.getTime() ?? 0;
  if (recent.length >= 5 || Date.now() - latest < 60_000) return json(GENERIC);
  const id = randomId();
  const code = randomOtp();
  const sent = await sendLoginCode(cloudflareEnv.MAILER, { to: email, code, expiresInMinutes: 10 });
  if (!sent) return json({ error: UNAVAILABLE }, 503);
  await locals.db.insert(emailLoginChallenges).values({
    id,
    emailHash,
    codeHash: await hmacHex(key, `${id}:${code}`),
    attempts: 0,
    expiresAt: new Date(Date.now() + TEN_MINUTES * 1000),
  });
  cookies.set(EMAIL_CHALLENGE_COOKIE, id, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    maxAge: TEN_MINUTES,
  });
  return json(GENERIC);
};
