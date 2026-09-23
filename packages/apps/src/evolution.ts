import { and, eq, inArray, sql } from 'drizzle-orm';
import { appChangeProposals, recordChanges, records } from '@planilla/cloudflare/d1/schema';
import { resolveAiModel, runAiInference, extractAiResponse } from '@planilla/cloudflare/ai';
import type { AppSpec } from './spec';
import { diffSpecs, entityOf } from './spec';
import { coerceFieldValue, insertRecordChanges, loadApp, loadSpec, saveSpecVersion, type RecordChangeInput } from './records';
import type { AiEnv, Database } from './db';
import { previewSample } from './classification';
import { applySpecOperations, dataOperationEntityKey, isDataOperation, isRecord, parseOperations, type AppOperation } from './operations';
import { evaluate } from './expressions';
import { assertAiQuota, assertRecordQuota, recordAiUsage } from './usage';

export const DATA_ROW_QUEUE_THRESHOLD = 2000;
export type { AppOperation } from './operations';
export { parseOperations, applySpecOperations } from './operations';

const D1_INSERT_CHUNK = 9;
const D1_BATCH_CHUNK = 25;

type RecordRow = typeof records.$inferSelect;

function proposalScope(params: { tenantId: string; appId: string; proposalId: string }) {
  return and(
    eq(appChangeProposals.id, params.proposalId),
    eq(appChangeProposals.tenantId, params.tenantId),
    eq(appChangeProposals.appId, params.appId),
  );
}

export async function markProposalFailed(db: Database, tenantId: string, appId: string, proposalId: string, message: string) {
  await db.update(appChangeProposals).set({
    status: 'failed',
    errorMessage: message.slice(0, 300),
    updatedAt: new Date(),
  }).where(proposalScope({ tenantId, appId, proposalId }));
}

async function claimPendingProposal(db: Database, params: { tenantId: string; appId: string; proposalId: string }) {
  const claimed = await db.update(appChangeProposals).set({
    status: 'processing',
    updatedAt: new Date(),
  }).where(and(
    proposalScope(params),
    eq(appChangeProposals.status, 'pending'),
  )).returning({ id: appChangeProposals.id });
  return claimed.length > 0;
}

async function entityRows(db: Database, tenantId: string, appId: string, entityKey: string) {
  return db.select().from(records).where(and(eq(records.tenantId, tenantId), eq(records.appId, appId), eq(records.entityKey, entityKey)));
}

async function entityRowCount(db: Database, tenantId: string, appId: string, entityKey: string) {
  const [row] = await db.select({ total: sql<number>`count(*)` }).from(records).where(and(
    eq(records.tenantId, tenantId),
    eq(records.appId, appId),
    eq(records.entityKey, entityKey),
  ));
  return Number(row?.total ?? 0);
}

async function persistRowUpdates(db: Database, tenantId: string, updates: Array<{ id: string; data: Record<string, unknown> }>) {
  for (let index = 0; index < updates.length; index += D1_BATCH_CHUNK) {
    const chunk = updates.slice(index, index + D1_BATCH_CHUNK);
    const statements = chunk.map((row) => db.update(records).set({ data: row.data, updatedAt: new Date() }).where(and(eq(records.id, row.id), eq(records.tenantId, tenantId))));
    const first = statements[0];
    if (!first) continue;
    await db.batch([first, ...statements.slice(1)]);
  }
}

async function persistRowDeletes(db: Database, tenantId: string, ids: string[]) {
  for (let index = 0; index < ids.length; index += D1_BATCH_CHUNK) {
    const chunk = ids.slice(index, index + D1_BATCH_CHUNK);
    const statements = chunk.map((id) => db.delete(records).where(and(eq(records.id, id), eq(records.tenantId, tenantId))));
    const first = statements[0];
    if (!first) continue;
    await db.batch([first, ...statements.slice(1)]);
  }
}

export async function dryRun(db: Database, tenantId: string, appId: string, spec: AppSpec, operations: AppOperation[], allowSamples: boolean) {
  const next = applySpecOperations(spec, operations);
  let affected = 0;
  const examples: Array<{ entityKey: string; before: string; after: string }> = [];
  const failures: string[] = [];
  for (const operation of operations) {
    const entityKey = dataOperationEntityKey(operation);
    if (!entityKey) continue;
    if (operation.op === 'convertFieldType') {
      const rows = await entityRows(db, tenantId, appId, entityKey);
      affected += rows.length;
      const failed = rows.filter((row) => !coerceFieldValue(operation.type, row.data[operation.fieldKey]).ok).length;
      if (failed > 0) failures.push(`${failed} filas de ${entityKey}.${operation.fieldKey} no convierten a ${operation.type}.`);
      if (allowSamples && examples.length < 3 && rows[0]) {
        const entity = entityOf(spec, entityKey);
        examples.push({ entityKey, before: entity ? previewSample(entity.fields, rows[0].data) : '{}', after: operation.op });
      }
      continue;
    }
    affected += await entityRowCount(db, tenantId, appId, entityKey);
    if (allowSamples && examples.length < 3) {
      const [row] = await db.select().from(records).where(and(eq(records.tenantId, tenantId), eq(records.appId, appId), eq(records.entityKey, entityKey))).limit(1);
      if (row) {
        const entity = entityOf(spec, entityKey);
        examples.push({ entityKey, before: entity ? previewSample(entity.fields, row.data) : '{}', after: operation.op });
      }
    }
  }
  return { diff: diffSpecs(spec, next), affected, examples, failures, spec: next };
}

async function applyData(db: Database, tenantId: string, appId: string, userId: string, proposalId: string, operations: AppOperation[]) {
  const cache = new Map<string, RecordRow[]>();
  const load = async (entityKey: string) => {
    const cached = cache.get(entityKey);
    if (cached) return cached;
    const rows = await entityRows(db, tenantId, appId, entityKey);
    cache.set(entityKey, rows);
    return rows;
  };

  for (const operation of operations) {
    const changes: RecordChangeInput[] = [];
    if (operation.op === 'convertFieldType') {
      const rows = await load(operation.entityKey);
      const nextRows: RecordRow[] = [];
      const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
      for (const row of rows) {
        const converted = coerceFieldValue(operation.type, row.data[operation.fieldKey]);
        if (!converted.ok) {
          nextRows.push(row);
          continue;
        }
        const data = { ...row.data, [operation.fieldKey]: converted.value };
        nextRows.push({ ...row, data });
        updates.push({ id: row.id, data });
        changes.push({ tenantId, appId, recordId: row.id, entityKey: operation.entityKey, userId, proposalId, op: 'update', before: row.data, after: data });
      }
      await insertRecordChanges(db, changes);
      await persistRowUpdates(db, tenantId, updates);
      cache.set(operation.entityKey, nextRows);
    } else if (operation.op === 'splitField') {
      const rows = await load(operation.entityKey);
      const nextRows = rows.map((row) => {
        const [left, right] = String(row.data[operation.fieldKey] ?? '').split(operation.separator);
        const data = { ...row.data, [operation.leftKey]: left?.trim() ?? '', [operation.rightKey]: right?.trim() ?? '' };
        changes.push({ tenantId, appId, recordId: row.id, entityKey: operation.entityKey, userId, proposalId, op: 'update', before: row.data, after: data });
        return { ...row, data };
      });
      await insertRecordChanges(db, changes);
      await persistRowUpdates(db, tenantId, nextRows.map((row) => ({ id: row.id, data: row.data })));
      cache.set(operation.entityKey, nextRows);
    } else if (operation.op === 'computeField') {
      const rows = await load(operation.entityKey);
      const nextRows = rows.map((row) => {
        let computed: unknown = null;
        try { computed = evaluate(operation.expression, row.data); } catch { computed = null; }
        const data = { ...row.data, [operation.fieldKey]: computed };
        changes.push({ tenantId, appId, recordId: row.id, entityKey: operation.entityKey, userId, proposalId, op: 'update', before: row.data, after: data });
        return { ...row, data };
      });
      await insertRecordChanges(db, changes);
      await persistRowUpdates(db, tenantId, nextRows.map((row) => ({ id: row.id, data: row.data })));
      cache.set(operation.entityKey, nextRows);
    } else if (operation.op === 'fillDefault') {
      const rows = await load(operation.entityKey);
      const nextRows: RecordRow[] = [];
      const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
      for (const row of rows) {
        if (row.data[operation.fieldKey] !== null && row.data[operation.fieldKey] !== undefined && row.data[operation.fieldKey] !== '') {
          nextRows.push(row);
          continue;
        }
        const data = { ...row.data, [operation.fieldKey]: operation.value };
        nextRows.push({ ...row, data });
        updates.push({ id: row.id, data });
        changes.push({ tenantId, appId, recordId: row.id, entityKey: operation.entityKey, userId, proposalId, op: 'update', before: row.data, after: data });
      }
      await insertRecordChanges(db, changes);
      await persistRowUpdates(db, tenantId, updates);
      cache.set(operation.entityKey, nextRows);
    } else if (operation.op === 'extractEntity') {
      const rows = await load(operation.sourceEntity);
      const created: Array<{
        id: string;
        tenantId: string;
        appId: string;
        entityKey: string;
        sourceRowIndex: null;
        data: Record<string, unknown>;
        createdByUserId: string;
        updatedByUserId: string;
      }> = [];
      const nextSource: RecordRow[] = [];
      const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
      for (const row of rows) {
        const data: Record<string, unknown> = { [operation.relationFieldKey]: row.id };
        const remaining = { ...row.data };
        for (const key of operation.fieldKeys) {
          data[key] = row.data[key] ?? null;
          delete remaining[key];
        }
        const id = crypto.randomUUID();
        created.push({
          id,
          tenantId,
          appId,
          entityKey: operation.entity.key,
          sourceRowIndex: null,
          data,
          createdByUserId: userId,
          updatedByUserId: userId,
        });
        changes.push({ tenantId, appId, recordId: id, entityKey: operation.entity.key, userId, proposalId, op: 'create', before: null, after: data });
        changes.push({ tenantId, appId, recordId: row.id, entityKey: operation.sourceEntity, userId, proposalId, op: 'update', before: row.data, after: remaining });
        nextSource.push({ ...row, data: remaining });
        updates.push({ id: row.id, data: remaining });
      }
      await assertRecordQuota(db, tenantId, created.length);
      for (let index = 0; index < created.length; index += D1_INSERT_CHUNK) {
        const chunk = created.slice(index, index + D1_INSERT_CHUNK);
        if (chunk.length > 0) await db.insert(records).values(chunk);
      }
      await insertRecordChanges(db, changes);
      await persistRowUpdates(db, tenantId, updates);
      cache.set(operation.sourceEntity, nextSource);
    }
  }
}

export async function createProposal(db: Database, env: AiEnv, params: { tenantId: string; appId: string; userId: string; instruction: string; allowSamples: boolean }) {
  const spec = await loadSpec(db, params.tenantId, params.appId);
  const app = await loadApp(db, params.tenantId, params.appId);
  if (!spec || !app) throw new Error('App not found.');
  let operations: AppOperation[] | null = null;
  let explanation: string | null = null;
  if (!env.AI) {
    explanation = 'La IA no está disponible en este entorno.';
  } else {
    await assertAiQuota(db, params.tenantId);
    const input = {
      messages: [
        {
          role: 'system',
          content: 'Devolvé JSON {"supported":true,"operations":[...]} o {"supported":false,"explanation":"..."}. Operaciones: addField, renameField, updateField, archiveField, addView, updateView, removeView, addWidget, removeWidget, renameEntity, addEntity, addRelation, removeRelation, convertFieldType, splitField, computeField, fillDefault, extractEntity. No inventes keys que no estén en la spec salvo campos nuevos. computeField solo usa + - * concat() days() y keys de campos. No escribas código.',
        },
        { role: 'user', content: JSON.stringify({ instruction: params.instruction.slice(0, 1000), spec }) },
      ],
      response_format: { type: 'json_object' },
    };
    const response = await runAiInference(env.AI, resolveAiModel(env.WORKERS_AI_MODEL), input, env.AI_GATEWAY_ID);
    await recordAiUsage(db, {
      tenantId: params.tenantId,
      userId: params.userId,
      kind: 'evolve',
      input,
      output: response,
    });
    const payload = extractAiResponse(response);
    if (isRecord(payload) && payload.supported === false) {
      explanation = typeof payload.explanation === 'string' ? payload.explanation.slice(0, 500) : 'No se puede hacer con las operaciones disponibles.';
    } else if (isRecord(payload)) {
      operations = parseOperations(payload.operations);
      if (!operations) explanation = 'La respuesta no respetó el catálogo de operaciones.';
    } else {
      explanation = 'La IA no devolvió JSON.';
    }
  }
  const id = crypto.randomUUID();
  if (!operations) {
    await db.insert(appChangeProposals).values({
      id,
      tenantId: params.tenantId,
      appId: params.appId,
      baseVersion: app.currentVersion,
      instruction: params.instruction.slice(0, 1000),
      operations: [],
      preview: { explanation },
      status: 'rejected',
      errorMessage: explanation,
      createdByUserId: params.userId,
    });
    return { id, status: 'rejected' as const, explanation, preview: null };
  }
  try {
    const preview = await dryRun(db, params.tenantId, params.appId, spec, operations, params.allowSamples);
    await db.insert(appChangeProposals).values({
      id,
      tenantId: params.tenantId,
      appId: params.appId,
      baseVersion: app.currentVersion,
      instruction: params.instruction.slice(0, 1000),
      operations: operations as unknown as unknown[],
      preview: { diff: preview.diff, affected: preview.affected, examples: preview.examples, failures: preview.failures },
      status: 'pending',
      createdByUserId: params.userId,
    });
    return { id, status: 'pending' as const, explanation: null, preview };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo previsualizar.';
    await db.insert(appChangeProposals).values({
      id,
      tenantId: params.tenantId,
      appId: params.appId,
      baseVersion: app.currentVersion,
      instruction: params.instruction.slice(0, 1000),
      operations: operations as unknown as unknown[],
      preview: null,
      status: 'rejected',
      errorMessage: message,
      createdByUserId: params.userId,
    });
    return { id, status: 'rejected' as const, explanation: message, preview: null };
  }
}

export async function applyProposal(db: Database, params: { tenantId: string; appId: string; proposalId: string; userId: string }) {
  const scope = proposalScope(params);
  const [proposal] = await db.select().from(appChangeProposals).where(scope).limit(1);
  if (!proposal) return { status: 'failed' as const, queued: false };
  if (proposal.status === 'applied' || proposal.status === 'rejected' || proposal.status === 'stale' || proposal.status === 'failed') {
    return { status: proposal.status, queued: false };
  }
  const app = await loadApp(db, params.tenantId, params.appId);
  const spec = await loadSpec(db, params.tenantId, params.appId);
  if (!app || !spec) return { status: 'failed' as const, queued: false };
  if (app.currentVersion !== proposal.baseVersion) {
    await db.update(appChangeProposals).set({ status: 'stale', updatedAt: new Date() }).where(scope);
    return { status: 'stale' as const, queued: false };
  }
  const operations = parseOperations(proposal.operations);
  if (!operations) {
    await markProposalFailed(db, params.tenantId, params.appId, proposal.id, 'La propuesta no se puede aplicar.');
    return { status: 'failed' as const, queued: false };
  }
  const dataOps = operations.filter(isDataOperation);
  let affected = 0;
  for (const operation of dataOps) {
    const entityKey = dataOperationEntityKey(operation);
    if (!entityKey) continue;
    affected += await entityRowCount(db, params.tenantId, params.appId, entityKey);
  }
  if (affected > DATA_ROW_QUEUE_THRESHOLD && proposal.status !== 'processing') {
    const claimed = await claimPendingProposal(db, params);
    if (!claimed) return { status: 'processing' as const, queued: false };
    return { status: 'processing' as const, queued: true };
  }
  if (proposal.status === 'pending') {
    const claimed = await claimPendingProposal(db, params);
    if (!claimed) {
      const [current] = await db.select({ status: appChangeProposals.status }).from(appChangeProposals).where(scope).limit(1);
      return { status: (current?.status ?? 'failed') as 'applied' | 'failed' | 'processing' | 'rejected' | 'stale', queued: false };
    }
  }
  try {
    await applyData(db, params.tenantId, params.appId, params.userId, proposal.id, operations);
    const next = applySpecOperations(spec, operations);
    const version = await saveSpecVersion(db, {
      tenantId: params.tenantId,
      appId: params.appId,
      spec: next,
      source: 'instruction',
      userId: params.userId,
      proposalId: proposal.id,
    });
    await db.update(appChangeProposals).set({ status: 'applied', appliedVersion: version, updatedAt: new Date() }).where(scope);
    return { status: 'applied' as const, queued: false, version };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo aplicar.';
    await markProposalFailed(db, params.tenantId, params.appId, proposal.id, message);
    return { status: 'failed' as const, queued: false };
  }
}

export async function revertProposal(db: Database, params: { tenantId: string; appId: string; proposalId: string }) {
  const rows = await db.select().from(recordChanges).where(and(
    eq(recordChanges.tenantId, params.tenantId),
    eq(recordChanges.appId, params.appId),
    eq(recordChanges.proposalId, params.proposalId),
  ));
  if (rows.length === 0) return false;
  const ids = [...new Set(rows.map((change) => change.recordId))];
  const currentRows = await db.select().from(records).where(and(eq(records.tenantId, params.tenantId), inArray(records.id, ids)));
  const byId = new Map(currentRows.map((row) => [row.id, row]));
  for (const change of rows) {
    const current = byId.get(change.recordId);
    if (current && current.updatedAt.getTime() > change.createdAt.getTime() + 1000) return false;
  }
  await persistRowDeletes(db, params.tenantId, rows.filter((change) => change.op === 'create').map((change) => change.recordId));
  await persistRowUpdates(
    db,
    params.tenantId,
    rows.filter((change) => change.op !== 'create' && change.before).map((change) => ({ id: change.recordId, data: change.before as Record<string, unknown> })),
  );
  return true;
}
