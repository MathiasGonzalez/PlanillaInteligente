import type { APIRoute } from 'astro';
import { requireUser } from '../../../../../lib/access';
import { fail, json } from '../../../../../app/http/responses';
import { deleteRecord, getRecord, loadSpec, RecordValidationError, redactRestrictedData, updateRecord } from '@planilla/apps/records';
import { entityOf } from '@planilla/apps/spec';

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const session = requireUser(locals);
  if (!session || !params.id || !params.recordId) return json({ error: 'Unauthorized' }, 401);
  const spec = await loadSpec(locals.db, session.tenantId, params.id);
  const current = await getRecord(locals.db, session.tenantId, params.id, params.recordId);
  const entity = spec && current ? entityOf(spec, current.entityKey) : null;
  const body = await request.json().catch(() => null) as { data?: Record<string, unknown> } | null;
  if (!entity || !body?.data) return json({ error: 'Not found' }, 404);
  try {
    const data = await updateRecord(locals.db, {
      tenantId: session.tenantId,
      appId: params.id,
      entity,
      recordId: params.recordId,
      userId: session.user.id,
      input: body.data,
    });
    return json({ data: data ? redactRestrictedData(entity.fields, data) : data });
  } catch (error) {
    if (error instanceof RecordValidationError) return json({ error: error.message }, 400);
    return fail(500);
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const session = requireUser(locals);
  if (!session || !params.id || !params.recordId) return json({ error: 'Unauthorized' }, 401);
  const current = await getRecord(locals.db, session.tenantId, params.id, params.recordId);
  if (!current) return json({ error: 'Not found' }, 404);
  const deleted = await deleteRecord(locals.db, {
    tenantId: session.tenantId,
    appId: params.id,
    entityKey: current.entityKey,
    recordId: params.recordId,
    userId: session.user.id,
  });
  return json({ deleted });
};
