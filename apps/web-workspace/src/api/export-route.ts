import type { APIRoute } from 'astro';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { exportAppWorkbook } from '@planilla/spreadsheets/export/export-app';
import { loadSpec } from '@planilla/apps/records';
import { fail } from '../app/http/responses';

function buildContentDisposition(filename: string) {
  const fallback = filename.replace(/["\r\n]/g, '_') || 'app.xlsx';
  const encoded = encodeURIComponent(filename || 'app.xlsx');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user || !locals.tenantId) return new Response('Unauthorized', { status: 401 });
  const appId = url.searchParams.get('appId');
  if (!appId) return new Response('Missing appId.', { status: 400 });
  const spec = await loadSpec(locals.db, locals.tenantId, appId);
  if (!spec) return new Response('Not found', { status: 404 });
  try {
    const exportResult = await exportAppWorkbook({
      db: locals.db,
      tenantId: locals.tenantId,
      appId,
      spec,
      bucket: cloudflareEnv.BUCKET,
    });
    return new Response(exportResult.bytes, {
      status: 200,
      headers: {
        'content-type': exportResult.contentType,
        'content-disposition': buildContentDisposition(exportResult.filename),
      },
    });
  } catch {
    return fail(500);
  }
};
