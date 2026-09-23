import type { APIRoute } from 'astro';
import { missingParams, ownerSession } from '../../../../lib/access';
import { fail, json } from '../../../../app/http/responses';
import { loadSpec, saveSpecVersion } from '@planilla/apps/records';
import { parseAppSpec } from '@planilla/apps/spec';

export const GET: APIRoute = async ({ locals, params }) => {
  const session = ownerSession(locals);
  if (!session.ok) return session.response;
  if (!params.id) return missingParams();
  const spec = await loadSpec(locals.db, session.tenantId, params.id);
  if (!spec) return json({ error: 'Not found' }, 404);
  return json({ spec });
};

export const PUT: APIRoute = async ({ locals, params, request }) => {
  const session = ownerSession(locals);
  if (!session.ok) return session.response;
  if (!params.id) return missingParams();
  const body = await request.json().catch(() => null) as { spec?: unknown } | null;
  const spec = parseAppSpec(body?.spec);
  if (!spec) return json({ error: 'Spec inválida.' }, 400);
  try {
    const version = await saveSpecVersion(locals.db, {
      tenantId: session.tenantId,
      appId: params.id,
      spec,
      source: 'wizard',
      userId: session.user.id,
    });
    return json({ version });
  } catch {
    return fail(500);
  }
};
