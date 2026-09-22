import type { APIRoute } from 'astro';
import { and, eq, isNull } from 'drizzle-orm';
import { accounts, emailLoginChallenges } from '@planilla/cloudflare/d1/schema';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { json } from '../../../../app/http/responses';
import { createUserSession, EMAIL_CHALLENGE_COOKIE, PENDING_INVITE_COOKIE, resolveUserAndTenant } from '../../../../lib/auth';
import { hmacHex, normalizeEmail, timingSafeEqual } from '../../../../lib/email-otp';

export const POST: APIRoute = async ({ request, locals, cookies, url }) => {
  const form = await request.formData().catch(() => null);
  const email = normalizeEmail(form?.get('email')?.toString() ?? '');
  const code = form?.get('code')?.toString().trim() ?? '';
  const challengeId = cookies.get(EMAIL_CHALLENGE_COOKIE)?.value;
  const key = cloudflareEnv.AUTH_HMAC_KEY?.trim();
  if (!key || !challengeId || !/^\d{6}$/.test(code)) return json({ error: 'Código incorrecto.' }, 400);
  const [challenge] = await locals.db.select().from(emailLoginChallenges).where(and(
    eq(emailLoginChallenges.id, challengeId),
    isNull(emailLoginChallenges.consumedAt),
  )).limit(1);
  if (!challenge || challenge.expiresAt.getTime() < Date.now() || challenge.attempts >= 5) {
    return json({ error: 'Código incorrecto.' }, 400);
  }
  const emailHash = await hmacHex(key, email);
  const codeHash = await hmacHex(key, `${challenge.id}:${code}`);
  if (emailHash !== challenge.emailHash || !timingSafeEqual(codeHash, challenge.codeHash)) {
    const attempts = challenge.attempts + 1;
    await locals.db.update(emailLoginChallenges).set({
      attempts,
      consumedAt: attempts >= 5 ? new Date() : null,
    }).where(eq(emailLoginChallenges.id, challenge.id));
    return json({ error: 'Código incorrecto.' }, 400);
  }
  await locals.db.update(emailLoginChallenges).set({ consumedAt: new Date() }).where(eq(emailLoginChallenges.id, challenge.id));
  const inviteToken = cookies.get(PENDING_INVITE_COOKIE)?.value ?? null;
  const resolved = await resolveUserAndTenant(locals.db, { email, name: null, image: null }, inviteToken);
  const [account] = await locals.db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.provider, 'email'), eq(accounts.providerAccountId, emailHash))).limit(1);
  if (!account) {
    await locals.db.insert(accounts).values({
      id: crypto.randomUUID(),
      userId: resolved.user.id,
      tenantId: resolved.tenantId,
      provider: 'email',
      providerAccountId: emailHash,
    });
  }
  cookies.delete(EMAIL_CHALLENGE_COOKIE, { path: '/' });
  cookies.delete(PENDING_INVITE_COOKIE, { path: '/' });
  await createUserSession(locals.db, cloudflareEnv.SESSION_KV, cookies, url, resolved.user, resolved.tenantId);
  return json({ ok: true });
};
