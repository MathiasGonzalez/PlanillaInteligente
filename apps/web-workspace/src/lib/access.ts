import type { APIContext } from 'astro';

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
