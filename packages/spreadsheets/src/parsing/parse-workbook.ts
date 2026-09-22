/// <reference path="../xlsx-populate.d.ts" />
import XlsxPopulate from 'xlsx-populate';
import { toMatrix } from './matrix';

export const PARSED_FIELD_TYPES = [
  'text', 'long-text', 'number', 'amount', 'date', 'boolean', 'email', 'phone', 'url',
  'status', 'category', 'identifier', 'relation', 'computed',
] as const;
export type ParsedFieldType = (typeof PARSED_FIELD_TYPES)[number];
import { assertWorkbookShape, MAX_XLSX_SHEETS, WorkbookValidationError } from './validate-workbook';

export interface ParsedColumn {
  key: string;
  label: string;
  type: ParsedFieldType;
  currency: string | null;
  formula: string | null;
  options: string[];
  distinctCount: number;
  nonEmpty: number;
}

export interface ParsedSheet {
  name: string;
  entityKey: string;
  columns: ParsedColumn[];
  rows: Array<Record<string, unknown>>;
}

export interface RelationCandidate {
  fromEntity: string;
  fromField: string;
  toEntity: string;
  toField: string;
  overlapRatio: number;
  targetUniqueness: number;
  nameSimilarity: number;
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  candidates: RelationCandidate[];
}

function slugify(value: string, index: number, seen: Map<string, number>) {
  const base = value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `column_${index + 1}`;
  const occurrence = (seen.get(base) ?? 0) + 1;
  seen.set(base, occurrence);
  const key = occurrence === 1 ? base : `${base}_${occurrence}`;
  return /^[a-z]/.test(key) ? key : `c_${key}`;
}

function uniqueEntityKey(name: string, seen: Map<string, number>) {
  return slugify(name, seen.size, seen);
}

interface NormalizedCell {
  value: unknown;
  formula: string | null;
  currency: string | null;
}

function parseTextDate(value: string) {
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = Number(slash[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function parseAmount(value: string): { amount: number; currency: string } | null {
  const match = /^(?:(U\$S|USD|UYU|\$)\s*)?([0-9][0-9.,]*)(?:\s*(U\$S|USD|UYU|\$))?$/i.exec(value.trim());
  if (!match || (!match[1] && !match[3])) return null;
  const token = (match[1] ?? match[3] ?? '').toUpperCase();
  const currency = token === 'UYU' ? 'UYU' : 'USD';
  const raw = match[2] ?? '';
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  const decimalSep = lastComma > lastDot ? ',' : '.';
  const normalized = decimalSep === ','
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency };
}

function normalizeCell(value: unknown, formula: string | null): NormalizedCell {
  if (value instanceof Date) {
    return { value: value.toISOString().slice(0, 10), formula, currency: null };
  }
  if (typeof value === 'number') {
    return { value, formula, currency: null };
  }
  if (typeof value === 'string') {
    const date = parseTextDate(value);
    if (date) return { value: date, formula, currency: null };
    const amount = parseAmount(value);
    if (amount) return { value: amount.amount, formula, currency: amount.currency };
    return { value, formula, currency: null };
  }
  if (typeof value === 'boolean' || value === null || value === undefined) {
    return { value: value ?? null, formula, currency: null };
  }
  return { value: String(value), formula, currency: null };
}

function headerRowIndex(matrix: unknown[][]) {
  const limit = Math.min(matrix.length, 15);
  for (let index = 0; index < limit; index += 1) {
    const row = matrix[index] ?? [];
    const filled = row.filter((cell) => cell !== null && cell !== undefined && cell !== '');
    if (filled.length < 2) continue;
    const texts = filled.filter((cell) => typeof cell === 'string' && !parseAmount(cell) && !parseTextDate(cell));
    if (texts.length >= Math.ceil(filled.length * 0.6)) return index;
  }
  return 0;
}

function inferType(values: unknown[], currencies: Array<string | null>, formula: string | null): ParsedFieldType {
  if (formula) return 'computed';
  const present = values.filter((value) => value !== null && value !== '');
  if (present.length === 0) return 'text';
  if (currencies.some(Boolean)) return 'amount';
  if (present.every((value) => typeof value === 'boolean')) return 'boolean';
  if (present.every((value) => typeof value === 'number')) {
    return present.some((value) => typeof value === 'number' && Math.abs(value) > 999) ? 'amount' : 'number';
  }
  if (present.every((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) return 'date';
  if (present.every((value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return 'email';
  if (present.every((value) => typeof value === 'string' && /^https?:\/\//i.test(value))) return 'url';
  if (present.every((value) => typeof value === 'string' && /^\+?[0-9()\-\s]{7,}$/.test(value))) return 'phone';
  const distinct = new Set(present.filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase()));
  if (distinct.size > 0 && distinct.size <= 8 && distinct.size < present.length) return 'status';
  return 'text';
}

const NAME_HINTS: Array<{ type: ParsedFieldType; pattern: RegExp }> = [
  { type: 'email', pattern: /(email|correo|mail)/i },
  { type: 'amount', pattern: /(monto|precio|importe|total|costo)/i },
  { type: 'status', pattern: /(estado|etapa|status)/i },
  { type: 'date', pattern: /(fecha|vencimiento|deadline)/i },
  { type: 'phone', pattern: /(telefono|teléfono|celular|whatsapp)/i },
  { type: 'identifier', pattern: /(^id$|_id$|codigo|código|sku|folio)/i },
  { type: 'long-text', pattern: /(nota|detalle|descripcion|descripción|comentario)/i },
];

function applyNameHint(type: ParsedFieldType, label: string): ParsedFieldType {
  if (type === 'computed' || type === 'email' || type === 'date' || type === 'amount') return type;
  for (const hint of NAME_HINTS) {
    if (hint.pattern.test(label)) return hint.type;
  }
  return type;
}

function relativeFormula(formula: string) {
  return formula.replace(/\d+/g, '#');
}

function nameSimilarity(left: string, right: string) {
  const a = left.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  const b = right.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 1;
  const setA = new Set(a);
  let shared = 0;
  for (const char of setA) if (b.includes(char)) shared += 1;
  return shared / Math.max(a.length, b.length);
}

export function findRelationCandidates(sheets: ParsedSheet[]): RelationCandidate[] {
  const columns = sheets.flatMap((sheet) => sheet.columns.map((column) => ({ sheet, column })));
  const valueSets = new Map<string, Set<string>>();
  for (const sheet of sheets) {
    for (const column of sheet.columns) {
      const values = new Set<string>();
      for (const row of sheet.rows.slice(0, 2000)) {
        const value = row[column.key];
        if (typeof value === 'string' && value.trim()) values.add(value.trim().toLowerCase());
        else if (typeof value === 'number') values.add(String(value));
      }
      valueSets.set(`${sheet.entityKey}:${column.key}`, values);
    }
  }
  const candidates: RelationCandidate[] = [];
  for (const source of columns) {
    const sourceValues = valueSets.get(`${source.sheet.entityKey}:${source.column.key}`);
    if (!sourceValues || sourceValues.size < 2) continue;
    for (const target of columns) {
      if (source.sheet.entityKey === target.sheet.entityKey) continue;
      const targetValues = valueSets.get(`${target.sheet.entityKey}:${target.column.key}`);
      if (!targetValues || targetValues.size < 2) continue;
      let hits = 0;
      for (const value of sourceValues) if (targetValues.has(value)) hits += 1;
      const overlapRatio = Math.round((hits / sourceValues.size) * 100) / 100;
      const targetUniqueness = Math.round((targetValues.size / Math.max(target.sheet.rows.length, 1)) * 100) / 100;
      const similarity = Math.max(
        nameSimilarity(source.column.label, target.column.label),
        nameSimilarity(source.column.label, target.sheet.name),
      );
      if (overlapRatio >= 0.5 && targetUniqueness >= 0.8 && (similarity >= 0.5 || overlapRatio >= 0.8)) {
        candidates.push({
          fromEntity: source.sheet.entityKey,
          fromField: source.column.key,
          toEntity: target.sheet.entityKey,
          toField: target.column.key,
          overlapRatio,
          targetUniqueness,
          nameSimilarity: Math.round(similarity * 100) / 100,
        });
      }
    }
  }
  return candidates
    .sort((left, right) => right.overlapRatio - left.overlapRatio)
    .slice(0, 20);
}

export async function parseWorkbook(arrayBuffer: ArrayBuffer): Promise<ParsedWorkbook> {
  let workbook: Awaited<ReturnType<typeof XlsxPopulate.fromDataAsync>>;
  try {
    workbook = await XlsxPopulate.fromDataAsync(arrayBuffer);
  } catch {
    throw new WorkbookValidationError('The file is not a valid .xlsx workbook.');
  }
  const sheets = workbook.sheets().slice(0, MAX_XLSX_SHEETS + 1);
  if (sheets.length > MAX_XLSX_SHEETS) {
    throw new WorkbookValidationError(`The workbook exceeds the limit of ${MAX_XLSX_SHEETS} sheets.`);
  }
  const seenEntities = new Map<string, number>();
  const parsed: ParsedSheet[] = [];
  let totalRows = 0;
  for (const worksheet of sheets) {
    const matrix = toMatrix(worksheet.usedRange()?.value());
    if (matrix.length === 0) continue;
    const headerIndex = headerRowIndex(matrix);
    const widest = matrix.reduce((max, row) => Math.max(max, row.length), 0);
    if (widest > 200) {
      throw new WorkbookValidationError('The workbook exceeds the limit of 200 columns.');
    }
    const seenHeaders = new Map<string, number>();
    const header = matrix[headerIndex] ?? [];
    const headers = Array.from({ length: widest }, (_, index) => {
      const raw = header[index];
      const label = typeof raw === 'string' && raw.trim() ? raw.trim() : `Columna ${index + 1}`;
      return { key: slugify(label, index, seenHeaders), label, index };
    });
    const rows: Array<Record<string, unknown>> = [];
    const samples: unknown[][] = headers.map(() => []);
    const currencies: Array<Array<string | null>> = headers.map(() => []);
    const formulas: Array<Array<string | null>> = headers.map(() => []);
    for (let rowNumber = headerIndex + 1; rowNumber < matrix.length; rowNumber += 1) {
      const data: Record<string, unknown> = {};
      let hasValues = false;
      headers.forEach((column, index) => {
        const formulaRaw = worksheet.cell(rowNumber + 1, index + 1).formula();
        const formula = typeof formulaRaw === 'string' && formulaRaw ? (formulaRaw.startsWith('=') ? formulaRaw : `=${formulaRaw}`) : null;
        const normalized = normalizeCell((matrix[rowNumber] ?? [])[index], formula);
        samples[index]?.push(normalized.value);
        currencies[index]?.push(normalized.currency);
        formulas[index]?.push(normalized.formula);
        data[column.key] = normalized.value;
        if (normalized.value !== null && normalized.value !== '') hasValues = true;
      });
      if (hasValues) rows.push(data);
    }
    totalRows += rows.length;
    const columns: ParsedColumn[] = headers.map((column, index) => {
      const columnFormulas = (formulas[index] ?? []).filter((item): item is string => Boolean(item));
      const shared = columnFormulas.length > 0 && new Set(columnFormulas.map(relativeFormula)).size === 1
        ? columnFormulas[0] ?? null
        : null;
      const values = samples[index] ?? [];
      const type = applyNameHint(inferType(values, currencies[index] ?? [], shared), column.label);
      const distinct = new Set(values.filter((value) => value !== null && value !== '').map((value) => String(value)));
      const options = type === 'status' || type === 'category' ? [...distinct].slice(0, 40) : [];
      const currency = (currencies[index] ?? []).find((item) => item) ?? (type === 'amount' ? 'USD' : null);
      return {
        key: column.key,
        label: column.label,
        type,
        currency,
        formula: shared,
        options,
        distinctCount: distinct.size,
        nonEmpty: values.filter((value) => value !== null && value !== '').length,
      };
    });
    parsed.push({
      name: worksheet.name(),
      entityKey: uniqueEntityKey(worksheet.name(), seenEntities),
      columns,
      rows,
    });
  }
  if (parsed.length === 0) {
    throw new WorkbookValidationError('The workbook must contain at least one worksheet.');
  }
  assertWorkbookShape(Math.max(...parsed.map((sheet) => sheet.columns.length)), totalRows);
  return { sheets: parsed, candidates: findRelationCandidates(parsed) };
}
