import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { memberships } from '@planilla/cloudflare/d1/schema';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { deactivateOrganization, eraseOrganization } from '@planilla/apps/retention';
import { destroyUserSession } from '../../lib/auth';

export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  if (!locals.user || !locals.tenantId || !locals.session) {
    return redirect('/login');
  }

  if (locals.user.role !== 'owner') {
    return redirect('/');
  }

  const formData = await request.formData();
  const mode = formData.get('mode')?.toString();
  const [membership] = await locals.db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.organizationId, locals.tenantId), eq(memberships.userId, locals.user.id), eq(memberships.role, 'owner')))
    .limit(1);

  if (!membership) {
    return redirect('/');
  }

  if (mode === 'erase') {
    const sessionToken = locals.session.sessionToken;
    await eraseOrganization(locals.db, cloudflareEnv.BUCKET, cloudflareEnv.SESSION_KV, locals.tenantId);
    await destroyUserSession(locals.db, cloudflareEnv.SESSION_KV, cookies, sessionToken);
    return redirect('/login');
  }

  if (mode === 'deactivate') {
    await deactivateOrganization(locals.db, locals.tenantId);
  }

  return redirect('/');
};
