import { and, eq } from 'drizzle-orm';
import type { APIRoute } from 'astro';
import { rowEntries, spreadsheetColumns, spreadsheetEnrichments, spreadsheets } from '@planilla/cloudflare/d1/schema';
import { verifyTurnstileToken } from '../lib/turnstile';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { putObject, deleteObject } from '@planilla/cloudflare/r2';
import { json } from '../app/http/responses';
import { parseWorkbookIntoDatabase } from '@planilla/spreadsheets/parsing/parse-workbook';
import { scheduleSpreadsheetEnrichment } from '@planilla/spreadsheets/enrichment/service';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);

  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  if (!locals.user || !locals.tenantId) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const formData = await request.formData();
  const turnstileToken =
    formData.get('turnstileToken')?.toString() ?? formData.get('cf-turnstile-response')?.toString() ?? '';

  const verification = await verifyTurnstileToken({
    token: turnstileToken,
    secretKey: cloudflareEnv.TURNSTILE_SECRET_KEY,
    remoteIp: clientAddress,
    idempotencyKey: crypto.randomUUID(),
  });

  if (!verification.success) {
    return json({ error: 'Turnstile validation failed', details: verification.errorCodes }, 400);
  }

  const uploadedFile = formData.get('file');
  if (!(uploadedFile instanceof File)) {
    return json({ error: 'A .xlsx file is required.' }, 400);
  }

  if (!uploadedFile.name.toLowerCase().endsWith('.xlsx')) {
    return json({ error: 'Only .xlsx workbooks are supported in this endpoint.' }, 400);
  }

  const arrayBuffer = await uploadedFile.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    return json({ error: 'The uploaded file is empty.' }, 400);
  }

  const checksum = await sha256Hex(arrayBuffer);
  const spreadsheetId = crypto.randomUUID();
  const r2Key = `${locals.tenantId}/spreadsheets/${spreadsheetId}.xlsx`;

  try {
    await putObject(cloudflareEnv.BUCKET, r2Key, arrayBuffer, { contentType: uploadedFile.type || XLSX_CONTENT_TYPE });

    await locals.db.insert(spreadsheets).values({
      id: spreadsheetId,
      tenantId: locals.tenantId,
      uploadedByUserId: locals.user.id,
      name: uploadedFile.name.replace(/\.xlsx$/i, ''),
      originalFilename: uploadedFile.name,
      r2Key,
      sourceType: 'excel',
      checksum,
    });

    const summary = await parseWorkbookIntoDatabase({
      arrayBuffer,
      db: locals.db,
      tenantId: locals.tenantId,
      spreadsheetId,
    });

    await locals.db
      .update(spreadsheets)
      .set({
        sheetName: summary.sheetName,
        updatedAt: new Date(),
      })
      .where(and(eq(spreadsheets.tenantId, locals.tenantId), eq(spreadsheets.id, spreadsheetId)));

    const enrichment = await scheduleSpreadsheetEnrichment({
      db: locals.db,
      env: cloudflareEnv,
      tenantId: locals.tenantId,
      spreadsheetId,
      requestedByUserId: locals.user.id,
      triggeredBy: 'upload',
    });

    return json({
      spreadsheetId,
      tenantId: locals.tenantId,
      r2Key,
      enrichment: {
        status: enrichment.status,
        mode: enrichment.mode,
        generatedBy: enrichment.generatedBy,
        model: enrichment.model,
        fallbackUsed: enrichment.fallbackUsed,
        errorMessage: enrichment.errorMessage,
      },
      ...summary,
    }, 201);
  } catch (error) {
    try {
      await Promise.all([
        deleteObject(cloudflareEnv.BUCKET, r2Key),
        locals.db.delete(rowEntries).where(and(eq(rowEntries.tenantId, locals.tenantId), eq(rowEntries.spreadsheetId, spreadsheetId))),
        locals.db.delete(spreadsheetColumns).where(and(eq(spreadsheetColumns.tenantId, locals.tenantId), eq(spreadsheetColumns.spreadsheetId, spreadsheetId))),
        locals.db.delete(spreadsheetEnrichments).where(and(eq(spreadsheetEnrichments.tenantId, locals.tenantId), eq(spreadsheetEnrichments.spreadsheetId, spreadsheetId))),
        locals.db.delete(spreadsheets).where(and(eq(spreadsheets.tenantId, locals.tenantId), eq(spreadsheets.id, spreadsheetId))),
      ]);
    } catch {
      // Ignore cleanup failures so the upload endpoint still returns the original error response.
    }

    return json(
      {
        error: error instanceof Error ? error.message : 'Workbook import failed.',
      },
      500,
    );
  }
};
