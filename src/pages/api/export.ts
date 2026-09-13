import type { APIRoute } from 'astro';
import { exportSpreadsheetFromDatabase } from '../../lib/excel-exporter';

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user || !locals.tenantId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const spreadsheetId = url.searchParams.get('spreadsheetId');
  if (!spreadsheetId) {
    return new Response('Missing spreadsheetId query parameter.', { status: 400 });
  }

  try {
    const exportResult = await exportSpreadsheetFromDatabase({
      db: locals.db,
      tenantId: locals.tenantId,
      spreadsheetId,
      bucket: locals.runtime.env.BUCKET,
    });

    return new Response(exportResult.bytes as unknown as BodyInit, {
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
