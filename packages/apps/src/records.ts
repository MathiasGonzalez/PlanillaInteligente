import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { appSpecVersions, apps, recordChanges, records } from '@planilla/cloudflare/d1/schema';
import type { ParsedSheet } from '@planilla/spreadsheets/parsing/parse-workbook';
import type { AppSpec, EntitySpec, FieldSpec } from './spec';
import { entityOf, parseAppSpec, visibleFields } from './spec';
import type { Database } from './db';

export class RecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordValidationError';
  }
}

export async function loadApp(db: Database, tenantId: string, appId: string) {
  const [app] = await db.select().from(apps).where(and(eq(apps.id, appId), eq(apps.tenantId, tenantId))).limit(1);
  return app ?? null;
}

export async function loadSpec(db: Database, tenantId: string, appId: string): Promise<AppSpec | null> {
  const app = await loadApp(db, tenantId, appId);
  if (!app || app.currentVersion < 1) return null;
  const [version] = await db.select({ spec: appSpecVersions.spec }).from(appSpecVersions).where(and(
    eq(appSpecVersions.tenantId, tenantId),
    eq(appSpecVersions.appId, appId),
    eq(appSpecVersions.version, app.currentVersion),
  )).limit(1);
  return version ? parseAppSpec(version.spec) : null;
}

export async function saveSpecVersion(
  db: Database,
  params: { tenantId: string; appId: string; spec: AppSpec; source: 'heuristic' | 'ai' | 'wizard' | 'instruction' | 'restore'; userId: string | null; proposalId?: string | null },
) {
  const app = await loadApp(db, params.tenantId, params.appId);
  if (!app) throw new RecordValidationError('App not found.');
  const version = app.currentVersion + 1;
  await db.insert(appSpecVersions).values({
    id: crypto.randomUUID(),
    tenantId: params.tenantId,
    appId: params.appId,
    version,
    spec: params.spec as unknown as Record<string, unknown>,
    source: params.source,
    proposalId: params.proposalId ?? null,
    createdByUserId: params.userId,
  });
  await db.update(apps).set({
    name: params.spec.title,
    currentVersion: version,
    updatedAt: new Date(),
  }).where(and(eq(apps.id, params.appId), eq(apps.tenantId, params.tenantId)));
  return version;
}

export async function insertImportedRecords(
  db: Database,
  params: { tenantId: string; appId: string; userId: string; sheets: ParsedSheet[] },
) {
  const rows = params.sheets.flatMap((sheet) => sheet.rows.map((data, index) => ({
    id: crypto.randomUUID(),
    tenantId: params.tenantId,
    appId: params.appId,
    entityKey: sheet.entityKey,
    sourceRowIndex: index,
    data,
    createdByUserId: params.userId,
    updatedByUserId: params.userId,
  })));
  for (let index = 0; index < rows.length; index += 40) {
    const chunk = rows.slice(index, index + 40);
    if (chunk.length > 0) await db.insert(records).values(chunk);
  }
  return rows.length;
}

function coerce(field: FieldSpec, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return null;
  if (field.type === 'number' || field.type === 'amount') {
    const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (!Number.isFinite(number)) throw new RecordValidationError(`«${field.label}» tiene que ser un número.`);
    return number;
  }
  if (field.type === 'boolean') return value === true || value === 'true' || value === '1' || value === 'sí';
  if (field.type === 'date') {
    const text = String(value);
    if (!/^\d{4}-\d{2}-\d{2}/.test(text)) throw new RecordValidationError(`«${field.label}» tiene que ser una fecha.`);
    return text.slice(0, 10);
  }
  const text = String(value).trim();
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    throw new RecordValidationError(`«${field.label}» no es un email.`);
  }
  if ((field.type === 'status' || field.type === 'category') && field.options && field.options.length > 0 && !field.options.includes(text)) {
    throw new RecordValidationError(`«${field.label}» no está entre las opciones.`);
  }
  return text;
}

export function validateRecordInput(entity: EntitySpec, input: Record<string, unknown>, mode: 'create' | 'update') {
  const data: Record<string, unknown> = {};
  for (const field of entity.fields) {
    if (field.sensitive || field.specialCategory || field.type === 'computed' || !field.editable) continue;
    if (!(field.key in input)) {
      if (mode === 'create' && field.required && field.visible) {
        throw new RecordValidationError(`Falta «${field.label}».`);
      }
      continue;
    }
    const value = coerce(field, input[field.key]);
    if (mode === 'create' && field.required && field.visible && (value === null || value === '')) {
      throw new RecordValidationError(`Falta «${field.label}».`);
    }
    data[field.key] = value;
  }
  return data;
}

async function writeChange(
  db: Database,
  params: {
    tenantId: string;
    appId: string;
    recordId: string;
    entityKey: string;
    userId: string | null;
    op: 'create' | 'update' | 'delete';
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    proposalId?: string | null;
  },
) {
  await db.insert(recordChanges).values({
    id: crypto.randomUUID(),
    tenantId: params.tenantId,
    appId: params.appId,
    recordId: params.recordId,
    entityKey: params.entityKey,
    userId: params.userId,
    op: params.op,
    before: params.before,
    after: params.after,
    proposalId: params.proposalId ?? null,
  });
}

export async function createRecord(
  db: Database,
  params: { tenantId: string; appId: string; entity: EntitySpec; userId: string; input: Record<string, unknown> },
) {
  const data = validateRecordInput(params.entity, params.input, 'create');
  const id = crypto.randomUUID();
  await db.insert(records).values({
    id,
    tenantId: params.tenantId,
    appId: params.appId,
    entityKey: params.entity.key,
    sourceRowIndex: null,
    data,
    createdByUserId: params.userId,
    updatedByUserId: params.userId,
  });
  await writeChange(db, {
    tenantId: params.tenantId,
    appId: params.appId,
    recordId: id,
    entityKey: params.entity.key,
    userId: params.userId,
    op: 'create',
    before: null,
    after: data,
  });
  return id;
}

export async function updateRecord(
  db: Database,
  params: { tenantId: string; appId: string; entity: EntitySpec; recordId: string; userId: string; input: Record<string, unknown>; proposalId?: string | null },
) {
  const [current] = await db.select().from(records).where(and(
    eq(records.id, params.recordId),
    eq(records.tenantId, params.tenantId),
    eq(records.appId, params.appId),
    eq(records.entityKey, params.entity.key),
  )).limit(1);
  if (!current) return null;
  const patch = validateRecordInput(params.entity, params.input, 'update');
  const data = { ...current.data, ...patch };
  await db.update(records).set({ data, updatedByUserId: params.userId, updatedAt: new Date() }).where(and(eq(records.id, current.id), eq(records.tenantId, params.tenantId)));
  await writeChange(db, {
    tenantId: params.tenantId,
    appId: params.appId,
    recordId: current.id,
    entityKey: params.entity.key,
    userId: params.userId,
    op: 'update',
    before: current.data,
    after: data,
    proposalId: params.proposalId,
  });
  return data;
}

export async function deleteRecord(db: Database, params: { tenantId: string; appId: string; entityKey: string; recordId: string; userId: string }) {
  const [current] = await db.select().from(records).where(and(
    eq(records.id, params.recordId),
    eq(records.tenantId, params.tenantId),
    eq(records.appId, params.appId),
    eq(records.entityKey, params.entityKey),
  )).limit(1);
  if (!current) return false;
  await writeChange(db, {
    tenantId: params.tenantId,
    appId: params.appId,
    recordId: current.id,
    entityKey: params.entityKey,
    userId: params.userId,
    op: 'delete',
    before: current.data,
    after: null,
  });
  await db.delete(records).where(and(eq(records.id, current.id), eq(records.tenantId, params.tenantId)));
  return true;
}

export interface RecordListQuery {
  tenantId: string;
  appId: string;
  entityKey: string;
  search?: string;
  filters?: Array<{ fieldKey: string; op: 'eq' | 'contains'; value: string }>;
  sortField?: string | null;
  sortDirection?: 'asc' | 'desc';
  cursor?: string | null;
  limit?: number;
}

function encodeCursor(sourceRowIndex: number | null, id: string) {
  return `${sourceRowIndex ?? -1}:${id}`;
}

export async function listRecords(db: Database, query: RecordListQuery) {
  const limit = Math.min(query.limit ?? 50, 100);
  const rows = await db.select().from(records).where(and(
    eq(records.tenantId, query.tenantId),
    eq(records.appId, query.appId),
    eq(records.entityKey, query.entityKey),
  )).orderBy(asc(records.sourceRowIndex), asc(records.id));
  const search = query.search?.trim().toLowerCase() ?? '';
  const filtered = rows.filter((row) => {
    if (search) {
      const haystack = Object.values(row.data).map((value) => String(value ?? '').toLowerCase()).join(' ');
      if (!haystack.includes(search)) return false;
    }
    for (const filter of query.filters ?? []) {
      const value = String(row.data[filter.fieldKey] ?? '');
      if (filter.op === 'eq' && value !== filter.value) return false;
      if (filter.op === 'contains' && !value.toLowerCase().includes(filter.value.toLowerCase())) return false;
    }
    return true;
  });
  if (query.sortField) {
    const direction = query.sortDirection === 'desc' ? -1 : 1;
    filtered.sort((left, right) => {
      const a = left.data[query.sortField ?? ''] ?? '';
      const b = right.data[query.sortField ?? ''] ?? '';
      return String(a).localeCompare(String(b), 'es', { numeric: true }) * direction;
    });
  }
  const start = query.cursor ? filtered.findIndex((row) => encodeCursor(row.sourceRowIndex, row.id) === query.cursor) + 1 : 0;
  const page = filtered.slice(Math.max(start, 0), Math.max(start, 0) + limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: page.length === limit && last ? encodeCursor(last.sourceRowIndex, last.id) : null,
    total: filtered.length,
  };
}

export async function getRecord(db: Database, tenantId: string, appId: string, recordId: string) {
  const [row] = await db.select().from(records).where(and(eq(records.id, recordId), eq(records.tenantId, tenantId), eq(records.appId, appId))).limit(1);
  return row ?? null;
}

export async function recordHistory(db: Database, tenantId: string, appId: string, recordId: string) {
  return db.select().from(recordChanges).where(and(
    eq(recordChanges.tenantId, tenantId),
    eq(recordChanges.appId, appId),
    eq(recordChanges.recordId, recordId),
  )).orderBy(desc(recordChanges.createdAt)).limit(30);
}

export async function relatedRecords(db: Database, tenantId: string, appId: string, spec: AppSpec, entityKey: string, recordId: string) {
  const incoming = spec.relations.filter((relation) => relation.toEntity === entityKey);
  const groups = [];
  for (const relation of incoming) {
    const rows = await db.select({ id: records.id, data: records.data }).from(records).where(and(
      eq(records.tenantId, tenantId),
      eq(records.appId, appId),
      eq(records.entityKey, relation.fromEntity),
    )).limit(500);
    const matches = rows.filter((row) => row.data[relation.fieldKey] === recordId).slice(0, 20);
    groups.push({ relation, rows: matches });
  }
  return groups;
}

export async function resolveRelations(db: Database, tenantId: string, appId: string, spec: AppSpec) {
  const unmatched: string[] = [];
  for (const relation of spec.relations) {
    const target = entityOf(spec, relation.toEntity);
    const source = entityOf(spec, relation.fromEntity);
    if (!target?.primaryFieldKey || !source) continue;
    const targets = await db.select({ id: records.id, data: records.data }).from(records).where(and(
      eq(records.tenantId, tenantId),
      eq(records.appId, appId),
      eq(records.entityKey, relation.toEntity),
    ));
    const byPrimary = new Map<string, string>();
    for (const row of targets) {
      const key = String(row.data[target.primaryFieldKey] ?? '').trim().toLowerCase();
      if (key) byPrimary.set(key, row.id);
    }
    const sources = await db.select().from(records).where(and(
      eq(records.tenantId, tenantId),
      eq(records.appId, appId),
      eq(records.entityKey, relation.fromEntity),
    ));
    for (const row of sources) {
      const current = row.data[relation.fieldKey];
      if (typeof current !== 'string' || !current.trim()) continue;
      const match = byPrimary.get(current.trim().toLowerCase()) ?? null;
      if (!match) unmatched.push(`${source.name}: ${current}`);
      const data = { ...row.data, [relation.fieldKey]: match };
      await db.update(records).set({ data, updatedAt: new Date() }).where(and(eq(records.id, row.id), eq(records.tenantId, tenantId)));
    }
  }
  return unmatched.slice(0, 20);
}

export async function searchRelationOptions(db: Database, tenantId: string, appId: string, entity: EntitySpec, query: string) {
  const rows = await listRecords(db, { tenantId, appId, entityKey: entity.key, search: query, limit: 15 });
  const labelKey = entity.primaryFieldKey;
  return rows.rows.map((row) => ({
    id: row.id,
    label: labelKey ? String(row.data[labelKey] ?? row.id) : row.id,
  }));
}

export function displayFields(entity: EntitySpec) {
  return visibleFields(entity);
}

export async function countRecords(db: Database, tenantId: string, appId: string, entityKey: string) {
  const [row] = await db.select({ total: sql<number>`count(*)` }).from(records).where(and(
    eq(records.tenantId, tenantId),
    eq(records.appId, appId),
    eq(records.entityKey, entityKey),
  ));
  return Number(row?.total ?? 0);
}
