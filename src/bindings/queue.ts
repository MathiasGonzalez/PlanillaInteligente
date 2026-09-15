import type { SpreadsheetEnrichmentMessage } from '../spreadsheets/enrichment/types';

type EnrichmentQueue = {
  send(message: SpreadsheetEnrichmentMessage): Promise<void>;
};

export async function sendEnrichmentJob(
  queue: EnrichmentQueue | undefined,
  message: SpreadsheetEnrichmentMessage,
): Promise<boolean> {
  if (!queue) return false;
  try {
    await queue.send(message);
    return true;
  } catch {
    return false;
  }
}
