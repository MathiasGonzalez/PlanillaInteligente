import type { APIRoute } from 'astro';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { fail, json } from '../app/http/responses';
import { assertXlsxContainer, WorkbookValidationError } from '@planilla/spreadsheets/parsing/validate-workbook';
import { importWorkbook } from '@planilla/apps/import';
import { WorkspaceQuotaError } from '@planilla/apps/usage';
import { ownerSession } from '../lib/access';

export const POST: APIRoute = async ({ request, locals }) => {
  const session = ownerSession(locals);
  if (!session.ok) return session.response;
  const formData = await request.formData();
  const uploadedFile = formData.get('file');
  if (!(uploadedFile instanceof File) || !uploadedFile.name.toLowerCase().endsWith('.xlsx')) {
    return json({ error: 'A .xlsx file is required.' }, 400);
  }
  const arrayBuffer = await uploadedFile.arrayBuffer();
  try {
    assertXlsxContainer(arrayBuffer);
    const result = await importWorkbook(locals.db, cloudflareEnv, {
      tenantId: session.tenantId,
      userId: session.user.id,
      filename: uploadedFile.name,
      contentType: uploadedFile.type,
      arrayBuffer,
    });
    return json(result, 201);
  } catch (error) {
    if (error instanceof WorkbookValidationError) return json({ error: error.message }, 400);
    if (error instanceof WorkspaceQuotaError) return json({ error: error.message }, 403);
    return fail(500);
  }
};
