import { and, eq } from 'drizzle-orm';
import { apps, records, workbooks } from '@planilla/cloudflare/d1/schema';
import { putObject, deleteObject } from '@planilla/cloudflare/r2';
import { parseWorkbook } from '@planilla/spreadsheets/parsing/parse-workbook';
import { insertImportedRecords } from './records';
import { scheduleAppJob, type AppJobMessage } from './jobs';
import { assertRecordQuota, assertStorageQuota } from './usage';
import type { AiEnv, Database } from './db';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type QueueBinding<T> = { send(message: T): Promise<void> };

export type ImportEnv = AiEnv & {
  ENRICHMENT_QUEUE?: QueueBinding<AppJobMessage>;
  ANALYSIS_MODE?: string;
  BUCKET: R2Bucket;
};

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function importWorkbook(
  db: Database,
  env: ImportEnv,
  params: { tenantId: string; userId: string; filename: string; contentType?: string; arrayBuffer: ArrayBuffer },
) {
  const workbookId = crypto.randomUUID();
  const appId = crypto.randomUUID();
  const r2Key = `${params.tenantId}/workbooks/${workbookId}.xlsx`;
  try {
    const workbook = await parseWorkbook(params.arrayBuffer);
    const extraRecords = workbook.sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
    await assertStorageQuota(db, params.tenantId, params.arrayBuffer.byteLength);
    await assertRecordQuota(db, params.tenantId, extraRecords);
    await putObject(env.BUCKET, r2Key, params.arrayBuffer, { contentType: params.contentType || XLSX_CONTENT_TYPE });
    await db.insert(workbooks).values({
      id: workbookId,
      tenantId: params.tenantId,
      uploadedByUserId: params.userId,
      originalFilename: params.filename,
      r2Key,
      byteSize: params.arrayBuffer.byteLength,
      checksum: await sha256Hex(params.arrayBuffer),
      sheetCount: workbook.sheets.length,
      analysisStatus: 'pending',
    });
    await db.insert(apps).values({
      id: appId,
      tenantId: params.tenantId,
      workbookId,
      name: params.filename.replace(/\.xlsx$/i, ''),
      status: 'draft',
      currentVersion: 0,
      createdByUserId: params.userId,
    });
    await insertImportedRecords(db, {
      tenantId: params.tenantId,
      appId,
      userId: params.userId,
      sheets: workbook.sheets,
    });
    const scheduled = await scheduleAppJob(db, env, {
      kind: 'analyze',
      tenantId: params.tenantId,
      appId,
      refId: workbookId,
      requestedByUserId: params.userId,
    });
    return { appId, workbookId, mode: scheduled.mode, sheets: workbook.sheets.length };
  } catch (error) {
    try {
      await Promise.all([
        deleteObject(env.BUCKET, r2Key),
        db.delete(records).where(and(eq(records.tenantId, params.tenantId), eq(records.appId, appId))),
        db.delete(apps).where(and(eq(apps.tenantId, params.tenantId), eq(apps.id, appId))),
        db.delete(workbooks).where(and(eq(workbooks.tenantId, params.tenantId), eq(workbooks.id, workbookId))),
      ]);
    } catch {
      // The original error is the one returned to the caller.
    }
    throw error;
  }
}
