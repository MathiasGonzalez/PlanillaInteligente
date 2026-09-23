import type { APIRoute } from 'astro';
import { and, desc, eq } from 'drizzle-orm';
import { appChangeProposals, workbooks, apps } from '@planilla/cloudflare/d1/schema';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { missingParams, ownerSession } from '../../../../lib/access';
import { fail, json } from '../../../../app/http/responses';
import { createProposal } from '@planilla/apps/evolution';
import { WorkspaceQuotaError } from '@planilla/apps/usage';

export const GET: APIRoute = async ({ locals, params }) => {
  const session = ownerSession(locals);
  if (!session.ok) return session.response;
  if (!params.id) return missingParams();
  const rows = await locals.db.select().from(appChangeProposals).where(and(
    eq(appChangeProposals.tenantId, session.tenantId),
    eq(appChangeProposals.appId, params.id),
  )).orderBy(desc(appChangeProposals.createdAt)).limit(20);
  return json({ proposals: rows });
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  const session = ownerSession(locals);
  if (!session.ok) return session.response;
  if (!params.id) return missingParams();
  const body = await request.json().catch(() => null) as { instruction?: string } | null;
  const instruction = body?.instruction?.trim();
  if (!instruction) return json({ error: 'Falta la instrucción.' }, 400);
  const [app] = await locals.db.select({ workbookId: apps.workbookId }).from(apps).where(and(eq(apps.id, params.id), eq(apps.tenantId, session.tenantId))).limit(1);
  const [workbook] = app?.workbookId
    ? await locals.db.select({ sampleConsentAt: workbooks.sampleConsentAt }).from(workbooks).where(and(eq(workbooks.id, app.workbookId), eq(workbooks.tenantId, session.tenantId))).limit(1)
    : [];
  try {
    const result = await createProposal(locals.db, cloudflareEnv, {
      tenantId: session.tenantId,
      appId: params.id,
      userId: session.user.id,
      instruction,
      allowSamples: workbook?.sampleConsentAt != null,
    });
    return json(result, result.status === 'rejected' ? 422 : 201);
  } catch (error) {
    if (error instanceof WorkspaceQuotaError) return json({ error: error.message }, 403);
    return fail(500);
  }
};
