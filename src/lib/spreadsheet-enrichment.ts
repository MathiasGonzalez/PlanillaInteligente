import { and, asc, eq } from 'drizzle-orm';
import { spreadsheetColumns, rowEntries, spreadsheetEnrichments, spreadsheets } from '../db/schema';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from '../db/schema';
import {
  SPREADSHEET_SEMANTIC_TYPES,
  SPREADSHEET_VIEW_TYPES,
  type SpreadsheetColumnEnrichment,
  type SpreadsheetEnrichmentConfiguration,
  type SpreadsheetEnrichmentMessage,
  type SpreadsheetEnrichmentProvider,
  type SpreadsheetEnrichmentStatus,
  type SpreadsheetSemanticType,
  type SpreadsheetTriggerSource,
  type SpreadsheetViewRecommendation,
  type SpreadsheetViewType,
} from './spreadsheet-enrichment-types';

const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DEFAULT_TITLE_SUFFIX = 'Workspace';
const DEFAULT_SUMMARY = 'Configuración base generada a partir del esquema de la planilla.';
const SENSITIVE_PATTERN = /(password|secret|token|api[_ -]?key|clave|dni|rut|cuit|ssn|card|tarjeta)/i;
const SEMANTIC_PATTERNS: Array<{ semanticType: SpreadsheetSemanticType; pattern: RegExp }> = [
  { semanticType: 'email', pattern: /(email|correo|mail)/i },
  { semanticType: 'amount', pattern: /(amount|monto|price|precio|total|cost|costo|importe|revenue)/i },
  { semanticType: 'status', pattern: /(status|estado|stage|etapa)/i },
  { semanticType: 'date', pattern: /(date|fecha|deadline|due|venc)/i },
  { semanticType: 'category', pattern: /(category|categoria|type|tipo|segment)/i },
  { semanticType: 'assignee', pattern: /(owner|assignee|responsable|agent|usuario)/i },
  { semanticType: 'phone', pattern: /(phone|telefono|celular|mobile|whatsapp)/i },
  { semanticType: 'url', pattern: /(url|link|website|sitio|web)/i },
  { semanticType: 'identifier', pattern: /(^id$|_id$|identifier|folio|codigo|code|sku)/i },
  { semanticType: 'name', pattern: /(name|nombre|cliente|company|empresa|contact)/i },
  { semanticType: 'long-text', pattern: /(description|descripcion|notes|notas|comment|comentario|detalle)/i },
];

type Database = DrizzleD1Database<typeof schema>;

type WorkersAiBinding = {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
};

type QueueBinding<T> = {
  send(message: T): Promise<void>;
};

export interface SpreadsheetEnrichmentEnv {
  AI?: WorkersAiBinding;
  ENRICHMENT_QUEUE?: QueueBinding<SpreadsheetEnrichmentMessage>;
  WORKERS_AI_MODEL?: string;
  AI_GATEWAY_ID?: string;
}

interface ColumnContext {
  key: string;
  label: string;
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'json';
  columnIndex: number;
  required: boolean;
}

interface SpreadsheetContext {
  spreadsheetId: string;
  name: string;
  sheetName: string | null;
  columns: ColumnContext[];
  sampleRows: Record<string, unknown>[];
}

interface ScheduleSpreadsheetEnrichmentOptions {
  db: Database;
  env: SpreadsheetEnrichmentEnv;
  tenantId: string;
  spreadsheetId: string;
  requestedByUserId: string;
  triggeredBy: SpreadsheetTriggerSource;
}

interface RunSpreadsheetEnrichmentOptions {
  db: Database;
  env: SpreadsheetEnrichmentEnv;
  tenantId: string;
  spreadsheetId: string;
  triggeredBy: SpreadsheetTriggerSource;
}

export interface SpreadsheetEnrichmentOutcome {
  status: SpreadsheetEnrichmentStatus;
  mode: 'queue' | 'inline';
  generatedBy: SpreadsheetEnrichmentProvider | null;
  model: string | null;
  fallbackUsed: boolean;
  errorMessage: string | null;
  config: SpreadsheetEnrichmentConfiguration | null;
}

function getEnrichmentRecordId(tenantId: string, spreadsheetId: string) {
  return `${tenantId}:${spreadsheetId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function summarizeValue(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return JSON.stringify(value);
}

function getSampleValues(sampleRows: Record<string, unknown>[], key: string) {
  return sampleRows
    .map((row) => summarizeValue(row[key]))
    .filter((value): value is string | number | boolean => value !== null)
    .slice(0, 5);
}

function isEmailValue(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUrlValue(value: string) {
  return /^https?:\/\//i.test(value);
}

function isPhoneValue(value: string) {
  return /^\+?[0-9()\-\s]{7,}$/.test(value);
}

function isStatusLabel(value: string) {
  return /(pending|done|open|closed|won|lost|nuevo|progreso|bloqueado|activo|inactivo|draft)/i.test(value);
}

function inferSemanticType(column: ColumnContext, sampleRows: Record<string, unknown>[]): SpreadsheetSemanticType {
  if (SENSITIVE_PATTERN.test(column.key) || SENSITIVE_PATTERN.test(column.label)) {
    return 'sensitive';
  }

  for (const matcher of SEMANTIC_PATTERNS) {
    if (matcher.pattern.test(column.key) || matcher.pattern.test(column.label)) {
      return matcher.semanticType;
    }
  }

  const values = getSampleValues(sampleRows, column.key);
  if (column.dataType === 'boolean') {
    return 'boolean';
  }

  if (column.dataType === 'number') {
    return values.some((value) => typeof value === 'number' && Math.abs(value) > 999) ? 'amount' : 'number';
  }

  if (column.dataType === 'date') {
    return 'date';
  }

  if (values.length > 0 && values.every((value) => typeof value === 'string' && isEmailValue(value))) {
    return 'email';
  }

  if (values.length > 0 && values.every((value) => typeof value === 'string' && isUrlValue(value))) {
    return 'url';
  }

  if (values.length > 0 && values.every((value) => typeof value === 'string' && isPhoneValue(value))) {
    return 'phone';
  }

  const distinctTextValues = Array.from(
    new Set(values.filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase())),
  );

  if (distinctTextValues.length > 0 && distinctTextValues.length <= 8 && distinctTextValues.every(isStatusLabel)) {
    return 'status';
  }

  return column.dataType === 'json' ? 'unknown' : 'text';
}

function buildHelpText(semanticType: SpreadsheetSemanticType, displayLabel: string) {
  switch (semanticType) {
    case 'email':
      return `Usa ${displayLabel} para comunicaciones o login del registro.`;
    case 'amount':
      return `Usa ${displayLabel} para métricas monetarias o importes.`;
    case 'status':
      return `Usa ${displayLabel} para agrupar el flujo de trabajo y el kanban.`;
    case 'date':
      return `Usa ${displayLabel} para ordenar hitos, vencimientos o seguimiento temporal.`;
    case 'category':
      return `Usa ${displayLabel} para segmentar y filtrar registros.`;
    case 'assignee':
      return `Usa ${displayLabel} para asignar responsables dentro del workspace.`;
    case 'phone':
      return `Usa ${displayLabel} para contacto rápido del registro.`;
    case 'url':
      return `Usa ${displayLabel} para enlazar recursos externos.`;
    case 'identifier':
      return `Usa ${displayLabel} como referencia única o código operativo.`;
    case 'long-text':
      return `Usa ${displayLabel} para detalle amplio o notas.`;
    case 'sensitive':
      return `Usa ${displayLabel} con visibilidad restringida por su sensibilidad.`;
    default:
      return `Campo ${displayLabel} disponible para formularios y tablas dinámicas.`;
  }
}

function pickDefaultSortKey(columns: SpreadsheetColumnEnrichment[]) {
  const preferred = columns.find((column) => column.semanticType === 'date')
    ?? columns.find((column) => column.semanticType === 'status')
    ?? columns.find((column) => column.semanticType === 'name')
    ?? columns[0];

  return preferred?.key ?? null;
}

function buildRecommendedViews(
  spreadsheetName: string,
  columns: SpreadsheetColumnEnrichment[],
  kanbanColumnKey: string | null,
): SpreadsheetViewRecommendation[] {
  const filterKeys = columns.filter((column) => column.filterable).slice(0, 3).map((column) => column.key);
  const defaultSortKey = pickDefaultSortKey(columns);
  const views: SpreadsheetViewRecommendation[] = [
    {
      type: 'table',
      enabled: true,
      title: `${spreadsheetName} table`,
      description: 'Vista tabular para navegación, filtros y edición rápida.',
      defaultSortKey,
      defaultFilterKeys: filterKeys,
      groupingColumnKey: null,
    },
    {
      type: 'form',
      enabled: true,
      title: `${spreadsheetName} form`,
      description: 'Formulario para alta y edición detallada de registros.',
      defaultSortKey: null,
      defaultFilterKeys: [],
      groupingColumnKey: null,
    },
    {
      type: 'kanban',
      enabled: Boolean(kanbanColumnKey),
      title: `${spreadsheetName} kanban`,
      description: 'Tablero visual agrupado por estado o categoría principal.',
      defaultSortKey,
      defaultFilterKeys: filterKeys,
      groupingColumnKey: kanbanColumnKey,
    },
    {
      type: 'dashboard',
      enabled: columns.some((column) => column.semanticType === 'amount' || column.semanticType === 'number'),
      title: `${spreadsheetName} dashboard`,
      description: 'Resumen rápido con métricas y segmentos relevantes.',
      defaultSortKey,
      defaultFilterKeys: filterKeys,
      groupingColumnKey: null,
    },
  ];

  return views;
}

function buildHeuristicConfiguration(context: SpreadsheetContext): SpreadsheetEnrichmentConfiguration {
  const columns = context.columns
    .map<SpreadsheetColumnEnrichment>((column, index) => {
      const semanticType = inferSemanticType(column, context.sampleRows);
      const displayLabel = titleCase(column.label || column.key);
      const sensitive = semanticType === 'sensitive';
      const groupable = semanticType === 'status' || semanticType === 'category' || semanticType === 'assignee';
      const editable = semanticType !== 'identifier' && !sensitive;
      const filterable = semanticType !== 'long-text' && semanticType !== 'unknown';

      return {
        key: column.key,
        label: column.label,
        dataType: column.dataType,
        semanticType,
        displayLabel,
        helpText: buildHelpText(semanticType, displayLabel),
        visible: !sensitive,
        editable,
        required: column.required || semanticType === 'name' || semanticType === 'email',
        sensitive,
        filterable,
        groupable,
        order: index,
      };
    })
    .sort((left, right) => left.order - right.order);

  const kanbanColumnKey = columns.find((column) => column.semanticType === 'status' || column.semanticType === 'category')?.key ?? null;
  const spreadsheetName = titleCase(context.name || context.sheetName || DEFAULT_TITLE_SUFFIX);
  const recommendedViews = buildRecommendedViews(spreadsheetName, columns, kanbanColumnKey);
  const primaryView = (kanbanColumnKey ? 'kanban' : 'table') satisfies SpreadsheetViewType;

  return {
    version: '1',
    title: `${spreadsheetName} ${DEFAULT_TITLE_SUFFIX}`,
    summary: DEFAULT_SUMMARY,
    primaryView,
    recommendedViews,
    kanbanColumnKey,
    columns,
    generatedBy: 'heuristic',
    model: null,
  };
}

function parseJsonObject(value: string) {
  const direct = value.trim();
  const candidates = [direct];
  const fenced = direct.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? direct.match(/```\s*([\s\S]*?)```/i)?.[1];

  if (fenced) {
    candidates.push(fenced.trim());
  }

  const bracketStart = direct.indexOf('{');
  const bracketEnd = direct.lastIndexOf('}');
  if (bracketStart >= 0 && bracketEnd > bracketStart) {
    candidates.push(direct.slice(bracketStart, bracketEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore malformed candidate and keep trying fallbacks.
    }
  }

  return null;
}

function extractAiPayload(value: unknown) {
  if (isRecord(value)) {
    if (typeof value.response === 'string') {
      return parseJsonObject(value.response);
    }

    if (Array.isArray(value.result)) {
      const content = value.result
        .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : null))
        .filter((item): item is string => Boolean(item))
        .join('\n');
      return content ? parseJsonObject(content) : null;
    }

    if (Array.isArray(value.content)) {
      const content = value.content
        .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : null))
        .filter((item): item is string => Boolean(item))
        .join('\n');
      return content ? parseJsonObject(content) : null;
    }

    if ('title' in value || 'columns' in value || 'recommendedViews' in value) {
      return value;
    }
  }

  if (typeof value === 'string') {
    return parseJsonObject(value);
  }

  return null;
}

function isSemanticType(value: unknown): value is SpreadsheetSemanticType {
  return typeof value === 'string' && SPREADSHEET_SEMANTIC_TYPES.includes(value as SpreadsheetSemanticType);
}

function isViewType(value: unknown): value is SpreadsheetViewType {
  return typeof value === 'string' && SPREADSHEET_VIEW_TYPES.includes(value as SpreadsheetViewType);
}

function normalizeViewRecommendations(
  base: SpreadsheetViewRecommendation[],
  candidate: unknown,
  validColumnKeys: Set<string>,
  fallbackPrimaryView: SpreadsheetViewType,
) {
  if (!Array.isArray(candidate)) {
    return base;
  }

  const baseMap = new Map(base.map((view) => [view.type, view]));
  const merged = base.map((view) => {
    const suggested = candidate.find((item) => isRecord(item) && item.type === view.type);
    if (!suggested || !isRecord(suggested)) {
      return view;
    }

    const groupingColumnKey = typeof suggested.groupingColumnKey === 'string' && validColumnKeys.has(suggested.groupingColumnKey)
      ? suggested.groupingColumnKey
      : view.groupingColumnKey;
    const defaultSortKey = typeof suggested.defaultSortKey === 'string' && validColumnKeys.has(suggested.defaultSortKey)
      ? suggested.defaultSortKey
      : view.defaultSortKey;

    return {
      type: view.type,
      enabled: typeof suggested.enabled === 'boolean' ? suggested.enabled : view.enabled,
      title: typeof suggested.title === 'string' ? suggested.title : view.title,
      description: typeof suggested.description === 'string' ? suggested.description : view.description,
      defaultSortKey,
      defaultFilterKeys: Array.isArray(suggested.defaultFilterKeys)
        ? suggested.defaultFilterKeys.filter((key): key is string => typeof key === 'string' && validColumnKeys.has(key))
        : view.defaultFilterKeys,
      groupingColumnKey,
    } satisfies SpreadsheetViewRecommendation;
  });

  if (!merged.some((view) => view.type === fallbackPrimaryView && view.enabled)) {
    const primaryView = baseMap.get(fallbackPrimaryView);
    if (primaryView) {
      return merged.map((view) => (view.type === fallbackPrimaryView ? { ...view, enabled: true } : view));
    }
  }

  return merged;
}

function normalizeAiConfiguration(
  baseConfig: SpreadsheetEnrichmentConfiguration,
  candidate: unknown,
  model: string,
): SpreadsheetEnrichmentConfiguration {
  if (!isRecord(candidate)) {
    return baseConfig;
  }

  const validColumnKeys = new Set(baseConfig.columns.map((column) => column.key));
  const suggestedColumns = new Map(
    Array.isArray(candidate.columns)
      ? candidate.columns
          .filter(isRecord)
          .map((column) => [typeof column.key === 'string' ? column.key : '', column] as const)
          .filter(([key]) => key && validColumnKeys.has(key))
      : [],
  );

  const columns = baseConfig.columns
    .map((column, index) => {
      const suggestion = suggestedColumns.get(column.key);
      if (!suggestion) {
        return column;
      }

      return {
        ...column,
        semanticType: isSemanticType(suggestion.semanticType) ? suggestion.semanticType : column.semanticType,
        displayLabel: typeof suggestion.displayLabel === 'string' ? suggestion.displayLabel : column.displayLabel,
        helpText: typeof suggestion.helpText === 'string' ? suggestion.helpText : column.helpText,
        visible: typeof suggestion.visible === 'boolean' ? suggestion.visible : column.visible,
        editable: typeof suggestion.editable === 'boolean' ? suggestion.editable : column.editable,
        required: typeof suggestion.required === 'boolean' ? suggestion.required : column.required,
        sensitive: typeof suggestion.sensitive === 'boolean' ? suggestion.sensitive : column.sensitive,
        filterable: typeof suggestion.filterable === 'boolean' ? suggestion.filterable : column.filterable,
        groupable: typeof suggestion.groupable === 'boolean' ? suggestion.groupable : column.groupable,
        order:
          typeof suggestion.order === 'number' && Number.isFinite(suggestion.order)
            ? Math.max(0, Math.min(baseConfig.columns.length - 1, Math.round(suggestion.order)))
            : column.order ?? index,
      } satisfies SpreadsheetColumnEnrichment;
    })
    .sort((left, right) => left.order - right.order)
    .map((column, index) => ({ ...column, order: index }));

  const fallbackPrimaryView = baseConfig.primaryView;
  const recommendedViews = normalizeViewRecommendations(baseConfig.recommendedViews, candidate.recommendedViews, validColumnKeys, fallbackPrimaryView);
  const suggestedPrimaryView = isViewType(candidate.primaryView) ? candidate.primaryView : fallbackPrimaryView;
  const kanbanColumnKey = typeof candidate.kanbanColumnKey === 'string' && validColumnKeys.has(candidate.kanbanColumnKey)
    ? candidate.kanbanColumnKey
    : columns.find((column) => column.semanticType === 'status' || column.semanticType === 'category')?.key ?? null;
  const primaryView =
    suggestedPrimaryView === 'kanban' && !kanbanColumnKey
      ? 'table'
      : recommendedViews.some((view) => view.type === suggestedPrimaryView && view.enabled)
        ? suggestedPrimaryView
        : fallbackPrimaryView;

  return {
    ...baseConfig,
    title: typeof candidate.title === 'string' ? candidate.title : baseConfig.title,
    summary: typeof candidate.summary === 'string' ? candidate.summary : baseConfig.summary,
    primaryView,
    kanbanColumnKey,
    recommendedViews,
    columns,
    generatedBy: 'workers-ai',
    model,
  };
}

function buildAiPrompt(context: SpreadsheetContext, heuristic: SpreadsheetEnrichmentConfiguration) {
  return {
    spreadsheet: {
      name: context.name,
      sheetName: context.sheetName,
    },
    columns: context.columns.map((column) => ({
      key: column.key,
      label: column.label,
      dataType: column.dataType,
      required: column.required,
      sampleValues: getSampleValues(context.sampleRows, column.key),
    })),
    sampleRows: context.sampleRows.slice(0, 5),
    currentHeuristic: heuristic,
  };
}

async function loadSpreadsheetContext(db: Database, tenantId: string, spreadsheetId: string): Promise<SpreadsheetContext> {
  const [spreadsheet] = await db
    .select({
      id: spreadsheets.id,
      name: spreadsheets.name,
      sheetName: spreadsheets.sheetName,
    })
    .from(spreadsheets)
    .where(and(eq(spreadsheets.id, spreadsheetId), eq(spreadsheets.tenantId, tenantId)))
    .limit(1);

  if (!spreadsheet) {
    throw new Error('Spreadsheet not found for AI enrichment.');
  }

  const [columns, rows] = await Promise.all([
    db
      .select({
        key: spreadsheetColumns.key,
        label: spreadsheetColumns.label,
        dataType: spreadsheetColumns.dataType,
        columnIndex: spreadsheetColumns.columnIndex,
        required: spreadsheetColumns.required,
      })
      .from(spreadsheetColumns)
      .where(and(eq(spreadsheetColumns.tenantId, tenantId), eq(spreadsheetColumns.spreadsheetId, spreadsheetId)))
      .orderBy(asc(spreadsheetColumns.columnIndex)),
    db
      .select({
        data: rowEntries.data,
      })
      .from(rowEntries)
      .where(and(eq(rowEntries.tenantId, tenantId), eq(rowEntries.spreadsheetId, spreadsheetId)))
      .orderBy(asc(rowEntries.rowIndex))
      .limit(5),
  ]);

  return {
    spreadsheetId: spreadsheet.id,
    name: spreadsheet.name,
    sheetName: spreadsheet.sheetName,
    columns,
    sampleRows: rows.map((row) => row.data as Record<string, unknown>),
  };
}

async function upsertEnrichmentRecord(
  db: Database,
  params: {
    tenantId: string;
    spreadsheetId: string;
    status: SpreadsheetEnrichmentStatus;
    provider: SpreadsheetEnrichmentProvider;
    model?: string | null;
    config?: SpreadsheetEnrichmentConfiguration | null;
    errorMessage?: string | null;
    triggeredBy: SpreadsheetTriggerSource;
    lastEnqueuedAt?: Date | null;
    lastProcessedAt?: Date | null;
  },
) {
  const now = new Date();
  const enrichmentId = getEnrichmentRecordId(params.tenantId, params.spreadsheetId);

  await db
    .insert(spreadsheetEnrichments)
    .values({
      id: enrichmentId,
      tenantId: params.tenantId,
      spreadsheetId: params.spreadsheetId,
      status: params.status,
      provider: params.provider,
      model: params.model ?? null,
      config: params.config ?? null,
      errorMessage: params.errorMessage ?? null,
      lastTriggeredBy: params.triggeredBy,
      lastEnqueuedAt: params.lastEnqueuedAt ?? null,
      lastProcessedAt: params.lastProcessedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: spreadsheetEnrichments.id,
      set: {
        status: params.status,
        provider: params.provider,
        model: params.model ?? null,
        config: params.config ?? null,
        errorMessage: params.errorMessage ?? null,
        lastTriggeredBy: params.triggeredBy,
        lastEnqueuedAt: params.lastEnqueuedAt ?? null,
        lastProcessedAt: params.lastProcessedAt ?? null,
        updatedAt: now,
      },
    });
}

async function runWorkersAiInference(
  env: SpreadsheetEnrichmentEnv,
  context: SpreadsheetContext,
  heuristic: SpreadsheetEnrichmentConfiguration,
) {
  if (!env.AI) {
    return null;
  }

  const model = env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL;
  const input = {
    messages: [
      {
        role: 'system',
        content:
          'Eres un arquitecto SaaS multi-tenant. Devuelve solo JSON válido con title, summary, primaryView, kanbanColumnKey, recommendedViews y columns. No inventes columnas nuevas. Prioriza tabla/formulario y usa kanban solo si hay estado o categoría claros. Marca columnas sensibles como sensitive=true y visible=false.',
      },
      {
        role: 'user',
        content: JSON.stringify(buildAiPrompt(context, heuristic)),
      },
    ],
    response_format: { type: 'json_object' },
  };

  const options = env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined;
  const rawResponse = await env.AI.run(model, input, options);
  const parsed = extractAiPayload(rawResponse);

  if (!parsed) {
    throw new Error('Workers AI did not return a parseable JSON configuration.');
  }

  return normalizeAiConfiguration(heuristic, parsed, model);
}

export async function runSpreadsheetEnrichment({
  db,
  env,
  tenantId,
  spreadsheetId,
  triggeredBy,
}: RunSpreadsheetEnrichmentOptions): Promise<SpreadsheetEnrichmentOutcome> {
  await upsertEnrichmentRecord(db, {
    tenantId,
    spreadsheetId,
    status: 'processing',
    provider: env.AI ? 'workers-ai' : 'heuristic',
    model: env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL,
    triggeredBy,
  });

  try {
    const context = await loadSpreadsheetContext(db, tenantId, spreadsheetId);
    const heuristic = buildHeuristicConfiguration(context);
    let config = heuristic;
    let generatedBy: SpreadsheetEnrichmentProvider = 'heuristic';
    let fallbackUsed = false;
    let errorMessage: string | null = null;
    const selectedModel = env.AI ? env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL : null;

    if (env.AI) {
      try {
        const aiConfig = await runWorkersAiInference(env, context, heuristic);
        if (aiConfig) {
          config = aiConfig;
          generatedBy = 'workers-ai';
        }
      } catch (error) {
        fallbackUsed = true;
        errorMessage = error instanceof Error ? error.message : 'Workers AI inference failed.';
      }
    }

    await upsertEnrichmentRecord(db, {
      tenantId,
      spreadsheetId,
      status: 'completed',
      provider: generatedBy,
      model: config.model ?? selectedModel,
      config,
      errorMessage,
      triggeredBy,
      lastProcessedAt: new Date(),
    });

    return {
      status: 'completed',
      mode: 'inline',
      generatedBy,
      model: config.model ?? selectedModel,
      fallbackUsed,
      errorMessage,
      config,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Spreadsheet enrichment failed.';

    await upsertEnrichmentRecord(db, {
      tenantId,
      spreadsheetId,
      status: 'failed',
      provider: env.AI ? 'workers-ai' : 'heuristic',
      model: env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL,
      errorMessage,
      triggeredBy,
      lastProcessedAt: new Date(),
    });

    return {
      status: 'failed',
      mode: 'inline',
      generatedBy: null,
      model: env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL,
      fallbackUsed: false,
      errorMessage,
      config: null,
    };
  }
}

export async function scheduleSpreadsheetEnrichment({
  db,
  env,
  tenantId,
  spreadsheetId,
  requestedByUserId,
  triggeredBy,
}: ScheduleSpreadsheetEnrichmentOptions): Promise<SpreadsheetEnrichmentOutcome> {
  const lastEnqueuedAt = new Date();

  await upsertEnrichmentRecord(db, {
    tenantId,
    spreadsheetId,
    status: 'pending',
    provider: env.AI ? 'workers-ai' : 'heuristic',
    model: env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL,
    triggeredBy,
    lastEnqueuedAt,
  });

  if (env.ENRICHMENT_QUEUE) {
    try {
      await env.ENRICHMENT_QUEUE.send({
        tenantId,
        spreadsheetId,
        requestedByUserId,
        triggeredBy,
      });

      return {
        status: 'pending',
        mode: 'queue',
        generatedBy: env.AI ? 'workers-ai' : 'heuristic',
        model: env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL,
        fallbackUsed: false,
        errorMessage: null,
        config: null,
      };
    } catch {
      // Fall back to inline enrichment if the queue binding is unavailable or rejects the message.
    }
  }

  return runSpreadsheetEnrichment({
    db,
    env,
    tenantId,
    spreadsheetId,
    triggeredBy,
  });
}

export async function getSpreadsheetEnrichment(db: Database, tenantId: string, spreadsheetId: string) {
  const [record] = await db
    .select({
      status: spreadsheetEnrichments.status,
      provider: spreadsheetEnrichments.provider,
      model: spreadsheetEnrichments.model,
      config: spreadsheetEnrichments.config,
      errorMessage: spreadsheetEnrichments.errorMessage,
      lastTriggeredBy: spreadsheetEnrichments.lastTriggeredBy,
      lastEnqueuedAt: spreadsheetEnrichments.lastEnqueuedAt,
      lastProcessedAt: spreadsheetEnrichments.lastProcessedAt,
      updatedAt: spreadsheetEnrichments.updatedAt,
    })
    .from(spreadsheetEnrichments)
    .where(and(eq(spreadsheetEnrichments.tenantId, tenantId), eq(spreadsheetEnrichments.spreadsheetId, spreadsheetId)))
    .limit(1);

  return record ?? null;
}
