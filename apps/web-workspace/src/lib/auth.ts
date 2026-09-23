import type { AstroCookies } from 'astro';
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { accounts, memberships, organizations, sessions, users } from '@planilla/cloudflare/d1/schema';
import type * as schema from '@planilla/cloudflare/d1/schema';
import { deleteKv, putKvJson } from '@planilla/cloudflare/kv';
import type { SessionCacheEntry, SessionUser, UserSession } from '../middleware';
import { acceptInvitation } from '@planilla/apps/members';

export const PENDING_INVITE_COOKIE = 'pending_invite';
export const EMAIL_CHALLENGE_COOKIE = 'email_challenge';

export const SESSION_COOKIE_NAME = 'session';
export const OAUTH_STATE_COOKIE = 'oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'oauth_code_verifier';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_SCOPES = 'openid email profile';

type AppDatabase = DrizzleD1Database<typeof schema>;

interface GoogleTokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  scope?: unknown;
  error?: unknown;
}

interface GoogleUserPayload {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  picture?: unknown;
}

export interface GoogleProfile {
  providerAccountId: string;
  email: string;
  name: string | null;
  image: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  expiresAt: Date | null;
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cookieOptions(secure: boolean, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure,
    maxAge: maxAgeSeconds,
  };
}

function isSecureRequest(url: URL) {
  return url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '[::1]';
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

function randomToken(bytes = 32) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return slug || 'workspace';
}

export function googleCallbackUrl(origin: string) {
  return `${origin}/api/auth/callback/google`;
}

export async function createOAuthChallenge() {
  const state = randomToken();
  const verifier = randomToken();
  const challenge = await sha256Base64Url(verifier);

  return { state, verifier, challenge };
}

export function storeOAuthCookies(
  cookies: AstroCookies,
  url: URL,
  challenge: { state: string; verifier: string },
) {
  const options = cookieOptions(isSecureRequest(url), OAUTH_COOKIE_MAX_AGE_SECONDS);
  cookies.set(OAUTH_STATE_COOKIE, challenge.state, options);
  cookies.set(OAUTH_VERIFIER_COOKIE, challenge.verifier, options);
}

export function clearOAuthCookies(cookies: AstroCookies) {
  cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });
  cookies.delete(OAUTH_VERIFIER_COOKIE, { path: '/' });
}

export function readOAuthCookies(cookies: AstroCookies) {
  return {
    state: cookies.get(OAUTH_STATE_COOKIE)?.value ?? null,
    verifier: cookies.get(OAUTH_VERIFIER_COOKIE)?.value ?? null,
  };
}

export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  origin: string;
  state: string;
  challenge: string;
}) {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: googleCallbackUrl(input.origin),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(input: {
  clientId: string;
  clientSecret: string;
  origin: string;
  code: string;
  verifier: string;
}): Promise<GoogleProfile | null> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: googleCallbackUrl(input.origin),
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.verifier,
  });

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const tokenPayload = (await tokenResponse.json().catch(() => null)) as GoogleTokenPayload | null;
  const accessToken = asString(tokenPayload?.access_token);
  if (!tokenResponse.ok || !accessToken || asString(tokenPayload?.error)) {
    return null;
  }

  const userResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const userPayload = (await userResponse.json().catch(() => null)) as GoogleUserPayload | null;
  const providerAccountId = asString(userPayload?.id);
  const email = asString(userPayload?.email)?.toLowerCase();
  if (!userResponse.ok || !providerAccountId || !email) {
    return null;
  }

  const expiresIn = typeof tokenPayload?.expires_in === 'number' ? tokenPayload.expires_in : null;

  return {
    providerAccountId,
    email,
    name: asString(userPayload?.name),
    image: asString(userPayload?.picture),
    accessToken,
    refreshToken: asString(tokenPayload?.refresh_token),
    tokenType: asString(tokenPayload?.token_type),
    scope: asString(tokenPayload?.scope),
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
  };
}

async function uniqueOrganizationSlug(db: AppDatabase, base: string) {
  const slugBase = slugify(base);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slug = attempt === 0 ? slugBase : `${slugBase}-${randomToken(3)}`;
    const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (!existing) {
      return slug;
    }
  }

  return `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;
}

async function loadSessionUser(db: AppDatabase, userId: string, tenantId: string): Promise<SessionUser> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      defaultOrganizationId: users.defaultOrganizationId,
      role: memberships.role,
    })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, tenantId)))
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new Error('Failed to load authenticated user.');
  return user;
}

export async function resolveUserAndTenant(
  db: AppDatabase,
  identity: { email: string; name: string | null; image: string | null },
  inviteToken: string | null,
): Promise<{ user: SessionUser; tenantId: string }> {
  const now = new Date();
  const [existingUser] = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
  const userId = existingUser?.id ?? crypto.randomUUID();
  if (existingUser) {
    await db.update(users).set({
      name: identity.name ?? existingUser.name,
      image: identity.image ?? existingUser.image,
      emailVerifiedAt: now,
      updatedAt: now,
    }).where(eq(users.id, userId));
  } else {
    await db.insert(users).values({
      id: userId,
      email: identity.email,
      name: identity.name,
      image: identity.image,
      emailVerifiedAt: now,
    });
  }

  if (inviteToken) {
    const accepted = await acceptInvitation(db, { token: inviteToken, userId });
    if (accepted) {
      return { user: await loadSessionUser(db, userId, accepted.tenantId), tenantId: accepted.tenantId };
    }
  }

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  let tenantId = existingUser?.defaultOrganizationId ?? membership?.organizationId ?? null;
  if (!tenantId) {
    tenantId = crypto.randomUUID();
    const slug = await uniqueOrganizationSlug(db, identity.email.split('@')[0] ?? 'workspace');
    await db.insert(organizations).values({
      id: tenantId,
      name: identity.name ? `Workspace de ${identity.name}` : `Workspace de ${identity.email}`,
      slug,
      ownerUserId: userId,
    });
    await db.insert(memberships).values({
      id: crypto.randomUUID(),
      organizationId: tenantId,
      userId,
      role: 'owner',
    });
    await db.update(users).set({ defaultOrganizationId: tenantId, updatedAt: now }).where(eq(users.id, userId));
  }
  return { user: await loadSessionUser(db, userId, tenantId), tenantId };
}

export async function upsertGoogleUser(
  db: AppDatabase,
  profile: GoogleProfile,
  inviteToken: string | null,
): Promise<{ user: SessionUser; tenantId: string }> {
  const now = new Date();
  const [existingAccount] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.provider, 'google'), eq(accounts.providerAccountId, profile.providerAccountId)))
    .limit(1);

  if (existingAccount) {
    const identity = await loadSessionUserFromAccount(db, existingAccount.userId, inviteToken);
    await db
      .update(accounts)
      .set({
        tokenType: profile.tokenType,
        scope: profile.scope,
        expiresAt: profile.expiresAt,
        tenantId: identity.tenantId,
        updatedAt: now,
        accessToken: null,
        refreshToken: null,
      })
      .where(and(eq(accounts.provider, 'google'), eq(accounts.providerAccountId, profile.providerAccountId)));
    return identity;
  }

  const resolved = await resolveUserAndTenant(db, profile, inviteToken);
  await db.insert(accounts).values({
    id: crypto.randomUUID(),
    userId: resolved.user.id,
    tenantId: resolved.tenantId,
    provider: 'google',
    providerAccountId: profile.providerAccountId,
    accessToken: null,
    refreshToken: null,
    tokenType: profile.tokenType,
    scope: profile.scope,
    expiresAt: profile.expiresAt,
  });
  return resolved;
}

async function loadSessionUserFromAccount(db: AppDatabase, userId: string, inviteToken: string | null) {
  if (inviteToken) {
    const accepted = await acceptInvitation(db, { token: inviteToken, userId });
    if (accepted) {
      return { user: await loadSessionUser(db, userId, accepted.tenantId), tenantId: accepted.tenantId };
    }
  }
  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  const [user] = await db.select({ defaultOrganizationId: users.defaultOrganizationId }).from(users).where(eq(users.id, userId)).limit(1);
  const tenantId = user?.defaultOrganizationId ?? membership?.organizationId;
  if (!tenantId) throw new Error('Failed to load authenticated user.');
  return { user: await loadSessionUser(db, userId, tenantId), tenantId };
}

export async function createUserSession(
  db: AppDatabase,
  kv: KVNamespace | undefined,
  cookies: AstroCookies,
  url: URL,
  user: SessionUser,
  tenantId: string,
) {
  const sessionToken = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session: UserSession = {
    id: crypto.randomUUID(),
    userId: user.id,
    sessionToken,
    activeOrganizationId: tenantId,
    expiresAt: expiresAt.toISOString(),
  };

  await db.insert(sessions).values({
    id: session.id,
    userId: user.id,
    sessionToken,
    activeOrganizationId: tenantId,
    expiresAt,
  });

  cookies.set(SESSION_COOKIE_NAME, sessionToken, cookieOptions(isSecureRequest(url), Math.floor(SESSION_TTL_MS / 1000)));

  const cacheEntry: SessionCacheEntry = {
    tenantId,
    userId: user.id,
    sessionId: session.id,
    expiresAt: session.expiresAt,
  };

  await putKvJson(
    kv,
    `session:${sessionToken}`,
    cacheEntry,
    Math.floor(SESSION_TTL_MS / 1000),
  );
}

export async function destroyUserSession(
  db: AppDatabase,
  kv: KVNamespace | undefined,
  cookies: AstroCookies,
  sessionToken: string | null,
) {
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
  cookies.delete('session_token', { path: '/' });
  cookies.delete('authjs.session-token', { path: '/' });

  if (!sessionToken) {
    return;
  }

  await Promise.all([
    deleteKv(kv, `session:${sessionToken}`),
    db.delete(sessions).where(eq(sessions.sessionToken, sessionToken)),
  ]);
}

export async function switchActiveOrganization(
  db: AppDatabase,
  kv: KVNamespace | undefined,
  session: UserSession,
  user: SessionUser,
  tenantId: string,
) {
  await db.update(sessions).set({
    activeOrganizationId: tenantId,
    updatedAt: new Date(),
  }).where(eq(sessions.sessionToken, session.sessionToken));
  const ttl = Math.max(1, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
  await putKvJson(kv, `session:${session.sessionToken}`, {
    tenantId,
    userId: user.id,
    sessionId: session.id,
    expiresAt: session.expiresAt,
  }, ttl);
}
