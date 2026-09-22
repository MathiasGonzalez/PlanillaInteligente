import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const APP_STATUSES = ['draft', 'published'] as const;
export const ANALYSIS_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export const SPEC_SOURCES = ['heuristic', 'ai', 'wizard', 'instruction', 'restore'] as const;
export const RECORD_OPS = ['create', 'update', 'delete'] as const;
export const PROPOSAL_STATUSES = ['pending', 'processing', 'applied', 'rejected', 'failed', 'stale'] as const;
export const MEMBERSHIP_ROLES = ['owner', 'member'] as const;

export type AppStatus = (typeof APP_STATUSES)[number];
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
export type SpecSource = (typeof SPEC_SOURCES)[number];
export type RecordOp = (typeof RECORD_OPS)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
};

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  /** Commercial cancellation. Hard deletion runs 30 days later. A titular erasure does not use this column. */
  deactivatedAt: integer('deactivated_at', { mode: 'timestamp_ms' }),
  ...timestamps,
}, (table) => [
  uniqueIndex('organizations_slug_idx').on(table.slug),
  index('organizations_owner_idx').on(table.ownerUserId),
  index('organizations_deactivated_idx').on(table.deactivatedAt),
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
  tenantId: text('tenant_id').references(() => organizations.id, { onDelete: 'cascade' }),
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
  role: text('role', { enum: MEMBERSHIP_ROLES }).notNull().default('member'),
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

export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  role: text('role', { enum: MEMBERSHIP_ROLES }).notNull().default('member'),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
  acceptedByUserId: text('accepted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
}, (table) => [
  uniqueIndex('invitations_token_hash_idx').on(table.tokenHash),
  index('invitations_tenant_idx').on(table.tenantId),
  index('invitations_expires_idx').on(table.expiresAt),
]);

export const emailLoginChallenges = sqliteTable('email_login_challenges', {
  id: text('id').primaryKey(),
  emailHash: text('email_hash').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
}, (table) => [
  index('email_login_challenges_email_idx').on(table.emailHash),
  index('email_login_challenges_created_idx').on(table.createdAt),
]);

export const workbooks = sqliteTable('workbooks', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  uploadedByUserId: text('uploaded_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  originalFilename: text('original_filename').notNull(),
  r2Key: text('r2_key').notNull(),
  checksum: text('checksum'),
  sheetCount: integer('sheet_count').notNull().default(0),
  analysisStatus: text('analysis_status', { enum: ANALYSIS_STATUSES }).notNull().default('pending'),
  analysisError: text('analysis_error'),
  sampleConsentAt: integer('sample_consent_at', { mode: 'timestamp_ms' }),
  sampleConsentByUserId: text('sample_consent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
}, (table) => [
  index('workbooks_tenant_idx').on(table.tenantId),
  uniqueIndex('workbooks_r2_key_idx').on(table.r2Key),
]);

export const apps = sqliteTable('apps', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  workbookId: text('workbook_id').references(() => workbooks.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  status: text('status', { enum: APP_STATUSES }).notNull().default('draft'),
  currentVersion: integer('current_version').notNull().default(0),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps,
}, (table) => [
  index('apps_tenant_idx').on(table.tenantId),
  index('apps_workbook_idx').on(table.workbookId),
]);

export const appSpecVersions = sqliteTable('app_spec_versions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  spec: text('spec', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  source: text('source', { enum: SPEC_SOURCES }).notNull(),
  proposalId: text('proposal_id'),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
}, (table) => [
  uniqueIndex('app_spec_versions_app_version_idx').on(table.appId, table.version),
  index('app_spec_versions_tenant_idx').on(table.tenantId, table.appId),
]);

export const records = sqliteTable('records', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  entityKey: text('entity_key').notNull(),
  sourceRowIndex: integer('source_row_index'),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
}, (table) => [
  index('records_tenant_app_entity_idx').on(table.tenantId, table.appId, table.entityKey),
  index('records_app_entity_order_idx').on(table.appId, table.entityKey, table.sourceRowIndex),
]);

export const recordChanges = sqliteTable('record_changes', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  recordId: text('record_id').notNull(),
  entityKey: text('entity_key').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  op: text('op', { enum: RECORD_OPS }).notNull(),
  before: text('before', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  after: text('after', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  proposalId: text('proposal_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
}, (table) => [
  index('record_changes_record_idx').on(table.tenantId, table.appId, table.recordId),
  index('record_changes_proposal_idx').on(table.proposalId),
  index('record_changes_created_idx').on(table.createdAt),
]);

export const appChangeProposals = sqliteTable('app_change_proposals', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  baseVersion: integer('base_version').notNull(),
  instruction: text('instruction').notNull(),
  operations: text('operations', { mode: 'json' }).$type<unknown[]>().notNull(),
  preview: text('preview', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  status: text('status', { enum: PROPOSAL_STATUSES }).notNull().default('pending'),
  errorMessage: text('error_message'),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  appliedVersion: integer('applied_version'),
  ...timestamps,
}, (table) => [
  index('app_change_proposals_app_idx').on(table.tenantId, table.appId),
  index('app_change_proposals_status_idx').on(table.status, table.createdAt),
]);
