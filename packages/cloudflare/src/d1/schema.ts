import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
};

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex('organizations_slug_idx').on(table.slug),
  index('organizations_owner_idx').on(table.ownerUserId),
]);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name'),
  image: text('image'),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }),
  defaultOrganizationId: text('default_organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  ...timestamps,
}, (table) => [
  uniqueIndex('users_email_idx').on(table.email),
  index('users_default_org_idx').on(table.defaultOrganizationId),
]);

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  scope: text('scope'),
  tokenType: text('token_type'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  ...timestamps,
}, (table) => [
  uniqueIndex('accounts_provider_account_idx').on(table.provider, table.providerAccountId),
  index('accounts_user_idx').on(table.userId),
  index('accounts_tenant_idx').on(table.tenantId),
]);

export const memberships = sqliteTable('memberships', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull().default('member'),
  ...timestamps,
}, (table) => [
  uniqueIndex('memberships_org_user_idx').on(table.organizationId, table.userId),
  index('memberships_org_idx').on(table.organizationId),
  index('memberships_user_idx').on(table.userId),
]);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  activeOrganizationId: text('active_organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sessionToken: text('session_token').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex('sessions_token_idx').on(table.sessionToken),
  index('sessions_user_idx').on(table.userId),
  index('sessions_tenant_idx').on(table.activeOrganizationId),
]);

export const spreadsheets = sqliteTable('spreadsheets', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  uploadedByUserId: text('uploaded_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  originalFilename: text('original_filename').notNull(),
  r2Key: text('r2_key').notNull(),
  sourceType: text('source_type', { enum: ['excel', 'google-sheets', 'csv'] }).notNull().default('excel'),
  sheetName: text('sheet_name'),
  checksum: text('checksum'),
  ...timestamps,
}, (table) => [
  index('spreadsheets_tenant_idx').on(table.tenantId),
  uniqueIndex('spreadsheets_r2_key_idx').on(table.r2Key),
]);

export const spreadsheetColumns = sqliteTable('spreadsheet_columns', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  spreadsheetId: text('spreadsheet_id').notNull().references(() => spreadsheets.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  label: text('label').notNull(),
  dataType: text('data_type', { enum: ['string', 'number', 'boolean', 'date', 'json'] }).notNull().default('string'),
  columnIndex: integer('column_index').notNull(),
  required: integer('required', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
}, (table) => [
  uniqueIndex('spreadsheet_columns_key_idx').on(table.spreadsheetId, table.key),
  index('spreadsheet_columns_tenant_sheet_idx').on(table.tenantId, table.spreadsheetId),
  index('spreadsheet_columns_order_idx').on(table.spreadsheetId, table.columnIndex),
]);

export const rowEntries = sqliteTable('row_entries', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  spreadsheetId: text('spreadsheet_id').notNull().references(() => spreadsheets.id, { onDelete: 'cascade' }),
  rowIndex: integer('row_index').notNull(),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  ...timestamps,
}, (table) => [
  index('row_entries_tenant_sheet_idx').on(table.tenantId, table.spreadsheetId),
  uniqueIndex('row_entries_sheet_row_idx').on(table.spreadsheetId, table.rowIndex),
]);

export const spreadsheetEnrichments = sqliteTable('spreadsheet_enrichments', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  spreadsheetId: text('spreadsheet_id').notNull().references(() => spreadsheets.id, { onDelete: 'cascade' }),
  status: text('status', { enum: SPREADSHEET_ENRICHMENT_STATUSES }).notNull().default('pending'),
  provider: text('provider', { enum: SPREADSHEET_ENRICHMENT_PROVIDERS }).notNull().default('heuristic'),
  model: text('model'),
  config: text('config', { mode: 'json' }).$type<SpreadsheetEnrichmentConfiguration | null>(),
  errorMessage: text('error_message'),
  lastTriggeredBy: text('last_triggered_by', { enum: SPREADSHEET_TRIGGER_SOURCES }).notNull().default('upload'),
  lastEnqueuedAt: integer('last_enqueued_at', { mode: 'timestamp_ms' }),
  lastProcessedAt: integer('last_processed_at', { mode: 'timestamp_ms' }),
  ...timestamps,
}, (table) => [
  uniqueIndex('spreadsheet_enrichments_tenant_sheet_idx').on(table.tenantId, table.spreadsheetId),
  index('spreadsheet_enrichments_status_idx').on(table.status),
]);
