import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  SpreadsheetEnrichmentConfiguration,
  SpreadsheetEnrichmentProvider,
  SpreadsheetEnrichmentStatus,
  SpreadsheetTriggerSource,
} from '@planilla/spreadsheets/enrichment/types';

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
}, (table) => ({
  slugIndex: uniqueIndex('organizations_slug_idx').on(table.slug),
  ownerIndex: index('organizations_owner_idx').on(table.ownerUserId),
}));

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name'),
  image: text('image'),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }),
  defaultOrganizationId: text('default_organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  ...timestamps,
}, (table) => ({
  emailIndex: uniqueIndex('users_email_idx').on(table.email),
  defaultOrganizationIndex: index('users_default_org_idx').on(table.defaultOrganizationId),
}));

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
}, (table) => ({
  providerIndex: uniqueIndex('accounts_provider_account_idx').on(table.provider, table.providerAccountId),
  userIndex: index('accounts_user_idx').on(table.userId),
  tenantIndex: index('accounts_tenant_idx').on(table.tenantId),
}));

export const memberships = sqliteTable('memberships', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull().default('member'),
  ...timestamps,
}, (table) => ({
  uniqueMembership: uniqueIndex('memberships_org_user_idx').on(table.organizationId, table.userId),
  orgIndex: index('memberships_org_idx').on(table.organizationId),
  userIndex: index('memberships_user_idx').on(table.userId),
}));

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  activeOrganizationId: text('active_organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sessionToken: text('session_token').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ...timestamps,
}, (table) => ({
  tokenIndex: uniqueIndex('sessions_token_idx').on(table.sessionToken),
  userIndex: index('sessions_user_idx').on(table.userId),
  tenantIndex: index('sessions_tenant_idx').on(table.activeOrganizationId),
}));

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
}, (table) => ({
  tenantIndex: index('spreadsheets_tenant_idx').on(table.tenantId),
  keyIndex: uniqueIndex('spreadsheets_r2_key_idx').on(table.r2Key),
}));

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
}, (table) => ({
  spreadsheetKeyIndex: uniqueIndex('spreadsheet_columns_key_idx').on(table.spreadsheetId, table.key),
  tenantSpreadsheetIndex: index('spreadsheet_columns_tenant_sheet_idx').on(table.tenantId, table.spreadsheetId),
  orderIndex: index('spreadsheet_columns_order_idx').on(table.spreadsheetId, table.columnIndex),
}));

export const rowEntries = sqliteTable('row_entries', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  spreadsheetId: text('spreadsheet_id').notNull().references(() => spreadsheets.id, { onDelete: 'cascade' }),
  rowIndex: integer('row_index').notNull(),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  ...timestamps,
}, (table) => ({
  tenantSpreadsheetIndex: index('row_entries_tenant_sheet_idx').on(table.tenantId, table.spreadsheetId),
  rowOrderIndex: uniqueIndex('row_entries_sheet_row_idx').on(table.spreadsheetId, table.rowIndex),
}));

export const spreadsheetEnrichments = sqliteTable('spreadsheet_enrichments', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  spreadsheetId: text('spreadsheet_id').notNull().references(() => spreadsheets.id, { onDelete: 'cascade' }),
  status: text('status').$type<SpreadsheetEnrichmentStatus>().notNull().default('pending'),
  provider: text('provider').$type<SpreadsheetEnrichmentProvider>().notNull().default('heuristic'),
  model: text('model'),
  config: text('config', { mode: 'json' }).$type<SpreadsheetEnrichmentConfiguration | null>(),
  errorMessage: text('error_message'),
  lastTriggeredBy: text('last_triggered_by').$type<SpreadsheetTriggerSource>().notNull().default('upload'),
  lastEnqueuedAt: integer('last_enqueued_at', { mode: 'timestamp_ms' }),
  lastProcessedAt: integer('last_processed_at', { mode: 'timestamp_ms' }),
  ...timestamps,
}, (table) => ({
  uniqueSpreadsheetIndex: uniqueIndex('spreadsheet_enrichments_tenant_sheet_idx').on(table.tenantId, table.spreadsheetId),
  statusIndex: index('spreadsheet_enrichments_status_idx').on(table.status),
}));
