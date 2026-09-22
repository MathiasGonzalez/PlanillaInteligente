import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { apps, workbooks } from '@planilla/cloudflare/d1/schema';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.user || !locals.tenantId) return redirect('/login');
  const formData = await request.formData();
  const appId = formData.get('appId')?.toString().trim();
  const allow = formData.get('allow')?.toString() === 'true';
  if (!appId) return redirect('/');
  const [app] = await locals.db.select({ workbookId: apps.workbookId }).from(apps).where(and(eq(apps.id, appId), eq(apps.tenantId, locals.tenantId))).limit(1);
  if (!app?.workbookId) return redirect('/');
  const now = new Date();
  await locals.db.update(workbooks).set({
    sampleConsentAt: allow ? now : null,
    sampleConsentByUserId: allow ? locals.user.id : null,
    updatedAt: now,
  }).where(and(eq(workbooks.id, app.workbookId), eq(workbooks.tenantId, locals.tenantId)));
  return redirect(`/apps/${appId}/setup`);
};
