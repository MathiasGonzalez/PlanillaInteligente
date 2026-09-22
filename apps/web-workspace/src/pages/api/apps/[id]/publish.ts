import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { apps } from '@planilla/cloudflare/d1/schema';
import { requireOwner } from '../../../../lib/access';
import { fail, json } from '../../../../app/http/responses';
import { loadSpec, resolveRelations } from '@planilla/apps/records';

export const POST: APIRoute = async ({ locals, params }) => {
  const session = requireOwner(locals);
  if (!session || !params.id) return json({ error: 'Unauthorized' }, 401);
  const spec = await loadSpec(locals.db, session.tenantId, params.id);
  if (!spec) return json({ error: 'Not found' }, 404);
  try {
    const unmatched = await resolveRelations(locals.db, session.tenantId, params.id, spec);
    await locals.db.update(apps).set({ status: 'published', updatedAt: new Date() }).where(and(eq(apps.id, params.id), eq(apps.tenantId, session.tenantId)));
    return json({ status: 'published', unmatched });
  } catch {
    return fail(500);
  }
};
