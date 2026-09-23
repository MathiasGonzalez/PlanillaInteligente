export const FIELD_TYPES = [
  'text',
  'long-text',
  'number',
  'amount',
  'date',
  'boolean',
  'email',
  'phone',
  'url',
  'status',
  'category',
  'identifier',
  'relation',
  'computed',
] as const;

export const VIEW_TYPES = ['table', 'kanban', 'detail', 'form'] as const;
export const WIDGET_TYPES = ['kpi', 'bar', 'line'] as const;
export const METRIC_OPS = ['count', 'sum', 'avg'] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
export type ViewType = (typeof VIEW_TYPES)[number];
export type WidgetType = (typeof WIDGET_TYPES)[number];
export type MetricOp = (typeof METRIC_OPS)[number];

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  visible: boolean;
  editable: boolean;
  sensitive: boolean;
  specialCategory: boolean;
  options?: string[];
  currency?: string | null;
  relation?: { toEntity: string } | null;
  formula?: string | null;
}

export interface EntitySpec {
  key: string;
  name: string;
  sourceSheet: string | null;
  primaryFieldKey: string | null;
  statusFieldKey: string | null;
  fields: FieldSpec[];
}

export interface RelationSpec {
  fromEntity: string;
  fieldKey: string;
  toEntity: string;
  cardinality: 'many-to-one';
  origin: 'detected' | 'manual' | 'instruction';
}

export interface ViewSpec {
  key: string;
  entityKey: string;
  type: ViewType;
  title: string;
  filters: Array<{ fieldKey: string; op: 'eq' | 'contains'; value: string }>;
  sort: { fieldKey: string; direction: 'asc' | 'desc' } | null;
  groupBy: string | null;
  visibleFields: string[];
}

export interface DashboardWidget {
  key: string;
  type: WidgetType;
  title: string;
  entityKey: string;
  metric: { op: MetricOp; fieldKey: string | null };
  groupBy: string | null;
  dateBucket: 'month' | null;
}

export interface DashboardSpec {
  key: string;
  title: string;
  widgets: DashboardWidget[];
}

export interface AppSpec {
  version: '2';
  title: string;
  summary: string;
  entities: EntitySpec[];
  relations: RelationSpec[];
  views: ViewSpec[];
  dashboards: DashboardSpec[];
}

const KEY = /^[a-z][a-z0-9_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value);
}

function readField(value: unknown, entityKeys: Set<string>): FieldSpec | null {
  if (!isRecord(value) || typeof value.key !== 'string' || !KEY.test(value.key) || typeof value.label !== 'string' || !isFieldType(value.type)) {
    return null;
  }
  const relation = isRecord(value.relation) && typeof value.relation.toEntity === 'string'
    ? { toEntity: value.relation.toEntity }
    : null;
  if (relation && !entityKeys.has(relation.toEntity)) {
    return null;
  }
  return {
    key: value.key,
    label: value.label.slice(0, 120),
    type: value.type,
    required: value.required === true,
    visible: value.visible !== false,
    editable: value.type === 'computed' || value.type === 'identifier' ? false : value.editable !== false,
    sensitive: value.sensitive === true,
    specialCategory: value.specialCategory === true,
    options: Array.isArray(value.options) ? value.options.filter((item): item is string => typeof item === 'string').slice(0, 40) : undefined,
    currency: typeof value.currency === 'string' ? value.currency : null,
    relation,
    formula: typeof value.formula === 'string' ? value.formula : null,
  };
}

export function parseAppSpec(value: unknown): AppSpec | null {
  if (!isRecord(value) || value.version !== '2' || typeof value.title !== 'string' || !Array.isArray(value.entities)) {
    return null;
  }
  const entityKeys = new Set(
    value.entities.filter(isRecord).map((entity) => entity.key).filter((key): key is string => typeof key === 'string'),
  );
  const entities: EntitySpec[] = [];
  for (const raw of value.entities) {
    if (!isRecord(raw) || typeof raw.key !== 'string' || !KEY.test(raw.key) || typeof raw.name !== 'string' || !Array.isArray(raw.fields)) {
      return null;
    }
    const fields = raw.fields.map((field) => readField(field, entityKeys)).filter((field): field is FieldSpec => field !== null);
    if (fields.length !== raw.fields.length || new Set(fields.map((field) => field.key)).size !== fields.length) {
      return null;
    }
    const fieldKeys = new Set(fields.map((field) => field.key));
    const primary = typeof raw.primaryFieldKey === 'string' && fieldKeys.has(raw.primaryFieldKey) ? raw.primaryFieldKey : fields[0]?.key ?? null;
    const status = typeof raw.statusFieldKey === 'string' && fieldKeys.has(raw.statusFieldKey) ? raw.statusFieldKey : null;
    entities.push({
      key: raw.key,
      name: raw.name.slice(0, 120),
      sourceSheet: typeof raw.sourceSheet === 'string' ? raw.sourceSheet : null,
      primaryFieldKey: primary,
      statusFieldKey: status,
      fields,
    });
  }
  const known = new Set(entities.map((entity) => entity.key));
  const relations: RelationSpec[] = [];
  if (Array.isArray(value.relations)) {
    for (const raw of value.relations) {
      if (!isRecord(raw) || typeof raw.fromEntity !== 'string' || typeof raw.fieldKey !== 'string' || typeof raw.toEntity !== 'string') {
        return null;
      }
      const from = entities.find((entity) => entity.key === raw.fromEntity);
      if (!from || !known.has(raw.toEntity) || !from.fields.some((field) => field.key === raw.fieldKey)) {
        return null;
      }
      const origin = raw.origin === 'manual' || raw.origin === 'instruction' || raw.origin === 'detected' ? raw.origin : 'manual';
      relations.push({ fromEntity: raw.fromEntity, fieldKey: raw.fieldKey, toEntity: raw.toEntity, cardinality: 'many-to-one', origin });
    }
  }
  const views: ViewSpec[] = [];
  if (Array.isArray(value.views)) {
    for (const raw of value.views) {
      if (!isRecord(raw) || typeof raw.key !== 'string' || !KEY.test(raw.key) || typeof raw.entityKey !== 'string' || !known.has(raw.entityKey)) {
        return null;
      }
      const type = (VIEW_TYPES as readonly string[]).includes(String(raw.type)) ? raw.type as ViewType : null;
      if (!type) return null;
      const entity = entities.find((item) => item.key === raw.entityKey);
      const fieldKeys = new Set(entity?.fields.map((field) => field.key) ?? []);
      const visibleFields = Array.isArray(raw.visibleFields)
        ? raw.visibleFields.filter((key): key is string => typeof key === 'string' && fieldKeys.has(key))
        : [...fieldKeys];
      views.push({
        key: raw.key,
        entityKey: raw.entityKey,
        type,
        title: typeof raw.title === 'string' ? raw.title.slice(0, 120) : entity?.name ?? raw.entityKey,
        filters: [],
        sort: isRecord(raw.sort) && typeof raw.sort.fieldKey === 'string' && fieldKeys.has(raw.sort.fieldKey)
          ? { fieldKey: raw.sort.fieldKey, direction: raw.sort.direction === 'desc' ? 'desc' : 'asc' }
          : null,
        groupBy: typeof raw.groupBy === 'string' && fieldKeys.has(raw.groupBy) ? raw.groupBy : null,
        visibleFields,
      });
    }
  }
  const dashboards: DashboardSpec[] = [];
  if (Array.isArray(value.dashboards)) {
    for (const raw of value.dashboards) {
      if (!isRecord(raw) || typeof raw.key !== 'string' || !Array.isArray(raw.widgets)) return null;
      const widgets: DashboardWidget[] = [];
      for (const widget of raw.widgets) {
        if (!isRecord(widget) || typeof widget.key !== 'string' || typeof widget.entityKey !== 'string' || !known.has(widget.entityKey)) return null;
        const type = (WIDGET_TYPES as readonly string[]).includes(String(widget.type)) ? widget.type as WidgetType : null;
        if (!type || !isRecord(widget.metric)) return null;
        const op = (METRIC_OPS as readonly string[]).includes(String(widget.metric.op)) ? widget.metric.op as MetricOp : null;
        if (!op) return null;
        const entity = entities.find((item) => item.key === widget.entityKey);
        const fieldKey = typeof widget.metric.fieldKey === 'string' ? widget.metric.fieldKey : null;
        if (fieldKey && !entity?.fields.some((field) => field.key === fieldKey)) return null;
        const groupBy = typeof widget.groupBy === 'string' ? widget.groupBy : null;
        if (groupBy && !entity?.fields.some((field) => field.key === groupBy)) return null;
        widgets.push({
          key: widget.key,
          type,
          title: typeof widget.title === 'string' ? widget.title.slice(0, 120) : widget.key,
          entityKey: widget.entityKey,
          metric: { op, fieldKey },
          groupBy,
          dateBucket: widget.dateBucket === 'month' ? 'month' : null,
        });
      }
      dashboards.push({ key: raw.key, title: typeof raw.title === 'string' ? raw.title : 'Resumen', widgets });
    }
  }
  return {
    version: '2',
    title: value.title.slice(0, 160),
    summary: typeof value.summary === 'string' ? value.summary.slice(0, 500) : '',
    entities,
    relations,
    views,
    dashboards,
  };
}

export function entityOf(spec: AppSpec, key: string) {
  return spec.entities.find((entity) => entity.key === key) ?? null;
}

export function visibleFields(entity: EntitySpec) {
  return entity.fields.filter((field) => field.visible && !field.sensitive && !field.specialCategory);
}

export interface SpecDiffLine {
  kind: 'add' | 'remove' | 'change';
  path: string;
  detail: string;
}

export function diffSpecs(before: AppSpec, after: AppSpec): SpecDiffLine[] {
  const lines: SpecDiffLine[] = [];
  if (before.title !== after.title) lines.push({ kind: 'change', path: 'title', detail: `${before.title} → ${after.title}` });
  if (before.summary !== after.summary) lines.push({ kind: 'change', path: 'summary', detail: 'Cambió el resumen' });
  const beforeEntities = new Map(before.entities.map((entity) => [entity.key, entity]));
  const afterEntities = new Map(after.entities.map((entity) => [entity.key, entity]));
  for (const [key, entity] of afterEntities) {
    const previous = beforeEntities.get(key);
    if (!previous) {
      lines.push({ kind: 'add', path: `entities.${key}`, detail: `Nueva lista ${entity.name}` });
      continue;
    }
    if (previous.name !== entity.name) lines.push({ kind: 'change', path: `entities.${key}.name`, detail: `${previous.name} → ${entity.name}` });
    const previousFields = new Map(previous.fields.map((field) => [field.key, field]));
    for (const field of entity.fields) {
      const old = previousFields.get(field.key);
      if (!old) lines.push({ kind: 'add', path: `entities.${key}.fields.${field.key}`, detail: `Campo ${field.label}` });
      else if (old.type !== field.type || old.visible !== field.visible || old.required !== field.required) {
        lines.push({ kind: 'change', path: `entities.${key}.fields.${field.key}`, detail: `${old.type} → ${field.type}` });
      }
    }
    for (const field of previous.fields) {
      if (!entity.fields.some((item) => item.key === field.key)) {
        lines.push({ kind: 'remove', path: `entities.${key}.fields.${field.key}`, detail: `Se archivó ${field.label}` });
      }
    }
  }
  for (const key of beforeEntities.keys()) {
    if (!afterEntities.has(key)) lines.push({ kind: 'remove', path: `entities.${key}`, detail: 'Lista eliminada' });
  }
  return lines;
}
