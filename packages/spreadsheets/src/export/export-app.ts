/// <reference path="../xlsx-populate.d.ts" />
import XlsxPopulate from 'xlsx-populate';
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

export interface ExportRow {
  id: string;
  entityKey: string;
  data: Record<string, unknown>;
}

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

export async function buildWorkbookXlsx(params: {
  spec: ExportSpec;
  rows: ExportRow[];
  templateBytes?: ArrayBuffer | Uint8Array | null;
  filename: string;
}) {
  const byId = new Map(params.rows.map((row) => [row.id, row]));
  const workbook = params.templateBytes
    ? await XlsxPopulate.fromDataAsync(params.templateBytes)
    : await XlsxPopulate.fromBlankAsync();
  params.spec.entities.forEach((entity, index) => {
    const sheetName = (entity.sourceSheet ?? entity.name).slice(0, 31) || `Hoja${index + 1}`;
    const sheet = workbook.sheet(sheetName) ?? (index === 0 && workbook.sheets()[0] ? workbook.sheets()[0] : undefined) ?? workbook.addSheet(sheetName);
    const fields = entity.fields.filter((field) => !field.sensitive && !field.specialCategory);
    const header = fields.map((field) => field.label);
    const body = params.rows.filter((row) => row.entityKey === entity.key).map((row) => fields.map((field) => {
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
    const columnsToClear = Math.max(header.length, previous[0]?.length ?? 0);
    sheet.cell(1, 1).value(matrix);
    for (let rowNumber = 1; rowNumber <= Math.max(matrix.length, previous.length); rowNumber += 1) {
      const startColumn = rowNumber <= matrix.length ? header.length + 1 : 1;
      for (let column = startColumn; column <= columnsToClear; column += 1) {
        sheet.cell(rowNumber, column).value(null);
      }
    }
  });
  const buffer = await workbook.outputAsync({ type: 'uint8array' });
  return {
    filename: params.filename.endsWith('.xlsx') ? params.filename : `${params.filename}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: await toBytes(buffer),
  };
}
