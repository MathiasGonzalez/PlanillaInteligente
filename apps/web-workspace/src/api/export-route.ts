import type { APIRoute } from 'astro';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { exportAppWorkbook } from '@planilla/apps/export';
import { loadSpec } from '@planilla/apps/records';
import { fail, json } from '../app/http/responses';
import { requireUser } from '../lib/access';

function buildContentDisposition(filename: string) {
  const fallback = filename.replace(/["\r\n]/g, '_') || 'app.xlsx';
  const encoded = encodeURIComponent(filename || 'app.xlsx');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export const GET: APIRoute = async ({ url, locals }) => {
  const session = requireUser(locals);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  const appId = url.searchParams.get('appId');
  if (!appId) return json({ error: 'Solicitud incompleta.' }, 400);
  const spec = await loadSpec(locals.db, session.tenantId, appId);
  if (!spec) return json({ error: 'Not found' }, 404);
  try {
    const exportResult = await exportAppWorkbook({
      db: locals.db,
      tenantId: session.tenantId,
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
