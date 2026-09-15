import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from '../../db/schema';
import type {
  SpreadsheetColumnEnrichment,
  SpreadsheetEnrichmentConfiguration,
  SpreadsheetEnrichmentMessage,
  SpreadsheetEnrichmentProvider,
  SpreadsheetEnrichmentStatus,
  SpreadsheetTriggerSource,
} from './types';

export type Database = DrizzleD1Database<typeof schema>;

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

export interface ColumnContext {
  key: string;
  label: string;
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'json';
  columnIndex: number;
  required: boolean;
}

export interface SpreadsheetContext {
  spreadsheetId: string;
  name: string;
  sheetName: string | null;
  columns: ColumnContext[];
  sampleRows: Record<string, unknown>[];
}

export interface ScheduleSpreadsheetEnrichmentOptions {
  db: Database;
  env: SpreadsheetEnrichmentEnv;
  tenantId: string;
  spreadsheetId: string;
  requestedByUserId: string;
  triggeredBy: SpreadsheetTriggerSource;
}

export interface RunSpreadsheetEnrichmentOptions {
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

export interface UpsertEnrichmentRecordParams {
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
}

export type HeuristicColumns = SpreadsheetColumnEnrichment[];
