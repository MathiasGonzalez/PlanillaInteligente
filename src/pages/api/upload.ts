import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { rowEntries, spreadsheetColumns, spreadsheets } from '../../db/schema';
import { parseWorkbookIntoDatabase } from '../../lib/excel-parser';
import { verifyTurnstileToken } from '../../lib/turnstile';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type RuntimeLocals = App.Locals & {
  runtime: { env: Env };
};

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);

  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const runtimeLocals = locals as RuntimeLocals;

  if (!runtimeLocals.user || !runtimeLocals.tenantId) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const formData = await request.formData();
  const turnstileToken =
    formData.get('turnstileToken')?.toString() ?? formData.get('cf-turnstile-response')?.toString() ?? '';

  const verification = await verifyTurnstileToken({
    token: turnstileToken,
    secretKey: runtimeLocals.runtime.env.TURNSTILE_SECRET_KEY,
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
  const r2Key = `${runtimeLocals.tenantId}/spreadsheets/${spreadsheetId}.xlsx`;

  await runtimeLocals.runtime.env.BUCKET.put(r2Key, arrayBuffer, {
    httpMetadata: {
      contentType: uploadedFile.type || XLSX_CONTENT_TYPE,
    },
  });

  await runtimeLocals.db.insert(spreadsheets).values({
    id: spreadsheetId,
    tenantId: runtimeLocals.tenantId,
    uploadedByUserId: runtimeLocals.user.id,
    name: uploadedFile.name.replace(/\.xlsx$/i, ''),
    originalFilename: uploadedFile.name,
    r2Key,
    sourceType: 'excel',
    checksum,
  });

  try {
    const summary = await parseWorkbookIntoDatabase({
      arrayBuffer,
      db: runtimeLocals.db,
      tenantId: runtimeLocals.tenantId,
      spreadsheetId,
    });

    await runtimeLocals.db
      .update(spreadsheets)
      .set({
        sheetName: summary.sheetName,
        updatedAt: new Date(),
      })
      .where(eq(spreadsheets.id, spreadsheetId));

    return json({
      spreadsheetId,
      tenantId: runtimeLocals.tenantId,
      r2Key,
      ...summary,
    }, 201);
  } catch (error) {
    await Promise.all([
      runtimeLocals.runtime.env.BUCKET.delete(r2Key),
      runtimeLocals.db.delete(rowEntries).where(eq(rowEntries.spreadsheetId, spreadsheetId)),
      runtimeLocals.db.delete(spreadsheetColumns).where(eq(spreadsheetColumns.spreadsheetId, spreadsheetId)),
      runtimeLocals.db.delete(spreadsheets).where(eq(spreadsheets.id, spreadsheetId)),
    ]);

    return json(
      {
        error: error instanceof Error ? error.message : 'Workbook import failed.',
      },
      500,
    );
  }
};
