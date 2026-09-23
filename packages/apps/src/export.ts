import { and, asc, eq } from 'drizzle-orm';
import { records, workbooks } from '@planilla/cloudflare/d1/schema';
import { getObject } from '@planilla/cloudflare/r2';
import { buildWorkbookXlsx, type ExportSpec } from '@planilla/spreadsheets/export/export-app';
import type { AppSpec } from './spec';
import type { Database } from './db';
import { loadApp } from './records';

function toExportSpec(spec: AppSpec): ExportSpec {
  return {
    entities: spec.entities.map((entity) => ({
      key: entity.key,
      name: entity.name,
      sourceSheet: entity.sourceSheet,
      primaryFieldKey: entity.primaryFieldKey,
      fields: entity.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        sensitive: field.sensitive,
        specialCategory: field.specialCategory,
      })),
    })),
    relations: spec.relations.map((relation) => ({
      fromEntity: relation.fromEntity,
      fieldKey: relation.fieldKey,
      toEntity: relation.toEntity,
    })),
  };
}

export async function exportAppWorkbook(params: {
  db: Database;
  tenantId: string;
  appId: string;
  spec: AppSpec;
  bucket: R2Bucket;
}) {
  const app = await loadApp(params.db, params.tenantId, params.appId);
  if (!app) throw new Error('App not found.');
  const allRows = await params.db.select({
    id: records.id,
    entityKey: records.entityKey,
    data: records.data,
  }).from(records).where(and(eq(records.tenantId, params.tenantId), eq(records.appId, params.appId))).orderBy(asc(records.sourceRowIndex));
  let templateBytes: ArrayBuffer | null = null;
  if (app.workbookId) {
    const [stored] = await params.db.select({ r2Key: workbooks.r2Key }).from(workbooks).where(and(eq(workbooks.id, app.workbookId), eq(workbooks.tenantId, params.tenantId))).limit(1);
    const file = stored ? await getObject(params.bucket, stored.r2Key) : null;
    templateBytes = file ? await file.arrayBuffer() : null;
  }
  return buildWorkbookXlsx({
    spec: toExportSpec(params.spec),
    rows: allRows,
    templateBytes,
    filename: `${app.name || 'app'}.xlsx`,
  });
}
