import type { APIRoute } from 'astro';
import { json } from '../../../lib/api-response';
import { getSpreadsheetEnrichment, runSpreadsheetEnrichment, scheduleSpreadsheetEnrichment } from '../../../lib/spreadsheet-enrichment';

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user || !locals.tenantId) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const spreadsheetId = url.searchParams.get('spreadsheetId');
  if (!spreadsheetId) {
    return json({ error: 'Missing spreadsheetId query parameter.' }, 400);
  }

  const enrichment = await getSpreadsheetEnrichment(locals.db, locals.tenantId, spreadsheetId);
  if (!enrichment) {
    return json({ error: 'Enrichment not found for this spreadsheet.' }, 404);
  }

  return json(enrichment);
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user || !locals.tenantId) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const payload = (await request.json().catch(() => null)) as { spreadsheetId?: string; mode?: 'queue' | 'inline' } | null;
  const spreadsheetId = payload?.spreadsheetId?.trim();

  if (!spreadsheetId) {
    return json({ error: 'A spreadsheetId is required.' }, 400);
  }

  const mode = payload?.mode === 'queue' ? 'queue' : 'inline';
  const env = locals.runtime.env;

  const result =
    mode === 'queue'
      ? await scheduleSpreadsheetEnrichment({
          db: locals.db,
          env,
          tenantId: locals.tenantId,
          spreadsheetId,
          requestedByUserId: locals.user.id,
          triggeredBy: 'manual',
        })
      : await runSpreadsheetEnrichment({
          db: locals.db,
          env,
          tenantId: locals.tenantId,
          spreadsheetId,
          triggeredBy: 'manual',
        });

  return json(result, result.status === 'failed' ? 500 : 200);
};
