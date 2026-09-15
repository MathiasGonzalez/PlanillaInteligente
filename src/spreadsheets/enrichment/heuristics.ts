import type {
  SpreadsheetColumnEnrichment,
  SpreadsheetEnrichmentConfiguration,
  SpreadsheetSemanticType,
  SpreadsheetViewRecommendation,
  SpreadsheetViewType,
} from './types';
import type { SpreadsheetContext } from './contracts';

const DEFAULT_TITLE_SUFFIX = 'Workspace';
const DEFAULT_SUMMARY = 'Configuración base generada a partir del esquema de la planilla.';
const AI_REDACTED_VALUE = '[REDACTED]';
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

function getSampleValues(sampleRows: Record<string, unknown>[], key: string, redact = false) {
  return sampleRows
    .map((row) => {
      const value = summarizeValue(row[key]);
      if (value === null) {
        return null;
      }

      return redact ? AI_REDACTED_VALUE : value;
    })
    .filter((value): value is string | number | boolean => value !== null)
    .slice(0, 5);
}

function redactSampleRowsForAi(sampleRows: Record<string, unknown>[], sensitiveKeys: Set<string>) {
  return sampleRows.slice(0, 5).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        sensitiveKeys.has(key) && value !== null && value !== undefined && value !== '' ? AI_REDACTED_VALUE : value,
      ]),
    ),
  );
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

function inferSemanticType(column: SpreadsheetContext['columns'][number], sampleRows: Record<string, unknown>[]): SpreadsheetSemanticType {
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

  return [
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
}

export function buildHeuristicConfiguration(context: SpreadsheetContext): SpreadsheetEnrichmentConfiguration {
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

export function buildAiPrompt(context: SpreadsheetContext, heuristic: SpreadsheetEnrichmentConfiguration) {
  const sensitiveKeys = new Set(
    heuristic.columns
      .filter((column) => column.sensitive || column.semanticType === 'sensitive' || SENSITIVE_PATTERN.test(column.key))
      .map((column) => column.key),
  );

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
      sampleValues: getSampleValues(context.sampleRows, column.key, sensitiveKeys.has(column.key)),
    })),
    sampleRows: redactSampleRowsForAi(context.sampleRows, sensitiveKeys),
    currentHeuristic: heuristic,
  };
}
