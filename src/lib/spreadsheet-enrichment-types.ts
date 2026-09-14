export const SPREADSHEET_VIEW_TYPES = ['table', 'form', 'kanban', 'dashboard'] as const;
export const SPREADSHEET_ENRICHMENT_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export const SPREADSHEET_ENRICHMENT_PROVIDERS = ['heuristic', 'workers-ai'] as const;
export const SPREADSHEET_TRIGGER_SOURCES = ['upload', 'manual'] as const;
export const SPREADSHEET_SEMANTIC_TYPES = [
  'text',
  'long-text',
  'identifier',
  'name',
  'email',
  'amount',
  'status',
  'date',
  'category',
  'assignee',
  'phone',
  'url',
  'boolean',
  'number',
  'sensitive',
  'unknown',
] as const;

export type SpreadsheetViewType = (typeof SPREADSHEET_VIEW_TYPES)[number];
export type SpreadsheetEnrichmentStatus = (typeof SPREADSHEET_ENRICHMENT_STATUSES)[number];
export type SpreadsheetEnrichmentProvider = (typeof SPREADSHEET_ENRICHMENT_PROVIDERS)[number];
export type SpreadsheetTriggerSource = (typeof SPREADSHEET_TRIGGER_SOURCES)[number];
export type SpreadsheetSemanticType = (typeof SPREADSHEET_SEMANTIC_TYPES)[number];

export interface SpreadsheetColumnEnrichment {
  key: string;
  label: string;
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'json';
  semanticType: SpreadsheetSemanticType;
  displayLabel: string;
  helpText: string;
  visible: boolean;
  editable: boolean;
  required: boolean;
  sensitive: boolean;
  filterable: boolean;
  groupable: boolean;
  order: number;
}

export interface SpreadsheetViewRecommendation {
  type: SpreadsheetViewType;
  enabled: boolean;
  title: string;
  description: string;
  defaultSortKey: string | null;
  defaultFilterKeys: string[];
  groupingColumnKey: string | null;
}

export interface SpreadsheetEnrichmentConfiguration {
  version: '1';
  title: string;
  summary: string;
  primaryView: SpreadsheetViewType;
  recommendedViews: SpreadsheetViewRecommendation[];
  kanbanColumnKey: string | null;
  columns: SpreadsheetColumnEnrichment[];
  generatedBy: SpreadsheetEnrichmentProvider;
  model: string | null;
}

export interface SpreadsheetEnrichmentMessage {
  tenantId: string;
  spreadsheetId: string;
  requestedByUserId: string;
  triggeredBy: SpreadsheetTriggerSource;
}
