import type { SpreadsheetContext, SpreadsheetEnrichmentEnv } from './contracts';
import { buildAiPrompt } from './heuristics';
import { resolveAiModel, runAiInference } from '../../bindings/ai';
import {
  SPREADSHEET_SEMANTIC_TYPES,
  SPREADSHEET_VIEW_TYPES,
  type SpreadsheetColumnEnrichment,
  type SpreadsheetEnrichmentConfiguration,
  type SpreadsheetSemanticType,
  type SpreadsheetViewRecommendation,
  type SpreadsheetViewType,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

export async function runWorkersAiInference(
  env: SpreadsheetEnrichmentEnv,
  context: SpreadsheetContext,
  heuristic: SpreadsheetEnrichmentConfiguration,
) {
  if (!env.AI) {
    return null;
  }

  const model = resolveAiModel(env.WORKERS_AI_MODEL);
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

  const rawResponse = await runAiInference(env.AI, model, input, env.AI_GATEWAY_ID);
  const parsed = extractAiPayload(rawResponse);

  if (!parsed) {
    throw new Error('Workers AI did not return a parseable JSON configuration.');
  }

  return normalizeAiConfiguration(heuristic, parsed, model);
}
