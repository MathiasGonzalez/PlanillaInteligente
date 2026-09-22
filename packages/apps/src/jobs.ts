import { sendEnrichmentJob } from '@planilla/cloudflare/queue';
import { markAnalysisFailed, runWorkbookAnalysis } from './generation';
import { applyProposal } from './evolution';
import type { AiEnv, Database } from './db';

export interface AppJobMessage {
  kind: 'analyze' | 'apply-proposal';
  tenantId: string;
  appId: string;
  refId: string;
  requestedByUserId: string;
}

type QueueBinding<T> = { send(message: T): Promise<void> };

export function isAppJobMessage(value: unknown): value is AppJobMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (record.kind === 'analyze' || record.kind === 'apply-proposal')
    && typeof record.tenantId === 'string'
    && typeof record.appId === 'string'
    && typeof record.refId === 'string'
    && typeof record.requestedByUserId === 'string';
}

export async function scheduleAppJob(
  db: Database,
  env: AiEnv & { ENRICHMENT_QUEUE?: QueueBinding<AppJobMessage>; ANALYSIS_MODE?: string; BUCKET?: R2Bucket },
  message: AppJobMessage,
) {
  const inline = env.ANALYSIS_MODE === 'inline';
  if (!inline) {
    const queued = await sendEnrichmentJob(env.ENRICHMENT_QUEUE, message);
    if (queued) return { mode: 'queue' as const };
  }
  if (!env.BUCKET) throw new Error('Missing bucket.');
  await runAppJob(db, env, env.BUCKET, message);
  return { mode: 'inline' as const };
}

export async function runAppJob(db: Database, env: AiEnv, bucket: R2Bucket, message: AppJobMessage) {
  if (message.kind === 'analyze') {
    try {
      await runWorkbookAnalysis(db, env, bucket, message.tenantId, message.appId);
      return { status: 'completed' as const };
    } catch (error) {
      const text = error instanceof Error ? error.message : 'analysis_failed';
      await markAnalysisFailed(db, message.tenantId, message.appId, text);
      console.error(JSON.stringify({ event: 'analysis_failed', tenantId: message.tenantId, appId: message.appId }));
      return { status: 'failed' as const };
    }
  }
  const result = await applyProposal(db, {
    tenantId: message.tenantId,
    appId: message.appId,
    proposalId: message.refId,
    userId: message.requestedByUserId,
  });
  return { status: result.status === 'applied' ? 'completed' as const : 'failed' as const };
}
