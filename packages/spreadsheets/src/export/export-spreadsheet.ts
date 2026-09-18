/// <reference path="../xlsx-populate.d.ts" />
import XlsxPopulate from 'xlsx-populate';
import { and, asc, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { rowEntries, spreadsheetColumns, spreadsheets } from '@planilla/cloudflare/d1/schema';
import type * as schema from '@planilla/cloudflare/d1/schema';
import { getObject } from '@planilla/cloudflare/r2';
import { toMatrix } from '../parsing/matrix';

interface ExportSpreadsheetOptions {
  db: DrizzleD1Database<typeof schema>;
  tenantId: string;
  spreadsheetId: string;
  bucket: R2Bucket;
}

function toWorksheetValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value) || (typeof value === 'object' && !(value instanceof Date))) {
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    const parsedDate = Date.parse(value);
    if (!Number.isNaN(parsedDate) && value.includes('T')) {
      return new Date(parsedDate);
    }
  }

  return value as string | number | boolean | Date;
}

async function toUint8Array(value: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }

  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }

  return new Uint8Array(value);
}

export async function exportSpreadsheetFromDatabase({
  db,
  tenantId,
  spreadsheetId,
  bucket,
}: ExportSpreadsheetOptions) {
  const [spreadsheet] = await db
    .select({
      r2Key: spreadsheets.r2Key,
      sheetName: spreadsheets.sheetName,
      originalFilename: spreadsheets.originalFilename,
    })
    .from(spreadsheets)
    .where(and(eq(spreadsheets.id, spreadsheetId), eq(spreadsheets.tenantId, tenantId)))
    .limit(1);

  if (!spreadsheet) {
    throw new Error('Spreadsheet not found for the active tenant.');
  }

  const templateFile = await getObject(bucket, spreadsheet.r2Key);
  if (!templateFile) {
    throw new Error('The base workbook could not be found in R2.');
  }

  const [columns, rows, workbookBuffer] = await Promise.all([
    db
      .select({
        key: spreadsheetColumns.key,
        label: spreadsheetColumns.label,
        columnIndex: spreadsheetColumns.columnIndex,
      })
      .from(spreadsheetColumns)
      .where(and(eq(spreadsheetColumns.tenantId, tenantId), eq(spreadsheetColumns.spreadsheetId, spreadsheetId)))
      .orderBy(asc(spreadsheetColumns.columnIndex)),
    db
      .select({
        rowIndex: rowEntries.rowIndex,
        data: rowEntries.data,
      })
      .from(rowEntries)
      .where(and(eq(rowEntries.tenantId, tenantId), eq(rowEntries.spreadsheetId, spreadsheetId)))
      .orderBy(asc(rowEntries.rowIndex)),
    templateFile.arrayBuffer(),
  ]);

  const workbook = await XlsxPopulate.fromDataAsync(workbookBuffer);

  const worksheet = spreadsheet.sheetName ? workbook.sheet(spreadsheet.sheetName) ?? workbook.sheet(0) : workbook.sheet(0);

  if (!worksheet) {
    throw new Error('The workbook template does not contain a worksheet.');
  }

  const existingMatrix = toMatrix(worksheet.usedRange()?.value());
  const headerValues = columns.map((column) => column.label);
  const nextRows = rows.map((row) =>
    columns.map((column) => toWorksheetValue((row.data as Record<string, unknown>)[column.key] ?? null)),
  );
  const nextMatrix = [headerValues, ...nextRows];

  worksheet.cell(1, 1).value(nextMatrix);
  const previousRowCount = existingMatrix.length;
  const previousColumnCount = existingMatrix.reduce((max, row) => Math.max(max, row.length), 0);
  const nextColumnCount = Math.max(headerValues.length, ...nextRows.map((row) => row.length), 0);

  for (let rowNumber = nextMatrix.length + 1; rowNumber <= previousRowCount; rowNumber += 1) {
    for (let columnNumber = 1; columnNumber <= Math.max(previousColumnCount, nextColumnCount); columnNumber += 1) {
      worksheet.cell(rowNumber, columnNumber).value(null);
    }
  }

  const buffer = await workbook.outputAsync({ type: 'uint8array' });

  return {
    filename: spreadsheet.originalFilename,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: await toUint8Array(buffer),
  };
}
