export {
  SPREADSHEET_ENRICHMENT_PROVIDERS,
  SPREADSHEET_ENRICHMENT_STATUSES,
  SPREADSHEET_SEMANTIC_TYPES,
  SPREADSHEET_TRIGGER_SOURCES,
  SPREADSHEET_VIEW_TYPES,
} from '@planilla/cloudflare/d1/schema';
export type {
  SpreadsheetColumnEnrichment,
  SpreadsheetEnrichmentConfiguration,
  SpreadsheetEnrichmentProvider,
  SpreadsheetEnrichmentStatus,
  SpreadsheetSemanticType,
  SpreadsheetTriggerSource,
  SpreadsheetViewRecommendation,
  SpreadsheetViewType,
} from '@planilla/cloudflare/d1/schema';

import type { SpreadsheetTriggerSource } from '@planilla/cloudflare/d1/schema';

export interface SpreadsheetEnrichmentMessage {
  tenantId: string;
  spreadsheetId: string;
  requestedByUserId: string;
  triggeredBy: SpreadsheetTriggerSource;
}
