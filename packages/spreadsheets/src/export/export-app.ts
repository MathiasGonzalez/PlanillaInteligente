/// <reference path="../xlsx-populate.d.ts" />
import XlsxPopulate from 'xlsx-populate';
import { and, asc, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { apps, records, workbooks } from '@planilla/cloudflare/d1/schema';
import type * as schema from '@planilla/cloudflare/d1/schema';
import { getObject } from '@planilla/cloudflare/r2';
import { toMatrix } from '../parsing/matrix';

export interface ExportSpec {
  entities: Array<{
    key: string;
    name: string;
    sourceSheet: string | null;
    primaryFieldKey: string | null;
    fields: Array<{ key: string; label: string; type: string; sensitive: boolean; specialCategory: boolean }>;
  }>;
  relations: Array<{ fromEntity: string; fieldKey: string; toEntity: string }>;
}

type Database = DrizzleD1Database<typeof schema>;

function cellValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

async function toBytes(value: Uint8Array | ArrayBuffer | Blob) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(value);
}

export async function exportAppWorkbook(params: {
  db: Database;
  tenantId: string;
  appId: string;
  spec: ExportSpec;
  bucket: R2Bucket;
}) {
  const [app] = await params.db.select().from(apps).where(and(eq(apps.id, params.appId), eq(apps.tenantId, params.tenantId))).limit(1);
  if (!app) throw new Error('App not found.');
  const allRows = await params.db.select().from(records).where(and(eq(records.tenantId, params.tenantId), eq(records.appId, params.appId))).orderBy(asc(records.sourceRowIndex));
  const byId = new Map(allRows.map((row) => [row.id, row]));
  let workbook: Awaited<ReturnType<typeof XlsxPopulate.fromBlankAsync>>;
  if (app.workbookId) {
    const [stored] = await params.db.select({ r2Key: workbooks.r2Key, originalFilename: workbooks.originalFilename }).from(workbooks).where(and(eq(workbooks.id, app.workbookId), eq(workbooks.tenantId, params.tenantId))).limit(1);
    const file = stored ? await getObject(params.bucket, stored.r2Key) : null;
    workbook = file ? await XlsxPopulate.fromDataAsync(await file.arrayBuffer()) : await XlsxPopulate.fromBlankAsync();
  } else {
    workbook = await XlsxPopulate.fromBlankAsync();
  }
  params.spec.entities.forEach((entity, index) => {
    const sheetName = (entity.sourceSheet ?? entity.name).slice(0, 31) || `Hoja${index + 1}`;
    const sheet = workbook.sheet(sheetName) ?? (index === 0 && workbook.sheets()[0] ? workbook.sheets()[0] : undefined) ?? workbook.addSheet(sheetName);
    const fields = entity.fields.filter((field) => !field.sensitive && !field.specialCategory);
    const header = fields.map((field) => field.label);
    const body = allRows.filter((row) => row.entityKey === entity.key).map((row) => fields.map((field) => {
      const value = row.data[field.key];
      if (field.type === 'relation' && typeof value === 'string') {
        const target = byId.get(value);
        const relation = params.spec.relations.find((item) => item.fromEntity === entity.key && item.fieldKey === field.key);
        const targetEntity = params.spec.entities.find((item) => item.key === relation?.toEntity);
        const primary = targetEntity?.primaryFieldKey;
        if (target && primary) return cellValue(target.data[primary]);
      }
      return cellValue(value);
    }));
    const matrix = [header, ...body];
    const previous = toMatrix(sheet.usedRange()?.value());
    sheet.cell(1, 1).value(matrix);
    for (let rowNumber = matrix.length + 1; rowNumber <= previous.length; rowNumber += 1) {
      for (let column = 1; column <= Math.max(header.length, previous[0]?.length ?? 0); column += 1) {
        sheet.cell(rowNumber, column).value(null);
      }
    }
  });
  const buffer = await workbook.outputAsync({ type: 'uint8array' });
  return {
    filename: `${app.name || 'app'}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: await toBytes(buffer),
  };
}
