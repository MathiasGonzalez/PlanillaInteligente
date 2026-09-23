import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { apps, workbooks } from '@planilla/cloudflare/d1/schema';
import { ownerSession, requireUser } from '../../../lib/access';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const session = ownerSession(locals);
  if (!session.ok) return redirect(requireUser(locals) ? '/' : '/login');
  const formData = await request.formData();
  const appId = formData.get('appId')?.toString().trim();
  const allow = formData.get('allow')?.toString() === 'true';
  if (!appId) return redirect('/');
  const [app] = await locals.db.select({ workbookId: apps.workbookId }).from(apps).where(and(eq(apps.id, appId), eq(apps.tenantId, session.tenantId))).limit(1);
  if (!app?.workbookId) return redirect('/');
  const now = new Date();
  await locals.db.update(workbooks).set({
    sampleConsentAt: allow ? now : null,
    sampleConsentByUserId: allow ? session.user.id : null,
    updatedAt: now,
  }).where(and(eq(workbooks.id, app.workbookId), eq(workbooks.tenantId, session.tenantId)));
  return redirect(`/apps/${appId}/setup`);
};
