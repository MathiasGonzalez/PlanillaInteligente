import { and, eq } from 'drizzle-orm';
import { appChangeProposals, recordChanges, records } from '@planilla/cloudflare/d1/schema';
import { resolveAiModel, runAiInference } from '@planilla/cloudflare/ai';
import type { AppSpec, DashboardWidget, EntitySpec, FieldSpec, FieldType, ViewSpec } from './spec';
import { diffSpecs, entityOf, parseAppSpec } from './spec';
import { loadApp, loadSpec, saveSpecVersion } from './records';
import type { AiEnv, Database } from './db';

export const DATA_ROW_QUEUE_THRESHOLD = 2000;

export type AppOperation =
  | { op: 'addField'; entityKey: string; field: FieldSpec }
  | { op: 'renameField'; entityKey: string; fieldKey: string; label: string }
  | { op: 'updateField'; entityKey: string; fieldKey: string; patch: { type?: FieldType; required?: boolean; visible?: boolean; options?: string[]; currency?: string | null; editable?: boolean } }
  | { op: 'archiveField'; entityKey: string; fieldKey: string }
  | { op: 'addView'; view: ViewSpec }
  | { op: 'updateView'; viewKey: string; title?: string; visibleFields?: string[] }
  | { op: 'removeView'; viewKey: string }
  | { op: 'addWidget'; dashboardKey: string; widget: DashboardWidget }
  | { op: 'removeWidget'; dashboardKey: string; widgetKey: string }
  | { op: 'renameEntity'; entityKey: string; name: string }
  | { op: 'addEntity'; entity: EntitySpec }
  | { op: 'addRelation'; fromEntity: string; fieldKey: string; toEntity: string }
  | { op: 'removeRelation'; fromEntity: string; fieldKey: string }
  | { op: 'convertFieldType'; entityKey: string; fieldKey: string; type: FieldType }
  | { op: 'splitField'; entityKey: string; fieldKey: string; separator: string; leftKey: string; rightKey: string; leftLabel: string; rightLabel: string }
  | { op: 'computeField'; entityKey: string; fieldKey: string; expression: string }
  | { op: 'fillDefault'; entityKey: string; fieldKey: string; value: string }
  | { op: 'extractEntity'; sourceEntity: string; entity: EntitySpec; fieldKeys: string[]; relationFieldKey: string };

const FIELD_TYPES = new Set(['text', 'long-text', 'number', 'amount', 'date', 'boolean', 'email', 'phone', 'url', 'status', 'category', 'identifier', 'relation', 'computed']);
const KEY = /^[a-z][a-z0-9_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asField(value: unknown): FieldSpec | null {
  if (!isRecord(value) || typeof value.key !== 'string' || !KEY.test(value.key) || typeof value.label !== 'string') return null;
  if (typeof value.type !== 'string' || !FIELD_TYPES.has(value.type)) return null;
  return {
    key: value.key,
    label: value.label.slice(0, 120),
    type: value.type as FieldType,
    required: value.required === true,
    visible: value.visible !== false,
    editable: value.editable !== false,
    sensitive: false,
    specialCategory: false,
    options: Array.isArray(value.options) ? value.options.filter((item): item is string => typeof item === 'string').slice(0, 40) : undefined,
    currency: typeof value.currency === 'string' ? value.currency : null,
    relation: null,
    formula: null,
  };
}

export function parseOperations(value: unknown): AppOperation[] | null {
  if (!Array.isArray(value)) return null;
  const operations: AppOperation[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.op !== 'string') return null;
    const op = item.op;
    if (op === 'addField') {
      const field = asField(item.field);
      if (!field || typeof item.entityKey !== 'string') return null;
      operations.push({ op, entityKey: item.entityKey, field });
    } else if (op === 'renameField' && typeof item.entityKey === 'string' && typeof item.fieldKey === 'string' && typeof item.label === 'string') {
      operations.push({ op, entityKey: item.entityKey, fieldKey: item.fieldKey, label: item.label.slice(0, 120) });
    } else if (op === 'updateField' && typeof item.entityKey === 'string' && typeof item.fieldKey === 'string' && isRecord(item.patch)) {
      const type = typeof item.patch.type === 'string' && FIELD_TYPES.has(item.patch.type) ? item.patch.type as FieldType : undefined;
      operations.push({
        op,
        entityKey: item.entityKey,
        fieldKey: item.fieldKey,
        patch: {
          type,
          required: typeof item.patch.required === 'boolean' ? item.patch.required : undefined,
          visible: typeof item.patch.visible === 'boolean' ? item.patch.visible : undefined,
          editable: typeof item.patch.editable === 'boolean' ? item.patch.editable : undefined,
          currency: typeof item.patch.currency === 'string' ? item.patch.currency : undefined,
          options: Array.isArray(item.patch.options) ? item.patch.options.filter((entry): entry is string => typeof entry === 'string') : undefined,
        },
      });
    } else if (op === 'archiveField' && typeof item.entityKey === 'string' && typeof item.fieldKey === 'string') {
      operations.push({ op, entityKey: item.entityKey, fieldKey: item.fieldKey });
    } else if (op === 'renameEntity' && typeof item.entityKey === 'string' && typeof item.name === 'string') {
      operations.push({ op, entityKey: item.entityKey, name: item.name.slice(0, 120) });
    } else if (op === 'addEntity' && isRecord(item.entity) && typeof item.entity.key === 'string' && KEY.test(item.entity.key) && typeof item.entity.name === 'string' && Array.isArray(item.entity.fields)) {
      const fields = item.entity.fields.map(asField).filter((field): field is FieldSpec => field !== null);
      if (fields.length === 0) return null;
      operations.push({
        op,
        entity: { key: item.entity.key, name: item.entity.name, sourceSheet: null, primaryFieldKey: fields[0]?.key ?? null, statusFieldKey: null, fields },
      });
    } else if (op === 'addRelation' && typeof item.fromEntity === 'string' && typeof item.fieldKey === 'string' && typeof item.toEntity === 'string') {
      operations.push({ op, fromEntity: item.fromEntity, fieldKey: item.fieldKey, toEntity: item.toEntity });
    } else if (op === 'removeRelation' && typeof item.fromEntity === 'string' && typeof item.fieldKey === 'string') {
      operations.push({ op, fromEntity: item.fromEntity, fieldKey: item.fieldKey });
    } else if (op === 'removeView' && typeof item.viewKey === 'string') {
      operations.push({ op, viewKey: item.viewKey });
    } else if (op === 'removeWidget' && typeof item.dashboardKey === 'string' && typeof item.widgetKey === 'string') {
      operations.push({ op, dashboardKey: item.dashboardKey, widgetKey: item.widgetKey });
    } else if (op === 'convertFieldType' && typeof item.entityKey === 'string' && typeof item.fieldKey === 'string' && typeof item.type === 'string' && FIELD_TYPES.has(item.type)) {
      operations.push({ op, entityKey: item.entityKey, fieldKey: item.fieldKey, type: item.type as FieldType });
    } else if (op === 'fillDefault' && typeof item.entityKey === 'string' && typeof item.fieldKey === 'string' && typeof item.value === 'string') {
      operations.push({ op, entityKey: item.entityKey, fieldKey: item.fieldKey, value: item.value.slice(0, 200) });
    } else if (op === 'splitField' && typeof item.entityKey === 'string' && typeof item.fieldKey === 'string' && typeof item.separator === 'string' && typeof item.leftKey === 'string' && typeof item.rightKey === 'string') {
      operations.push({
        op,
        entityKey: item.entityKey,
        fieldKey: item.fieldKey,
        separator: item.separator.slice(0, 8),
        leftKey: item.leftKey,
        rightKey: item.rightKey,
        leftLabel: typeof item.leftLabel === 'string' ? item.leftLabel : item.leftKey,
        rightLabel: typeof item.rightLabel === 'string' ? item.rightLabel : item.rightKey,
      });
    } else if (op === 'computeField' && typeof item.entityKey === 'string' && typeof item.fieldKey === 'string' && typeof item.expression === 'string') {
      operations.push({ op, entityKey: item.entityKey, fieldKey: item.fieldKey, expression: item.expression.slice(0, 200) });
    } else if (op === 'extractEntity' && typeof item.sourceEntity === 'string' && Array.isArray(item.fieldKeys) && typeof item.relationFieldKey === 'string' && isRecord(item.entity)) {
      const fields = Array.isArray(item.entity.fields) ? item.entity.fields.map(asField).filter((field): field is FieldSpec => field !== null) : [];
      if (typeof item.entity.key !== 'string' || typeof item.entity.name !== 'string' || fields.length === 0) return null;
      operations.push({
        op,
        sourceEntity: item.sourceEntity,
        relationFieldKey: item.relationFieldKey,
        fieldKeys: item.fieldKeys.filter((key): key is string => typeof key === 'string'),
        entity: { key: item.entity.key, name: item.entity.name, sourceSheet: null, primaryFieldKey: fields[0]?.key ?? null, statusFieldKey: null, fields },
      });
    } else if (op === 'addView' && isRecord(item.view) && typeof item.view.key === 'string' && typeof item.view.entityKey === 'string') {
      operations.push({
        op,
        view: {
          key: item.view.key,
          entityKey: item.view.entityKey,
          type: item.view.type === 'kanban' || item.view.type === 'form' || item.view.type === 'detail' ? item.view.type : 'table',
          title: typeof item.view.title === 'string' ? item.view.title : item.view.entityKey,
          filters: [],
          sort: null,
          groupBy: null,
          visibleFields: Array.isArray(item.view.visibleFields) ? item.view.visibleFields.filter((key): key is string => typeof key === 'string') : [],
        },
      });
    } else if (op === 'updateView' && typeof item.viewKey === 'string') {
      operations.push({
        op,
        viewKey: item.viewKey,
        title: typeof item.title === 'string' ? item.title : undefined,
        visibleFields: Array.isArray(item.visibleFields) ? item.visibleFields.filter((key): key is string => typeof key === 'string') : undefined,
      });
    } else if (op === 'addWidget' && typeof item.dashboardKey === 'string' && isRecord(item.widget) && typeof item.widget.entityKey === 'string' && typeof item.widget.key === 'string') {
      const metricOp = item.widget && isRecord(item.widget.metric) && (item.widget.metric.op === 'sum' || item.widget.metric.op === 'avg') ? item.widget.metric.op : 'count';
      operations.push({
        op,
        dashboardKey: item.dashboardKey,
        widget: {
          key: item.widget.key,
          type: item.widget.type === 'bar' || item.widget.type === 'line' ? item.widget.type : 'kpi',
          title: typeof item.widget.title === 'string' ? item.widget.title : item.widget.key,
          entityKey: item.widget.entityKey,
          metric: { op: metricOp, fieldKey: isRecord(item.widget.metric) && typeof item.widget.metric.fieldKey === 'string' ? item.widget.metric.fieldKey : null },
          groupBy: typeof item.widget.groupBy === 'string' ? item.widget.groupBy : null,
          dateBucket: item.widget.dateBucket === 'month' ? 'month' : null,
        },
      });
    } else {
      return null;
    }
  }
  return operations;
}

function cloneSpec(spec: AppSpec): AppSpec {
  return structuredClone(spec);
}

export function applySpecOperations(spec: AppSpec, operations: AppOperation[]): AppSpec {
  const next = cloneSpec(spec);
  for (const operation of operations) {
    if (operation.op === 'addField') {
      const entity = entityOf(next, operation.entityKey);
      if (!entity || entity.fields.some((field) => field.key === operation.field.key)) throw new Error('Campo inválido.');
      entity.fields.push(operation.field);
    } else if (operation.op === 'renameField') {
      const field = entityOf(next, operation.entityKey)?.fields.find((item) => item.key === operation.fieldKey);
      if (!field) throw new Error('Campo inexistente.');
      field.label = operation.label;
    } else if (operation.op === 'updateField') {
      const field = entityOf(next, operation.entityKey)?.fields.find((item) => item.key === operation.fieldKey);
      if (!field) throw new Error('Campo inexistente.');
      Object.assign(field, Object.fromEntries(Object.entries(operation.patch).filter(([, value]) => value !== undefined)));
    } else if (operation.op === 'archiveField') {
      const field = entityOf(next, operation.entityKey)?.fields.find((item) => item.key === operation.fieldKey);
      if (!field) throw new Error('Campo inexistente.');
      field.visible = false;
      field.editable = false;
    } else if (operation.op === 'renameEntity') {
      const entity = entityOf(next, operation.entityKey);
      if (!entity) throw new Error('Lista inexistente.');
      entity.name = operation.name;
    } else if (operation.op === 'addEntity') {
      if (entityOf(next, operation.entity.key)) throw new Error('La lista ya existe.');
      next.entities.push(operation.entity);
    } else if (operation.op === 'addRelation') {
      const field = entityOf(next, operation.fromEntity)?.fields.find((item) => item.key === operation.fieldKey);
      if (!field || !entityOf(next, operation.toEntity)) throw new Error('Relación inválida.');
      field.type = 'relation';
      field.relation = { toEntity: operation.toEntity };
      next.relations.push({ fromEntity: operation.fromEntity, fieldKey: operation.fieldKey, toEntity: operation.toEntity, cardinality: 'many-to-one', origin: 'instruction' });
    } else if (operation.op === 'removeRelation') {
      next.relations = next.relations.filter((relation) => !(relation.fromEntity === operation.fromEntity && relation.fieldKey === operation.fieldKey));
    } else if (operation.op === 'addView') {
      if (!entityOf(next, operation.view.entityKey)) throw new Error('Vista inválida.');
      next.views.push(operation.view);
    } else if (operation.op === 'updateView') {
      const view = next.views.find((item) => item.key === operation.viewKey);
      if (!view) throw new Error('Vista inexistente.');
      if (operation.title) view.title = operation.title;
      if (operation.visibleFields) view.visibleFields = operation.visibleFields;
    } else if (operation.op === 'removeView') {
      next.views = next.views.filter((view) => view.key !== operation.viewKey);
    } else if (operation.op === 'addWidget') {
      const dashboard = next.dashboards.find((item) => item.key === operation.dashboardKey) ?? next.dashboards[0];
      if (!dashboard || !entityOf(next, operation.widget.entityKey)) throw new Error('Widget inválido.');
      dashboard.widgets.push(operation.widget);
    } else if (operation.op === 'removeWidget') {
      const dashboard = next.dashboards.find((item) => item.key === operation.dashboardKey);
      if (dashboard) dashboard.widgets = dashboard.widgets.filter((widget) => widget.key !== operation.widgetKey);
    } else if (operation.op === 'extractEntity') {
      if (!entityOf(next, operation.sourceEntity) || entityOf(next, operation.entity.key)) throw new Error('No se puede extraer la lista.');
      const relationField: FieldSpec = {
        key: operation.relationFieldKey,
        label: operation.sourceEntity,
        type: 'relation',
        required: true,
        visible: true,
        editable: false,
        sensitive: false,
        specialCategory: false,
        relation: { toEntity: operation.sourceEntity },
      };
      next.entities.push({ ...operation.entity, fields: [...operation.entity.fields, relationField] });
      next.relations.push({
        fromEntity: operation.entity.key,
        fieldKey: operation.relationFieldKey,
        toEntity: operation.sourceEntity,
        cardinality: 'many-to-one',
        origin: 'instruction',
      });
    } else if (operation.op === 'splitField') {
      const entity = entityOf(next, operation.entityKey);
      if (!entity?.fields.some((field) => field.key === operation.fieldKey)) throw new Error('Campo inexistente.');
      for (const [key, label] of [[operation.leftKey, operation.leftLabel], [operation.rightKey, operation.rightLabel]] as const) {
        if (!entity.fields.some((field) => field.key === key)) {
          entity.fields.push({ key, label, type: 'text', required: false, visible: true, editable: true, sensitive: false, specialCategory: false });
        }
      }
    } else if (operation.op === 'convertFieldType') {
      const field = entityOf(next, operation.entityKey)?.fields.find((item) => item.key === operation.fieldKey);
      if (!field) throw new Error('Campo inexistente.');
      field.type = operation.type;
    }
  }
  const parsed = parseAppSpec(next);
  if (!parsed) throw new Error('La spec resultante no es válida.');
  return parsed;
}

type Token = { type: 'num'; value: number } | { type: 'id'; value: string } | { type: 'op'; value: string } | { type: 'lp' } | { type: 'rp' } | { type: 'comma' };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const source = expression.trim();
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? '';
    if (char === ' ') { index += 1; continue; }
    if ('+-*,()'.includes(char)) {
      tokens.push(char === '(' ? { type: 'lp' } : char === ')' ? { type: 'rp' } : char === ',' ? { type: 'comma' } : { type: 'op', value: char });
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let raw = '';
      while (index < source.length && /[0-9.]/.test(source[index] ?? '')) { raw += source[index]; index += 1; }
      tokens.push({ type: 'num', value: Number(raw) });
      continue;
    }
    if (/[a-z_]/i.test(char)) {
      let raw = '';
      while (index < source.length && /[a-z0-9_]/i.test(source[index] ?? '')) { raw += source[index]; index += 1; }
      tokens.push({ type: 'id', value: raw });
      continue;
    }
    throw new Error('Expresión no soportada.');
  }
  return tokens;
}

function evaluate(expression: string, data: Record<string, unknown>): unknown {
  const tokens = tokenize(expression);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const eat = () => tokens[cursor++];
  function parseExpr(): unknown {
    let left = parseTerm();
    while (peek()?.type === 'op' && (peek() as { value: string }).value !== '*') {
      const op = (eat() as { value: string }).value;
      const right = parseTerm();
      const a = Number(left);
      const b = Number(right);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      left = op === '+' ? a + b : a - b;
    }
    return left;
  }
  function parseTerm(): unknown {
    let left = parseFactor();
    while (peek()?.type === 'op' && (peek() as { value: string }).value === '*') {
      eat();
      const right = Number(parseFactor());
      const value = Number(left);
      if (!Number.isFinite(value) || !Number.isFinite(right)) return null;
      left = value * right;
    }
    return left;
  }
  function parseFactor(): unknown {
    const token = eat();
    if (!token) throw new Error('Expresión incompleta.');
    if (token.type === 'num') return token.value;
    if (token.type === 'lp') {
      const value = parseExpr();
      if (eat()?.type !== 'rp') throw new Error('Falta paréntesis.');
      return value;
    }
    if (token.type === 'id') {
      if (peek()?.type === 'lp') {
        eat();
        const args: unknown[] = [];
        if (peek()?.type !== 'rp') {
          args.push(parseExpr());
          while (peek()?.type === 'comma') { eat(); args.push(parseExpr()); }
        }
        if (eat()?.type !== 'rp') throw new Error('Falta paréntesis.');
        if (token.value === 'concat') return args.map((arg) => String(arg ?? '')).join('');
        if (token.value === 'days') {
          const start = Date.parse(String(args[0] ?? ''));
          const end = Date.parse(String(args[1] ?? ''));
          if (Number.isNaN(start) || Number.isNaN(end)) return null;
          return Math.round((end - start) / 86_400_000);
        }
        throw new Error('Función no soportada.');
      }
      return data[token.value] ?? null;
    }
    throw new Error('Expresión no soportada.');
  }
  const value = parseExpr();
  if (cursor !== tokens.length) throw new Error('Expresión no soportada.');
  return value;
}

function convertValue(type: FieldType, value: unknown) {
  if (value === null || value === undefined || value === '') return { ok: true as const, value: null };
  if (type === 'number' || type === 'amount') {
    const number = Number(String(value).replace(',', '.'));
    return Number.isFinite(number) ? { ok: true as const, value: number } : { ok: false as const, value };
  }
  if (type === 'date') {
    const text = String(value);
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? { ok: true as const, value: text.slice(0, 10) } : { ok: false as const, value };
  }
  if (type === 'boolean') return { ok: true as const, value: value === true || value === 'true' || value === 'sí' };
  return { ok: true as const, value: String(value) };
}

async function entityRows(db: Database, tenantId: string, appId: string, entityKey: string) {
  return db.select().from(records).where(and(eq(records.tenantId, tenantId), eq(records.appId, appId), eq(records.entityKey, entityKey)));
}

export async function dryRun(db: Database, tenantId: string, appId: string, spec: AppSpec, operations: AppOperation[], allowSamples: boolean) {
  const next = applySpecOperations(spec, operations);
  let affected = 0;
  const examples: Array<{ entityKey: string; before: string; after: string }> = [];
  const failures: string[] = [];
  for (const operation of operations) {
    const entityKey = 'entityKey' in operation ? operation.entityKey : 'sourceEntity' in operation ? operation.sourceEntity : null;
    if (!entityKey || !['convertFieldType', 'splitField', 'computeField', 'fillDefault', 'extractEntity'].includes(operation.op)) continue;
    const rows = await entityRows(db, tenantId, appId, entityKey);
    affected += rows.length;
    if (operation.op === 'convertFieldType') {
      const failed = rows.filter((row) => !convertValue(operation.type, row.data[operation.fieldKey]).ok).length;
      if (failed > 0) failures.push(`${failed} filas de ${entityKey}.${operation.fieldKey} no convierten a ${operation.type}.`);
    }
    if (allowSamples && examples.length < 3 && rows[0]) {
      examples.push({ entityKey, before: JSON.stringify(rows[0].data).slice(0, 180), after: operation.op });
    }
  }
  return { diff: diffSpecs(spec, next), affected, examples, failures, spec: next };
}

async function remember(
  db: Database,
  params: { tenantId: string; appId: string; recordId: string; entityKey: string; userId: string; proposalId: string; op: 'create' | 'update'; before: Record<string, unknown> | null; after: Record<string, unknown> | null },
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
    proposalId: params.proposalId,
  });
}

async function applyData(db: Database, tenantId: string, appId: string, userId: string, proposalId: string, operations: AppOperation[]) {
  for (const operation of operations) {
    if (operation.op === 'convertFieldType') {
      const rows = await entityRows(db, tenantId, appId, operation.entityKey);
      for (const row of rows) {
        const converted = convertValue(operation.type, row.data[operation.fieldKey]);
        if (!converted.ok) continue;
        const data = { ...row.data, [operation.fieldKey]: converted.value };
        await remember(db, { tenantId, appId, recordId: row.id, entityKey: operation.entityKey, userId, proposalId, op: 'update', before: row.data, after: data });
        await db.update(records).set({ data, updatedAt: new Date() }).where(and(eq(records.id, row.id), eq(records.tenantId, tenantId)));
      }
    } else if (operation.op === 'splitField') {
      const rows = await entityRows(db, tenantId, appId, operation.entityKey);
      for (const row of rows) {
        const [left, right] = String(row.data[operation.fieldKey] ?? '').split(operation.separator);
        const data = { ...row.data, [operation.leftKey]: left?.trim() ?? '', [operation.rightKey]: right?.trim() ?? '' };
        await remember(db, { tenantId, appId, recordId: row.id, entityKey: operation.entityKey, userId, proposalId, op: 'update', before: row.data, after: data });
        await db.update(records).set({ data, updatedAt: new Date() }).where(and(eq(records.id, row.id), eq(records.tenantId, tenantId)));
      }
    } else if (operation.op === 'computeField') {
      const rows = await entityRows(db, tenantId, appId, operation.entityKey);
      for (const row of rows) {
        let computed: unknown = null;
        try { computed = evaluate(operation.expression, row.data); } catch { computed = null; }
        const data = { ...row.data, [operation.fieldKey]: computed };
        await remember(db, { tenantId, appId, recordId: row.id, entityKey: operation.entityKey, userId, proposalId, op: 'update', before: row.data, after: data });
        await db.update(records).set({ data, updatedAt: new Date() }).where(and(eq(records.id, row.id), eq(records.tenantId, tenantId)));
      }
    } else if (operation.op === 'fillDefault') {
      const rows = await entityRows(db, tenantId, appId, operation.entityKey);
      for (const row of rows) {
        if (row.data[operation.fieldKey] !== null && row.data[operation.fieldKey] !== undefined && row.data[operation.fieldKey] !== '') continue;
        const data = { ...row.data, [operation.fieldKey]: operation.value };
        await remember(db, { tenantId, appId, recordId: row.id, entityKey: operation.entityKey, userId, proposalId, op: 'update', before: row.data, after: data });
        await db.update(records).set({ data, updatedAt: new Date() }).where(and(eq(records.id, row.id), eq(records.tenantId, tenantId)));
      }
    } else if (operation.op === 'extractEntity') {
      const rows = await entityRows(db, tenantId, appId, operation.sourceEntity);
      for (const row of rows) {
        const data: Record<string, unknown> = { [operation.relationFieldKey]: row.id };
        const remaining = { ...row.data };
        for (const key of operation.fieldKeys) {
          data[key] = row.data[key] ?? null;
          delete remaining[key];
        }
        const id = crypto.randomUUID();
        await db.insert(records).values({
          id,
          tenantId,
          appId,
          entityKey: operation.entity.key,
          sourceRowIndex: null,
          data,
          createdByUserId: userId,
          updatedByUserId: userId,
        });
        await remember(db, { tenantId, appId, recordId: id, entityKey: operation.entity.key, userId, proposalId, op: 'create', before: null, after: data });
        await remember(db, { tenantId, appId, recordId: row.id, entityKey: operation.sourceEntity, userId, proposalId, op: 'update', before: row.data, after: remaining });
        await db.update(records).set({ data: remaining, updatedAt: new Date() }).where(and(eq(records.id, row.id), eq(records.tenantId, tenantId)));
      }
    }
  }
}

function extractAi(response: unknown): unknown {
  if (typeof response === 'string') {
    try { return JSON.parse(response) as unknown; } catch { return null; }
  }
  if (isRecord(response) && 'response' in response) return extractAi(response.response);
  return response;
}

export async function createProposal(db: Database, env: AiEnv, params: { tenantId: string; appId: string; userId: string; instruction: string; allowSamples: boolean }) {
  const spec = await loadSpec(db, params.tenantId, params.appId);
  const app = await loadApp(db, params.tenantId, params.appId);
  if (!spec || !app) throw new Error('App not found.');
  let operations: AppOperation[] | null = null;
  let explanation: string | null = null;
  if (!env.AI) {
    explanation = 'La IA no está disponible en este entorno.';
  } else {
    const response = await runAiInference(env.AI, resolveAiModel(env.WORKERS_AI_MODEL), {
      messages: [
        {
          role: 'system',
          content: 'Devolvé JSON {"supported":true,"operations":[...]} o {"supported":false,"explanation":"..."}. Operaciones: addField, renameField, updateField, archiveField, addView, updateView, removeView, addWidget, removeWidget, renameEntity, addEntity, addRelation, removeRelation, convertFieldType, splitField, computeField, fillDefault, extractEntity. No inventes keys que no estén en la spec salvo campos nuevos. computeField solo usa + - * concat() days() y keys de campos. No escribas código.',
        },
        { role: 'user', content: JSON.stringify({ instruction: params.instruction.slice(0, 1000), spec }) },
      ],
      response_format: { type: 'json_object' },
    }, env.AI_GATEWAY_ID);
    const payload = extractAi(response);
    if (isRecord(payload) && payload.supported === false) {
      explanation = typeof payload.explanation === 'string' ? payload.explanation.slice(0, 500) : 'No se puede hacer con las operaciones disponibles.';
    } else if (isRecord(payload)) {
      operations = parseOperations(payload.operations);
      if (!operations) explanation = 'La respuesta no respetó el catálogo de operaciones.';
    } else {
      explanation = 'La IA no devolvió JSON.';
    }
  }
  const id = crypto.randomUUID();
  if (!operations) {
    await db.insert(appChangeProposals).values({
      id,
      tenantId: params.tenantId,
      appId: params.appId,
      baseVersion: app.currentVersion,
      instruction: params.instruction.slice(0, 1000),
      operations: [],
      preview: { explanation },
      status: 'rejected',
      errorMessage: explanation,
      createdByUserId: params.userId,
    });
    return { id, status: 'rejected' as const, explanation, preview: null };
  }
  try {
    const preview = await dryRun(db, params.tenantId, params.appId, spec, operations, params.allowSamples);
    await db.insert(appChangeProposals).values({
      id,
      tenantId: params.tenantId,
      appId: params.appId,
      baseVersion: app.currentVersion,
      instruction: params.instruction.slice(0, 1000),
      operations: operations as unknown as unknown[],
      preview: { diff: preview.diff, affected: preview.affected, examples: preview.examples, failures: preview.failures },
      status: 'pending',
      createdByUserId: params.userId,
    });
    return { id, status: 'pending' as const, explanation: null, preview };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo previsualizar.';
    await db.insert(appChangeProposals).values({
      id,
      tenantId: params.tenantId,
      appId: params.appId,
      baseVersion: app.currentVersion,
      instruction: params.instruction.slice(0, 1000),
      operations: operations as unknown as unknown[],
      preview: null,
      status: 'rejected',
      errorMessage: message,
      createdByUserId: params.userId,
    });
    return { id, status: 'rejected' as const, explanation: message, preview: null };
  }
}

export async function applyProposal(db: Database, params: { tenantId: string; appId: string; proposalId: string; userId: string }) {
  const [proposal] = await db.select().from(appChangeProposals).where(and(
    eq(appChangeProposals.id, params.proposalId),
    eq(appChangeProposals.tenantId, params.tenantId),
    eq(appChangeProposals.appId, params.appId),
  )).limit(1);
  if (!proposal || proposal.status === 'applied' || proposal.status === 'rejected') return { status: 'failed' as const, queued: false };
  const app = await loadApp(db, params.tenantId, params.appId);
  const spec = await loadSpec(db, params.tenantId, params.appId);
  if (!app || !spec) return { status: 'failed' as const, queued: false };
  if (app.currentVersion !== proposal.baseVersion) {
    await db.update(appChangeProposals).set({ status: 'stale', updatedAt: new Date() }).where(eq(appChangeProposals.id, proposal.id));
    return { status: 'stale' as const, queued: false };
  }
  const operations = parseOperations(proposal.operations);
  if (!operations) return { status: 'failed' as const, queued: false };
  const dataOps = operations.filter((operation): operation is Extract<AppOperation, { op: 'convertFieldType' | 'splitField' | 'computeField' | 'fillDefault' | 'extractEntity' }> =>
    operation.op === 'convertFieldType' || operation.op === 'splitField' || operation.op === 'computeField' || operation.op === 'fillDefault' || operation.op === 'extractEntity');
  let affected = 0;
  for (const operation of dataOps) {
    const entityKey = 'entityKey' in operation ? operation.entityKey : operation.sourceEntity;
    affected += (await entityRows(db, params.tenantId, params.appId, entityKey)).length;
  }
  if (affected > DATA_ROW_QUEUE_THRESHOLD && proposal.status !== 'processing') {
    await db.update(appChangeProposals).set({ status: 'processing', updatedAt: new Date() }).where(eq(appChangeProposals.id, proposal.id));
    return { status: 'processing' as const, queued: true };
  }
  const next = applySpecOperations(spec, operations);
  const version = await saveSpecVersion(db, {
    tenantId: params.tenantId,
    appId: params.appId,
    spec: next,
    source: 'instruction',
    userId: params.userId,
    proposalId: proposal.id,
  });
  await applyData(db, params.tenantId, params.appId, params.userId, proposal.id, operations);
  await db.update(appChangeProposals).set({ status: 'applied', appliedVersion: version, updatedAt: new Date() }).where(eq(appChangeProposals.id, proposal.id));
  return { status: 'applied' as const, queued: false, version };
}

export async function revertProposal(db: Database, params: { tenantId: string; appId: string; proposalId: string }) {
  const rows = await db.select().from(recordChanges).where(and(
    eq(recordChanges.tenantId, params.tenantId),
    eq(recordChanges.appId, params.appId),
    eq(recordChanges.proposalId, params.proposalId),
  ));
  if (rows.length === 0) return false;
  for (const change of rows) {
    const [current] = await db.select().from(records).where(and(eq(records.id, change.recordId), eq(records.tenantId, params.tenantId))).limit(1);
    if (current && current.updatedAt.getTime() > change.createdAt.getTime() + 1000) return false;
  }
  for (const change of rows) {
    if (change.op === 'create') {
      await db.delete(records).where(and(eq(records.id, change.recordId), eq(records.tenantId, params.tenantId)));
    } else if (change.before) {
      await db.update(records).set({ data: change.before, updatedAt: new Date() }).where(and(eq(records.id, change.recordId), eq(records.tenantId, params.tenantId)));
    }
  }
  return true;
}
