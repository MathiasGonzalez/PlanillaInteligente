import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { apps, workbooks } from '@planilla/cloudflare/d1/schema';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { requireOwner } from '../../../../lib/access';
import { json } from '../../../../app/http/responses';
import { scheduleAppJob } from '@planilla/apps/jobs';

export const POST: APIRoute = async ({ locals, params, redirect }) => {
  const session = requireOwner(locals);
  if (!session || !params.id) return redirect('/login');
  const [app] = await locals.db.select().from(apps).where(and(eq(apps.id, params.id), eq(apps.tenantId, session.tenantId))).limit(1);
  if (!app?.workbookId) return redirect('/');
  await locals.db.update(workbooks).set({ analysisStatus: 'pending', analysisError: null, updatedAt: new Date() }).where(eq(workbooks.id, app.workbookId));
  await scheduleAppJob(locals.db, cloudflareEnv, {
    kind: 'analyze',
    tenantId: session.tenantId,
    appId: app.id,
    refId: app.workbookId,
    requestedByUserId: session.user.id,
  });
  return json({ ok: true });
};
