import { and, asc, eq } from 'drizzle-orm';
import { rowEntries, spreadsheetColumns, spreadsheetEnrichments, spreadsheets } from '../../db/schema';
import type { Database, SpreadsheetContext, UpsertEnrichmentRecordParams } from './contracts';

function getEnrichmentRecordId(tenantId: string, spreadsheetId: string) {
  return `${tenantId}:${spreadsheetId}`;
}

export async function loadSpreadsheetContext(db: Database, tenantId: string, spreadsheetId: string): Promise<SpreadsheetContext> {
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
    sampleRows: rows.map((row) => row.data),
  };
}

export async function upsertEnrichmentRecord(db: Database, params: UpsertEnrichmentRecordParams) {
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
