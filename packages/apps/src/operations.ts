import type { AppSpec, DashboardWidget, EntitySpec, FieldSpec, FieldType, ViewSpec } from './spec';
import { entityOf, FIELD_TYPES, parseAppSpec } from './spec';
import { isSensitiveName, isSpecialName } from './classification';

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

export type DataOperation = Extract<AppOperation, { op: 'convertFieldType' | 'splitField' | 'computeField' | 'fillDefault' | 'extractEntity' }>;

const FIELD_TYPE_SET = new Set<string>(FIELD_TYPES);
const KEY = /^[a-z][a-z0-9_]{0,63}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asField(value: unknown): FieldSpec | null {
  if (!isRecord(value) || typeof value.key !== 'string' || !KEY.test(value.key) || typeof value.label !== 'string') return null;
  if (typeof value.type !== 'string' || !FIELD_TYPE_SET.has(value.type)) return null;
  const sensitive = value.sensitive === true || isSensitiveName(value.key, value.label);
  const specialCategory = value.specialCategory === true || isSpecialName(value.key, value.label);
  return {
    key: value.key,
    label: value.label.slice(0, 120),
    type: value.type as FieldType,
    required: value.required === true,
    visible: sensitive || specialCategory ? false : value.visible !== false,
    editable: sensitive || specialCategory || value.type === 'computed' ? false : value.editable !== false,
    sensitive,
    specialCategory,
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
      const type = typeof item.patch.type === 'string' && FIELD_TYPE_SET.has(item.patch.type) ? item.patch.type as FieldType : undefined;
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
    } else if (op === 'convertFieldType' && typeof item.entityKey === 'string' && typeof item.fieldKey === 'string' && typeof item.type === 'string' && FIELD_TYPE_SET.has(item.type)) {
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
      if (field.sensitive || field.specialCategory) {
        field.visible = false;
        field.editable = false;
      }
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
    } else if (operation.op === 'computeField') {
      const entity = entityOf(next, operation.entityKey);
      if (!entity) throw new Error('Lista inexistente.');
      if (!entity.fields.some((field) => field.key === operation.fieldKey)) {
        entity.fields.push({
          key: operation.fieldKey,
          label: operation.fieldKey,
          type: 'computed',
          required: false,
          visible: true,
          editable: false,
          sensitive: false,
          specialCategory: false,
        });
      }
    }
  }
  const parsed = parseAppSpec(next);
  if (!parsed) throw new Error('La spec resultante no es válida.');
  return parsed;
}

export function isDataOperation(operation: AppOperation): operation is DataOperation {
  return operation.op === 'convertFieldType' || operation.op === 'splitField' || operation.op === 'computeField' || operation.op === 'fillDefault' || operation.op === 'extractEntity';
}

export function dataOperationEntityKey(operation: AppOperation): string | null {
  if (!isDataOperation(operation)) return null;
  return 'entityKey' in operation ? operation.entityKey : operation.sourceEntity;
}
