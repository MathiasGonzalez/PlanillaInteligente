import type { APIRoute } from 'astro';
import { exportSpreadsheetFromDatabase } from '../../lib/excel-exporter';
import type { RuntimeLocals } from '../../types/runtime';

export const GET: APIRoute = async ({ url, locals }) => {
  const runtimeLocals = locals as RuntimeLocals;

  if (!runtimeLocals.user || !runtimeLocals.tenantId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const spreadsheetId = url.searchParams.get('spreadsheetId');
  if (!spreadsheetId) {
    return new Response('Missing spreadsheetId query parameter.', { status: 400 });
  }

  try {
    const exportResult = await exportSpreadsheetFromDatabase({
      db: runtimeLocals.db,
      tenantId: runtimeLocals.tenantId,
      spreadsheetId,
      bucket: runtimeLocals.runtime.env.BUCKET,
    });
    const responseBody = exportResult.bytes.slice().buffer as ArrayBuffer;

    return new Response(responseBody, {
      status: 200,
      headers: {
        'content-type': exportResult.contentType,
        'content-disposition': `attachment; filename="${exportResult.filename}"`,
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Export failed.', { status: 500 });
  }
};
