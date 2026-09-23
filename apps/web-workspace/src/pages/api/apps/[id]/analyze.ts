import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { apps, workbooks } from '@planilla/cloudflare/d1/schema';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { missingParams, ownerSession, requireUser } from '../../../../lib/access';
import { json } from '../../../../app/http/responses';
import { scheduleAppJob } from '@planilla/apps/jobs';

export const POST: APIRoute = async ({ locals, params, redirect }) => {
  const session = ownerSession(locals);
  if (!session.ok) return redirect(requireUser(locals) ? '/' : '/login');
  if (!params.id) return missingParams();
  const [app] = await locals.db.select().from(apps).where(and(eq(apps.id, params.id), eq(apps.tenantId, session.tenantId))).limit(1);
  if (!app?.workbookId) return redirect('/');
  await locals.db.update(workbooks).set({ analysisStatus: 'pending', analysisError: null, updatedAt: new Date() }).where(and(eq(workbooks.id, app.workbookId), eq(workbooks.tenantId, session.tenantId)));
  await scheduleAppJob(locals.db, cloudflareEnv, {
    kind: 'analyze',
    tenantId: session.tenantId,
    appId: app.id,
    refId: app.workbookId,
    requestedByUserId: session.user.id,
  });
  return json({ ok: true });
};
