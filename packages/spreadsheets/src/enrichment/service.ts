import type { RunSpreadsheetEnrichmentOptions, ScheduleSpreadsheetEnrichmentOptions } from './contracts';
import { runWorkersAiInference } from './ai-provider';
import { buildHeuristicConfiguration } from './heuristics';
import { resolveAiModel } from '@planilla/cloudflare/ai';
import { sendEnrichmentJob } from '@planilla/cloudflare/queue';
import { getSpreadsheetEnrichment, loadSpreadsheetContext, upsertEnrichmentRecord } from './repository';

export { getSpreadsheetEnrichment };

export async function runSpreadsheetEnrichment({
  db,
  env,
  tenantId,
  spreadsheetId,
  triggeredBy,
}: RunSpreadsheetEnrichmentOptions) {
  const selectedModel = env.AI ? resolveAiModel(env.WORKERS_AI_MODEL) : null;

  await upsertEnrichmentRecord(db, {
    tenantId,
    spreadsheetId,
    status: 'processing',
    provider: env.AI ? 'workers-ai' : 'heuristic',
    model: selectedModel,
    triggeredBy,
  });

  try {
    const context = await loadSpreadsheetContext(db, tenantId, spreadsheetId);
    const heuristic = buildHeuristicConfiguration(context);
    let config = heuristic;
    let generatedBy: 'heuristic' | 'workers-ai' = 'heuristic';
    let fallbackUsed = false;
    let errorMessage: string | null = null;

    if (env.AI) {
      try {
        const aiConfig = await runWorkersAiInference(env, context, heuristic);
        if (aiConfig) {
          config = aiConfig;
          generatedBy = 'workers-ai';
        }
      } catch (error) {
        fallbackUsed = true;
        errorMessage = error instanceof Error ? error.message : 'Workers AI inference failed.';
      }
    }

    await upsertEnrichmentRecord(db, {
      tenantId,
      spreadsheetId,
      status: 'completed',
      provider: generatedBy,
      model: config.model ?? selectedModel,
      config,
      errorMessage,
      triggeredBy,
      lastProcessedAt: new Date(),
    });

    return {
      status: 'completed' as const,
      mode: 'inline' as const,
      generatedBy,
      model: config.model ?? selectedModel,
      fallbackUsed,
      errorMessage,
      config,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Spreadsheet enrichment failed.';

    await upsertEnrichmentRecord(db, {
      tenantId,
      spreadsheetId,
      status: 'failed',
      provider: env.AI ? 'workers-ai' : 'heuristic',
      model: selectedModel,
      errorMessage,
      triggeredBy,
      lastProcessedAt: new Date(),
    });

    return {
      status: 'failed' as const,
      mode: 'inline' as const,
      generatedBy: null,
      model: selectedModel,
      fallbackUsed: false,
      errorMessage,
      config: null,
    };
  }
}

export async function scheduleSpreadsheetEnrichment({
  db,
  env,
  tenantId,
  spreadsheetId,
  requestedByUserId,
  triggeredBy,
}: ScheduleSpreadsheetEnrichmentOptions) {
  const lastEnqueuedAt = new Date();
  const selectedModel = env.AI ? resolveAiModel(env.WORKERS_AI_MODEL) : null;

  await upsertEnrichmentRecord(db, {
    tenantId,
    spreadsheetId,
    status: 'pending',
    provider: env.AI ? 'workers-ai' : 'heuristic',
    model: selectedModel,
    triggeredBy,
    lastEnqueuedAt,
  });

  const queued = await sendEnrichmentJob(env.ENRICHMENT_QUEUE, { tenantId, spreadsheetId, requestedByUserId, triggeredBy });
  if (queued) {
    return {
      status: 'pending' as const,
      mode: 'queue' as const,
      generatedBy: env.AI ? 'workers-ai' : 'heuristic',
      model: selectedModel,
      fallbackUsed: false,
      errorMessage: null,
      config: null,
    };
  }

  return runSpreadsheetEnrichment({
    db,
    env,
    tenantId,
    spreadsheetId,
    triggeredBy,
  });
}
