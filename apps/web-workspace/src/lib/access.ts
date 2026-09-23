import type { APIContext } from 'astro';
import { json } from '../app/http/responses';

type Locals = APIContext['locals'];

export function requireUser(locals: Locals) {
  if (!locals.user || !locals.tenantId) return null;
  return { user: locals.user, tenantId: locals.tenantId };
}

export function requireOwner(locals: Locals) {
  const session = requireUser(locals);
  if (!session || session.user.role !== 'owner') return null;
  return session;
}

type Session = NonNullable<ReturnType<typeof requireUser>>;
type AuthResult = ({ ok: true } & Session) | { ok: false; response: Response };

function deny(status: 401 | 403): AuthResult {
  return { ok: false, response: json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, status) };
}

export function userSession(locals: Locals): AuthResult {
  const session = requireUser(locals);
  if (!session) return deny(401);
  return { ok: true, ...session };
}

export function ownerSession(locals: Locals): AuthResult {
  const session = requireUser(locals);
  if (!session) return deny(401);
  if (session.user.role !== 'owner') return deny(403);
  return { ok: true, ...session };
}

export function missingParams() {
  return json({ error: 'Solicitud incompleta.' }, 400);
}
