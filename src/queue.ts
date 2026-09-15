import { drizzle } from 'drizzle-orm/d1';
import * as schema from './db/schema';
import { runSpreadsheetEnrichment } from './lib/spreadsheet-enrichment';
import type { SpreadsheetEnrichmentMessage } from './lib/spreadsheet-enrichment-types';

interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(): void;
}

interface QueueBatch<T> {
  messages: Array<QueueMessage<T>>;
}

function isSpreadsheetEnrichmentMessage(value: unknown): value is SpreadsheetEnrichmentMessage {
  return typeof value === 'object'
    && value !== null
    && 'tenantId' in value
    && 'spreadsheetId' in value
    && 'triggeredBy' in value
    && 'requestedByUserId' in value
    && typeof value.tenantId === 'string'
    && typeof value.spreadsheetId === 'string'
    && typeof value.triggeredBy === 'string'
    && typeof value.requestedByUserId === 'string';
}

export default {
  async queue(batch: QueueBatch<SpreadsheetEnrichmentMessage>, env: Cloudflare.Env) {
    const db = drizzle(env.DB, { schema });

    for (const message of batch.messages) {
      if (!isSpreadsheetEnrichmentMessage(message.body)) {
        message.ack();
        continue;
      }

      const result = await runSpreadsheetEnrichment({
        db,
        env,
        tenantId: message.body.tenantId,
        spreadsheetId: message.body.spreadsheetId,
        triggeredBy: message.body.triggeredBy,
      });

      if (result.status === 'failed') {
        message.retry();
        continue;
      }

      message.ack();
    }
  },
};
