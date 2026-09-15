import type { AstroCookies } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { and, eq, gt } from 'drizzle-orm';
import { memberships, sessions, users } from './db/schema';
import { createDatabase } from './bindings/d1';
import { getKvJson, putKvJson } from './bindings/kv';
import { cloudflareEnv } from './platform/cloudflare/env';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  defaultOrganizationId: string | null;
  role: 'owner' | 'admin' | 'member';
}

export interface UserSession {
  id: string;
  userId: string;
  sessionToken: string;
  activeOrganizationId: string;
  expiresAt: string;
}

interface SessionCacheEntry {
  tenantId: string;
  user: SessionUser;
  session: UserSession;
}

const PUBLIC_PATH_PREFIXES = ['/login', '/api/auth', '/favicon', '/_astro'];
const PUBLIC_PATHS = new Set(['/']);
const SESSION_COOKIE_NAMES = ['session', 'session_token', 'authjs.session-token'];

function isPublicRoute(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function getSessionToken(cookies: AstroCookies) {
  for (const cookieName of SESSION_COOKIE_NAMES) {
    const token = cookies.get(cookieName)?.value;
    if (token) {
      return token;
    }
  }

  return null;
}

function clearKnownSessionCookies(cookies: AstroCookies) {
  for (const cookieName of SESSION_COOKIE_NAMES) {
    cookies.delete(cookieName, { path: '/' });
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { locals, cookies, url } = context;
  const db = createDatabase(cloudflareEnv.DB);

  locals.db = db;
  locals.user = null;
  locals.session = null;
  locals.tenantId = null;

  const sessionToken = getSessionToken(cookies);

  if (!sessionToken) {
    if (isPublicRoute(url.pathname)) {
      return next();
    }

    return context.redirect('/login');
  }

  const cacheKey = `session:${sessionToken}`;
  const cachedSession = await getKvJson<SessionCacheEntry>(cloudflareEnv.SESSION_KV, cacheKey);

  if (cachedSession && new Date(cachedSession.session.expiresAt) > new Date()) {
    locals.user = cachedSession.user;
    locals.session = cachedSession.session;
    locals.tenantId = cachedSession.tenantId;

    return next();
  }

  const [record] = await db
    .select({
      sessionId: sessions.id,
      sessionUserId: sessions.userId,
      sessionToken: sessions.sessionToken,
      activeOrganizationId: sessions.activeOrganizationId,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      defaultOrganizationId: users.defaultOrganizationId,
      role: memberships.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(
      memberships,
      and(eq(memberships.organizationId, sessions.activeOrganizationId), eq(memberships.userId, users.id)),
    )
    .where(and(eq(sessions.sessionToken, sessionToken), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!record) {
    clearKnownSessionCookies(cookies);

    if (isPublicRoute(url.pathname)) {
      return next();
    }

    return context.redirect('/login');
  }

  locals.user = {
    id: record.userId,
    email: record.email,
    name: record.name,
    image: record.image,
    defaultOrganizationId: record.defaultOrganizationId,
    role: record.role,
  };
  locals.session = {
    id: record.sessionId,
    userId: record.sessionUserId,
    sessionToken: record.sessionToken,
    activeOrganizationId: record.activeOrganizationId,
    expiresAt: record.expiresAt.toISOString(),
  };
  locals.tenantId = record.activeOrganizationId;

  await putKvJson(
    cloudflareEnv.SESSION_KV,
    cacheKey,
    { tenantId: locals.tenantId, user: locals.user, session: locals.session },
    Math.floor((record.expiresAt.getTime() - Date.now()) / 1000),
  );

  return next();
});
