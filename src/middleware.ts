import type { AstroCookies } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { and, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { memberships, sessions, users } from './db/schema';
import * as schema from './db/schema';

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

type RuntimeLocals = App.Locals & {
  runtime: { env: Env };
};

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
  const runtimeLocals = locals as RuntimeLocals;
  const db = drizzle(runtimeLocals.runtime.env.DB, { schema });

  runtimeLocals.db = db;
  runtimeLocals.user = null;
  runtimeLocals.session = null;
  runtimeLocals.tenantId = null;

  const sessionToken = getSessionToken(cookies);

  if (!sessionToken) {
    if (isPublicRoute(url.pathname)) {
      return next();
    }

    return context.redirect('/login');
  }

  const cacheKey = `session:${sessionToken}`;
  const cachedSession = await runtimeLocals.runtime.env.SESSION_KV.get<SessionCacheEntry>(cacheKey, 'json');

  if (cachedSession && new Date(cachedSession.session.expiresAt) > new Date()) {
    runtimeLocals.user = cachedSession.user;
    runtimeLocals.session = cachedSession.session;
    runtimeLocals.tenantId = cachedSession.tenantId;

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

  runtimeLocals.user = {
    id: record.userId,
    email: record.email,
    name: record.name,
    image: record.image,
    defaultOrganizationId: record.defaultOrganizationId,
    role: record.role,
  };
  runtimeLocals.session = {
    id: record.sessionId,
    userId: record.sessionUserId,
    sessionToken: record.sessionToken,
    activeOrganizationId: record.activeOrganizationId,
    expiresAt: record.expiresAt.toISOString(),
  };
  runtimeLocals.tenantId = record.activeOrganizationId;

  await runtimeLocals.runtime.env.SESSION_KV.put(
    cacheKey,
    JSON.stringify({
      tenantId: runtimeLocals.tenantId,
      user: runtimeLocals.user,
      session: runtimeLocals.session,
    }),
    {
      expirationTtl: Math.max(60, Math.floor((record.expiresAt.getTime() - Date.now()) / 1000)),
    },
  );

  return next();
});
