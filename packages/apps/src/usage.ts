import { and, eq, gte, sql } from 'drizzle-orm';
import { aiUsage, appChangeProposals, appSpecVersions, recordChanges, records, workbooks } from '@planilla/cloudflare/d1/schema';
import type { AiUsageKind } from '@planilla/cloudflare/d1/schema';
import type { Database } from './db';

export const WORKSPACE_QUOTAS = {
  aiCallsPerMonth: 100,
  storageBytes: 100 * 1024 * 1024,
  records: 50_000,
} as const;

export type QuotaResource = 'ai' | 'storage' | 'd1';

const QUOTA_MESSAGES: Record<QuotaResource, string> = {
  ai: 'Llegaste al cupo de llamadas de IA de este mes.',
  storage: 'Llegaste al cupo de archivos del workspace.',
  d1: 'Llegaste al cupo de filas del workspace.',
};

export class WorkspaceQuotaError extends Error {
  readonly resource: QuotaResource;

  constructor(resource: QuotaResource) {
    super(QUOTA_MESSAGES[resource]);
    this.name = 'WorkspaceQuotaError';
    this.resource = resource;
  }
}

export type WorkspaceUsage = {
  ai: {
    monthCalls: number;
    monthChars: number;
    totalCalls: number;
    totalChars: number;
    limit: number;
  };
  storage: {
    bytes: number;
    limit: number;
  };
  d1: {
    records: number;
    bytes: number;
    limit: number;
  };
};

function startOfUtcMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function asCount(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

export function jsonCharCount(value: unknown) {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function countAiCalls(db: Database, tenantId: string, since?: Date) {
  const conditions = since
    ? and(eq(aiUsage.tenantId, tenantId), gte(aiUsage.createdAt, since))
    : eq(aiUsage.tenantId, tenantId);
  const [row] = await db.select({
    calls: sql<number>`count(*)`,
    chars: sql<number>`coalesce(sum(${aiUsage.inputChars} + ${aiUsage.outputChars}), 0)`,
  }).from(aiUsage).where(conditions);
  return { calls: asCount(row?.calls), chars: asCount(row?.chars) };
}

async function storageBytes(db: Database, tenantId: string) {
  const [row] = await db.select({
    bytes: sql<number>`coalesce(sum(${workbooks.byteSize}), 0)`,
  }).from(workbooks).where(eq(workbooks.tenantId, tenantId));
  return asCount(row?.bytes);
}

async function recordCount(db: Database, tenantId: string) {
  const [row] = await db.select({
    total: sql<number>`count(*)`,
  }).from(records).where(eq(records.tenantId, tenantId));
  return asCount(row?.total);
}

async function d1Bytes(db: Database, tenantId: string) {
  const [recordRow] = await db.select({
    bytes: sql<number>`coalesce(sum(length(${records.data})), 0)`,
  }).from(records).where(eq(records.tenantId, tenantId));
  const [specRow] = await db.select({
    bytes: sql<number>`coalesce(sum(length(${appSpecVersions.spec})), 0)`,
  }).from(appSpecVersions).where(eq(appSpecVersions.tenantId, tenantId));
  const [changeRow] = await db.select({
    bytes: sql<number>`coalesce(sum(length(${recordChanges.before}) + length(${recordChanges.after})), 0)`,
  }).from(recordChanges).where(eq(recordChanges.tenantId, tenantId));
  const [proposalRow] = await db.select({
    bytes: sql<number>`coalesce(sum(length(${appChangeProposals.instruction}) + length(${appChangeProposals.operations}) + length(${appChangeProposals.preview})), 0)`,
  }).from(appChangeProposals).where(eq(appChangeProposals.tenantId, tenantId));
  return asCount(recordRow?.bytes) + asCount(specRow?.bytes) + asCount(changeRow?.bytes) + asCount(proposalRow?.bytes);
}

export async function getWorkspaceUsage(db: Database, tenantId: string): Promise<WorkspaceUsage> {
  const [month, total, storage, rows, occupancy] = await Promise.all([
    countAiCalls(db, tenantId, startOfUtcMonth()),
    countAiCalls(db, tenantId),
    storageBytes(db, tenantId),
    recordCount(db, tenantId),
    d1Bytes(db, tenantId),
  ]);
  return {
    ai: {
      monthCalls: month.calls,
      monthChars: month.chars,
      totalCalls: total.calls,
      totalChars: total.chars,
      limit: WORKSPACE_QUOTAS.aiCallsPerMonth,
    },
    storage: {
      bytes: storage,
      limit: WORKSPACE_QUOTAS.storageBytes,
    },
    d1: {
      records: rows,
      bytes: occupancy,
      limit: WORKSPACE_QUOTAS.records,
    },
  };
}

export async function assertStorageQuota(db: Database, tenantId: string, extraBytes: number) {
  const used = await storageBytes(db, tenantId);
  if (used + extraBytes > WORKSPACE_QUOTAS.storageBytes) throw new WorkspaceQuotaError('storage');
}

export async function assertRecordQuota(db: Database, tenantId: string, extraRecords: number) {
  const used = await recordCount(db, tenantId);
  if (used + extraRecords > WORKSPACE_QUOTAS.records) throw new WorkspaceQuotaError('d1');
}

export async function assertAiQuota(db: Database, tenantId: string) {
  const used = await countAiCalls(db, tenantId, startOfUtcMonth());
  if (used.calls >= WORKSPACE_QUOTAS.aiCallsPerMonth) throw new WorkspaceQuotaError('ai');
}

export async function recordAiUsage(
  db: Database,
  params: { tenantId: string; userId: string; kind: AiUsageKind; input: unknown; output: unknown },
) {
  await db.insert(aiUsage).values({
    id: crypto.randomUUID(),
    tenantId: params.tenantId,
    userId: params.userId,
    kind: params.kind,
    inputChars: jsonCharCount(params.input),
    outputChars: jsonCharCount(params.output),
  });
}
