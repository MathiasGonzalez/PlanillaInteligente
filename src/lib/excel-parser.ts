import XlsxPopulate from 'xlsx-populate';
import { spreadsheetColumns, rowEntries } from '../db/schema';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from '../db/schema';
import { toMatrix } from './spreadsheet-matrix';

export type SpreadsheetColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json';

export interface ParsedSpreadsheetSummary {
  sheetName: string;
  columnsCount: number;
  rowsCount: number;
}

interface ParseSpreadsheetOptions {
  arrayBuffer: ArrayBuffer;
  db: DrizzleD1Database<typeof schema>;
  tenantId: string;
  spreadsheetId: string;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function slugifyHeader(value: string, index: number, seen: Map<string, number>) {
  const base = value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `column_${index + 1}`;
  const occurrence = (seen.get(base) ?? 0) + 1;
  seen.set(base, occurrence);

  return occurrence === 1 ? base : `${base}_${occurrence}`;
}

function normalizeCellValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCellValue(item));
  }

  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }

    if ('result' in value && value.result !== undefined) {
      return normalizeCellValue(value.result);
    }

    if ('hyperlink' in value && typeof value.hyperlink === 'string') {
      return value.hyperlink;
    }

    if ('formula' in value && typeof value.formula === 'string') {
      return `=${value.formula}`;
    }

    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }

  return String(value);
}

function inferColumnType(samples: unknown[]): SpreadsheetColumnType {
  const meaningfulSamples = samples.filter((sample) => sample !== null && sample !== '');

  if (meaningfulSamples.length === 0) {
    return 'string';
  }

  if (meaningfulSamples.every((sample) => typeof sample === 'boolean')) {
    return 'boolean';
  }

  if (meaningfulSamples.every((sample) => typeof sample === 'number')) {
    return 'number';
  }

  if (
    meaningfulSamples.every(
      (sample) => typeof sample === 'string' && !Number.isNaN(Date.parse(sample)) && sample.includes('T'),
    )
  ) {
    return 'date';
  }

  if (meaningfulSamples.some((sample) => typeof sample === 'object')) {
    return 'json';
  }

  return 'string';
}

export async function parseWorkbookIntoDatabase({
  arrayBuffer,
  db,
  tenantId,
  spreadsheetId,
}: ParseSpreadsheetOptions): Promise<ParsedSpreadsheetSummary> {
  const workbook = await XlsxPopulate.fromDataAsync(arrayBuffer);
  const worksheet = workbook.sheet(0);
  if (!worksheet) {
    throw new Error('The workbook must contain at least one worksheet.');
  }

  const matrix = toMatrix(worksheet.usedRange()?.value());
  const widestRowLength = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  if (widestRowLength === 0) {
    throw new Error('The worksheet must contain at least one header row.');
  }

  const headerRow = matrix[0] ?? [];
  const seenHeaders = new Map<string, number>();
  const headers = Array.from({ length: widestRowLength }, (_, index) => {
    const rawValue = normalizeCellValue(headerRow[index]);
    const label = typeof rawValue === 'string' && rawValue.trim() ? rawValue.trim() : `Column ${index + 1}`;

    return {
      key: slugifyHeader(label, index, seenHeaders),
      label,
      columnIndex: index,
    };
  });

  const samples = headers.map(() => [] as unknown[]);
  const rowsToInsert: Array<{ id: string; tenantId: string; spreadsheetId: string; rowIndex: number; data: Record<string, unknown> }> = [];

  for (let rowNumber = 1; rowNumber < matrix.length; rowNumber += 1) {
    const row = matrix[rowNumber] ?? [];
    const data: Record<string, unknown> = {};
    let hasValues = false;

    headers.forEach((header, index) => {
      const normalizedValue = normalizeCellValue(row[index]);
      samples[index].push(normalizedValue);
      data[header.key] = normalizedValue;

      if (normalizedValue !== null && normalizedValue !== '') {
        hasValues = true;
      }
    });

    if (hasValues) {
      rowsToInsert.push({
        id: crypto.randomUUID(),
        tenantId,
        spreadsheetId,
        rowIndex: rowNumber - 1,
        data,
      });
    }
  }

  const columnsToInsert = headers.map((header, index) => ({
    id: crypto.randomUUID(),
    tenantId,
    spreadsheetId,
    key: header.key,
    label: header.label,
    dataType: inferColumnType(samples[index]),
    columnIndex: header.columnIndex,
    required: false,
  }));

  if (columnsToInsert.length > 0) {
    await db.insert(spreadsheetColumns).values(columnsToInsert);
  }

  for (const rowChunk of chunk(rowsToInsert, 50)) {
    await db.insert(rowEntries).values(rowChunk);
  }

  return {
    sheetName: worksheet.name(),
    columnsCount: columnsToInsert.length,
    rowsCount: rowsToInsert.length,
  };
}
