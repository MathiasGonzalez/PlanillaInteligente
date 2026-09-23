import { and, asc, eq } from 'drizzle-orm';
import { apps, records, workbooks } from '@planilla/cloudflare/d1/schema';
import { resolveAiModel, runAiInference, extractAiResponse } from '@planilla/cloudflare/ai';
import { getObject } from '@planilla/cloudflare/r2';
import { parseWorkbook, type ParsedColumn, type ParsedSheet, type ParsedWorkbook, type RelationCandidate } from '@planilla/spreadsheets/parsing/parse-workbook';
import type { AppSpec, EntitySpec, FieldSpec, ViewSpec } from './spec';
import { parseAppSpec } from './spec';
import type { AiEnv, Database } from './db';
import { isSensitiveName, isSpecialName, isRestrictedName } from './classification';
import { saveSpecVersion } from './records';
import { assertAiQuota, recordAiUsage, WorkspaceQuotaError } from './usage';

function fieldFromColumn(column: ParsedColumn): FieldSpec {
  const sensitive = isSensitiveName(column.key, column.label);
  const specialCategory = isSpecialName(column.key, column.label);
  return {
    key: column.key,
    label: column.label,
    type: column.type,
    required: false,
    visible: !sensitive && !specialCategory,
    editable: column.type !== 'computed' && column.type !== 'identifier' && !sensitive && !specialCategory,
    sensitive,
    specialCategory,
    options: column.options,
    currency: column.currency,
    relation: null,
    formula: column.formula,
  };
}

export function buildHeuristicSpec(parsed: ParsedWorkbook, filename: string): AppSpec {
  const entities: EntitySpec[] = parsed.sheets.map((sheet) => {
    const fields = sheet.columns.map(fieldFromColumn);
    const primary = fields.find((field) => field.type === 'identifier') ?? fields.find((field) => field.type === 'text') ?? fields[0];
    const status = fields.find((field) => field.type === 'status') ?? null;
    return {
      key: sheet.entityKey,
      name: sheet.name,
      sourceSheet: sheet.name,
      primaryFieldKey: primary?.key ?? null,
      statusFieldKey: status?.key ?? null,
      fields,
    };
  });
  const relations = parsed.candidates.slice(0, 8).map((candidate) => ({
    fromEntity: candidate.fromEntity,
    fieldKey: candidate.fromField,
    toEntity: candidate.toEntity,
    cardinality: 'many-to-one' as const,
    origin: 'detected' as const,
  }));
  for (const relation of relations) {
    const entity = entities.find((item) => item.key === relation.fromEntity);
    const field = entity?.fields.find((item) => item.key === relation.fieldKey);
    if (field) {
      field.type = 'relation';
      field.relation = { toEntity: relation.toEntity };
      field.editable = true;
    }
  }
  const views = entities.flatMap((entity) => {
    const visible = entity.fields.filter((field) => field.visible).map((field) => field.key);
    const base = {
      entityKey: entity.key,
      filters: [],
      sort: entity.primaryFieldKey ? { fieldKey: entity.primaryFieldKey, direction: 'asc' as const } : null,
      groupBy: entity.statusFieldKey,
      visibleFields: visible,
    };
    const list: ViewSpec[] = [
      { ...base, key: `${entity.key}_table`, type: 'table' as const, title: entity.name },
      { ...base, key: `${entity.key}_form`, type: 'form' as const, title: `Cargar ${entity.name}` },
      { ...base, key: `${entity.key}_detail`, type: 'detail' as const, title: entity.name },
    ];
    if (entity.statusFieldKey) {
      list.push({ ...base, key: `${entity.key}_kanban`, type: 'kanban' as const, title: entity.name });
    }
    return list;
  });
  const amountEntity = entities.find((entity) => entity.fields.some((field) => field.type === 'amount'));
  const dashboards = amountEntity
    ? [{
        key: 'resumen',
        title: 'Resumen',
        widgets: [
          {
            key: 'total',
            type: 'kpi' as const,
            title: `Registros de ${amountEntity.name}`,
            entityKey: amountEntity.key,
            metric: { op: 'count' as const, fieldKey: null },
            groupBy: null,
            dateBucket: null,
          },
          {
            key: 'suma',
            type: 'kpi' as const,
            title: 'Suma',
            entityKey: amountEntity.key,
            metric: { op: 'sum' as const, fieldKey: amountEntity.fields.find((field) => field.type === 'amount')?.key ?? null },
            groupBy: null,
            dateBucket: null,
          },
          ...(amountEntity.statusFieldKey
            ? [{
                key: 'por_estado',
                type: 'bar' as const,
                title: 'Por estado',
                entityKey: amountEntity.key,
                metric: { op: 'count' as const, fieldKey: null },
                groupBy: amountEntity.statusFieldKey,
                dateBucket: null,
              }]
            : []),
        ],
      }]
    : [];
  const title = filename.replace(/\.xlsx$/i, '');
  return {
    version: '2',
    title,
    summary: parsed.sheets.map((sheet) => sheet.name).join(', '),
    entities,
    relations,
    views,
    dashboards,
  };
}

function columnProfile(sheet: ParsedSheet) {
  return sheet.columns.map((column) => ({
    key: column.key,
    label: column.label,
    type: column.type,
    nonEmpty: column.nonEmpty,
    distinctCount: column.distinctCount,
    sensitive: isRestrictedName(column.key, column.label),
  }));
}

function normalizeAiSpec(base: AppSpec, candidate: unknown, allowed: RelationCandidate[]): AppSpec {
  if (typeof candidate !== 'object' || candidate === null) return base;
  const raw = candidate as Record<string, unknown>;
  const next: AppSpec = structuredClone(base);
  if (typeof raw.title === 'string' && raw.title.trim()) next.title = raw.title.trim().slice(0, 160);
  if (typeof raw.summary === 'string') next.summary = raw.summary.slice(0, 500);
  if (Array.isArray(raw.entities)) {
    for (const item of raw.entities) {
      if (typeof item !== 'object' || item === null) continue;
      const suggested = item as Record<string, unknown>;
      const entity = next.entities.find((entry) => entry.key === suggested.key);
      if (!entity || typeof suggested.key !== 'string') continue;
      if (typeof suggested.name === 'string' && suggested.name.trim()) entity.name = suggested.name.trim().slice(0, 120);
      if (typeof suggested.primaryFieldKey === 'string' && entity.fields.some((field) => field.key === suggested.primaryFieldKey)) {
        entity.primaryFieldKey = suggested.primaryFieldKey;
      }
      if (suggested.statusFieldKey === null) entity.statusFieldKey = null;
      if (typeof suggested.statusFieldKey === 'string' && entity.fields.some((field) => field.key === suggested.statusFieldKey)) {
        entity.statusFieldKey = suggested.statusFieldKey;
      }
      if (!Array.isArray(suggested.hiddenFields)) continue;
      for (const key of suggested.hiddenFields) {
        const field = entity.fields.find((entry) => entry.key === key);
        if (field && !field.sensitive && !field.specialCategory) field.visible = false;
      }
    }
  }
  if (Array.isArray(raw.relations)) {
    const accepted = [];
    for (const item of raw.relations) {
      if (typeof item !== 'object' || item === null) continue;
      const suggested = item as Record<string, unknown>;
      const match = allowed.find((candidate) =>
        candidate.fromEntity === suggested.fromEntity
        && candidate.fromField === suggested.fieldKey
        && candidate.toEntity === suggested.toEntity);
      if (!match) continue;
      accepted.push({
        fromEntity: match.fromEntity,
        fieldKey: match.fromField,
        toEntity: match.toEntity,
        cardinality: 'many-to-one' as const,
        origin: 'detected' as const,
      });
    }
    if (accepted.length > 0) {
      next.relations = accepted;
      for (const entity of next.entities) {
        for (const field of entity.fields) {
          if (field.type === 'relation') {
            field.type = 'text';
            field.relation = null;
          }
        }
      }
      for (const relation of accepted) {
        const field = next.entities.find((entity) => entity.key === relation.fromEntity)?.fields.find((item) => item.key === relation.fieldKey);
        if (field) {
          field.type = 'relation';
          field.relation = { toEntity: relation.toEntity };
        }
      }
    }
  }
  return parseAppSpec(next) ?? base;
}

export async function runWorkbookAnalysis(
  db: Database,
  env: AiEnv,
  bucket: R2Bucket,
  tenantId: string,
  appId: string,
  userId?: string,
) {
  const [app] = await db.select().from(apps).where(and(eq(apps.id, appId), eq(apps.tenantId, tenantId))).limit(1);
  if (!app?.workbookId) throw new Error('App not found.');
  const [workbook] = await db.select().from(workbooks).where(and(eq(workbooks.id, app.workbookId), eq(workbooks.tenantId, tenantId))).limit(1);
  if (!workbook) throw new Error('Workbook not found.');
  await db.update(workbooks).set({ analysisStatus: 'processing', updatedAt: new Date() }).where(and(eq(workbooks.id, workbook.id), eq(workbooks.tenantId, tenantId)));
  const file = await getObject(bucket, workbook.r2Key);
  if (!file) throw new Error('Workbook file missing.');
  const parsed = await parseWorkbook(await file.arrayBuffer());
  const heuristic = buildHeuristicSpec(parsed, workbook.originalFilename);
  let spec = heuristic;
  let source: 'heuristic' | 'ai' = 'heuristic';
  if (env.AI) {
    const sampleRows = workbook.sampleConsentAt
      ? await db.select({ entityKey: records.entityKey, data: records.data }).from(records).where(and(eq(records.tenantId, tenantId), eq(records.appId, appId))).orderBy(asc(records.sourceRowIndex)).limit(25)
      : [];
    const prompt = {
      filename: workbook.originalFilename,
      sheets: parsed.sheets.map((sheet) => ({
        entityKey: sheet.entityKey,
        name: sheet.name,
        columns: columnProfile(sheet),
        samples: workbook.sampleConsentAt
          ? sampleRows.filter((row) => row.entityKey === sheet.entityKey).slice(0, 5).map((row) => {
              const safe: Record<string, unknown> = {};
              for (const column of sheet.columns) {
                if (isRestrictedName(column.key, column.label)) continue;
                safe[column.key] = row.data[column.key] ?? null;
              }
              return safe;
            })
          : undefined,
      })),
      relationCandidates: parsed.candidates.map((candidate) => ({
        fromEntity: candidate.fromEntity,
        fieldKey: candidate.fromField,
        toEntity: candidate.toEntity,
        overlapRatio: candidate.overlapRatio,
        targetUniqueness: candidate.targetUniqueness,
        nameSimilarity: candidate.nameSimilarity,
      })),
    };
    try {
      await assertAiQuota(db, tenantId);
      const model = resolveAiModel(env.WORKERS_AI_MODEL);
      const input = {
        messages: [
          {
            role: 'system',
            content: 'Devolvé solo JSON con title, summary, entities[{key,name,primaryFieldKey,statusFieldKey,hiddenFields}], relations[{fromEntity,fieldKey,toEntity}] y nada más. No inventes entity keys ni columnas. relations solo puede usar relationCandidates. Si no hay opt-in, no hay valores reales.',
          },
          { role: 'user', content: JSON.stringify(prompt) },
        ],
        response_format: { type: 'json_object' },
      };
      const response = await runAiInference(env.AI, model, input, env.AI_GATEWAY_ID);
      await recordAiUsage(db, {
        tenantId,
        userId: userId ?? workbook.uploadedByUserId,
        kind: 'analyze',
        input,
        output: response,
      });
      const payload = extractAiResponse(response);
      if (payload) {
        spec = normalizeAiSpec(heuristic, payload, parsed.candidates);
        source = 'ai';
      }
    } catch (error) {
      if (!(error instanceof WorkspaceQuotaError)) {
        console.error(JSON.stringify({
          event: 'analysis_ai_fallback',
          tenantId,
          appId,
          message: error instanceof Error ? error.message : 'ai_failed',
        }));
      }
    }
  }
  const stored = parseAppSpec(spec);
  if (!stored) throw new Error('Spec inválida.');
  await saveSpecVersion(db, {
    tenantId,
    appId,
    spec: stored,
    source,
    userId: workbook.uploadedByUserId,
  });
  await db.update(workbooks).set({ analysisStatus: 'completed', analysisError: null, sheetCount: parsed.sheets.length, updatedAt: new Date() }).where(and(eq(workbooks.id, workbook.id), eq(workbooks.tenantId, tenantId)));
  return spec;
}

export async function markAnalysisFailed(db: Database, tenantId: string, appId: string, message: string) {
  const [app] = await db.select({ workbookId: apps.workbookId }).from(apps).where(and(eq(apps.id, appId), eq(apps.tenantId, tenantId))).limit(1);
  if (!app?.workbookId) return;
  await db.update(workbooks).set({
    analysisStatus: 'failed',
    analysisError: message.slice(0, 300),
    updatedAt: new Date(),
  }).where(and(eq(workbooks.id, app.workbookId), eq(workbooks.tenantId, tenantId)));
}
