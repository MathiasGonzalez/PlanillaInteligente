import { and, eq } from 'drizzle-orm';
import type { APIRoute } from 'astro';
import { apps, records, workbooks } from '@planilla/cloudflare/d1/schema';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { putObject, deleteObject } from '@planilla/cloudflare/r2';
import { fail, json } from '../app/http/responses';
import { parseWorkbook } from '@planilla/spreadsheets/parsing/parse-workbook';
import { assertXlsxContainer, WorkbookValidationError } from '@planilla/spreadsheets/parsing/validate-workbook';
import { requireOwner } from '../lib/access';
import { insertImportedRecords } from '@planilla/apps/records';
import { scheduleAppJob } from '@planilla/apps/jobs';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export const POST: APIRoute = async ({ request, locals }) => {
  const session = requireOwner(locals);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  const formData = await request.formData();
  const uploadedFile = formData.get('file');
  if (!(uploadedFile instanceof File) || !uploadedFile.name.toLowerCase().endsWith('.xlsx')) {
    return json({ error: 'A .xlsx file is required.' }, 400);
  }
  const arrayBuffer = await uploadedFile.arrayBuffer();
  try {
    assertXlsxContainer(arrayBuffer);
  } catch (error) {
    if (error instanceof WorkbookValidationError) return json({ error: error.message }, 400);
    return json({ error: 'The file is not a valid .xlsx workbook.' }, 400);
  }
  const workbookId = crypto.randomUUID();
  const appId = crypto.randomUUID();
  const r2Key = `${session.tenantId}/workbooks/${workbookId}.xlsx`;
  try {
    const parsed = parseWorkbook(arrayBuffer);
    await putObject(cloudflareEnv.BUCKET, r2Key, arrayBuffer, { contentType: uploadedFile.type || XLSX_CONTENT_TYPE });
    await locals.db.insert(workbooks).values({
      id: workbookId,
      tenantId: session.tenantId,
      uploadedByUserId: session.user.id,
      originalFilename: uploadedFile.name,
      r2Key,
      checksum: await sha256Hex(arrayBuffer),
      sheetCount: (await parsed).sheets.length,
      analysisStatus: 'pending',
    });
    const workbook = await parsed;
    await locals.db.insert(apps).values({
      id: appId,
      tenantId: session.tenantId,
      workbookId,
      name: uploadedFile.name.replace(/\.xlsx$/i, ''),
      status: 'draft',
      currentVersion: 0,
      createdByUserId: session.user.id,
    });
    await insertImportedRecords(locals.db, {
      tenantId: session.tenantId,
      appId,
      userId: session.user.id,
      sheets: workbook.sheets,
    });
    const scheduled = await scheduleAppJob(locals.db, cloudflareEnv, {
      kind: 'analyze',
      tenantId: session.tenantId,
      appId,
      refId: workbookId,
      requestedByUserId: session.user.id,
    });
    return json({ appId, workbookId, mode: scheduled.mode, sheets: workbook.sheets.length }, 201);
  } catch (error) {
    try {
      await Promise.all([
        deleteObject(cloudflareEnv.BUCKET, r2Key),
        locals.db.delete(records).where(and(eq(records.tenantId, session.tenantId), eq(records.appId, appId))),
        locals.db.delete(apps).where(and(eq(apps.tenantId, session.tenantId), eq(apps.id, appId))),
        locals.db.delete(workbooks).where(and(eq(workbooks.tenantId, session.tenantId), eq(workbooks.id, workbookId))),
      ]);
    } catch {
      // The original error is the one returned to the client.
    }
    if (error instanceof WorkbookValidationError) return json({ error: error.message }, 400);
    return fail(500);
  }
};
