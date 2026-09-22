import type { APIRoute } from 'astro';
import { requireOwner } from '../../lib/access';
import { fail, json } from '../../app/http/responses';
import { createInvitation, listInvitations, listMembers } from '@planilla/apps/members';

export const GET: APIRoute = async ({ locals }) => {
  const session = requireOwner(locals);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  const [members, invitations] = await Promise.all([
    listMembers(locals.db, session.tenantId),
    listInvitations(locals.db, session.tenantId),
  ]);
  return json({ members, invitations });
};

export const POST: APIRoute = async ({ locals, url }) => {
  const session = requireOwner(locals);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  try {
    const created = await createInvitation(locals.db, { tenantId: session.tenantId, userId: session.user.id });
    return json({ url: `${url.origin}/invite/${created.token}` }, 201);
  } catch {
    return fail(500);
  }
};
