import type { AstroCookies } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { and, eq, gt } from 'drizzle-orm';
import { memberships, sessions, users } from '@planilla/cloudflare/d1/schema';
import { createDatabase } from '@planilla/cloudflare/d1';
import { getKvJson, putKvJson } from '@planilla/cloudflare/kv';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { deleteSessionByToken } from '@planilla/apps/retention';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  defaultOrganizationId: string | null;
  role: 'owner' | 'member';
}

export interface UserSession {
  id: string;
  userId: string;
  sessionToken: string;
  activeOrganizationId: string;
  expiresAt: string;
}

export interface SessionCacheEntry {
  tenantId: string;
  userId: string;
  role: SessionUser['role'];
  sessionId: string;
  expiresAt: string;
}

const PUBLIC_PATH_PREFIXES = ['/login', '/api/auth', '/invite', '/favicon', '/_astro'];
const SESSION_COOKIE_NAMES = ['session', 'session_token', 'authjs.session-token'];

function isPublicRoute(pathname: string) {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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

async function loadSessionProfile(
  db: ReturnType<typeof createDatabase>,
  userId: string,
  tenantId: string,
) {
  const [profile] = await db
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

  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    image: profile.image,
    defaultOrganizationId: profile.defaultOrganizationId,
    role: profile.role,
  } satisfies SessionUser;
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

  if (cachedSession && new Date(cachedSession.expiresAt) <= new Date()) {
    await deleteSessionByToken(db, cloudflareEnv.SESSION_KV, sessionToken);
    clearKnownSessionCookies(cookies);

    if (isPublicRoute(url.pathname)) {
      return next();
    }

    return context.redirect('/login');
  }

  if (cachedSession) {
    const profile = await loadSessionProfile(db, cachedSession.userId, cachedSession.tenantId);
    if (profile) {
      locals.user = profile;
      locals.session = {
        id: cachedSession.sessionId,
        userId: cachedSession.userId,
        sessionToken,
        activeOrganizationId: cachedSession.tenantId,
        expiresAt: cachedSession.expiresAt,
      };
      locals.tenantId = cachedSession.tenantId;
      return next();
    }

    await deleteSessionByToken(db, cloudflareEnv.SESSION_KV, sessionToken);
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
    await deleteSessionByToken(db, cloudflareEnv.SESSION_KV, sessionToken);
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

  const cacheEntry: SessionCacheEntry = {
    tenantId: record.activeOrganizationId,
    userId: record.userId,
    role: record.role,
    sessionId: record.sessionId,
    expiresAt: record.expiresAt.toISOString(),
  };

  await putKvJson(
    cloudflareEnv.SESSION_KV,
    cacheKey,
    cacheEntry,
    Math.floor((record.expiresAt.getTime() - Date.now()) / 1000),
  );

  return next();
});
