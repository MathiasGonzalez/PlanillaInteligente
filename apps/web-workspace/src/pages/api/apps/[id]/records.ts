import type { APIRoute } from 'astro';
import { missingParams, userSession } from '../../../../lib/access';
import { fail, json } from '../../../../app/http/responses';
import { createRecord, listRecords, loadSpec, RecordValidationError, redactRestrictedData, searchRelationOptions } from '@planilla/apps/records';
import { entityOf } from '@planilla/apps/spec';
import { WorkspaceQuotaError } from '@planilla/apps/usage';

export const GET: APIRoute = async ({ locals, params, url }) => {
  const session = userSession(locals);
  if (!session.ok) return session.response;
  if (!params.id) return missingParams();
  const spec = await loadSpec(locals.db, session.tenantId, params.id);
  const entityKey = url.searchParams.get('entity') ?? '';
  const entity = spec ? entityOf(spec, entityKey) : null;
  if (!spec || !entity) return json({ error: 'Not found' }, 404);
  if (url.searchParams.get('options') === '1') {
    const options = await searchRelationOptions(locals.db, session.tenantId, params.id, entity, url.searchParams.get('q') ?? '');
    return json({ options });
  }
  const filters = url.searchParams.get('filterField') && url.searchParams.get('filterValue')
    ? [{ fieldKey: url.searchParams.get('filterField') ?? '', op: 'eq' as const, value: url.searchParams.get('filterValue') ?? '' }]
    : [];
  const page = await listRecords(locals.db, {
    tenantId: session.tenantId,
    appId: params.id,
    entityKey,
    search: url.searchParams.get('q') ?? undefined,
    filters,
    sortField: url.searchParams.get('sort'),
    sortDirection: url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
    cursor: url.searchParams.get('cursor'),
    restrictedKeys: entity.fields.filter((field) => field.sensitive || field.specialCategory).map((field) => field.key),
  });
  return json({
    ...page,
    rows: page.rows.map((row) => ({ ...row, data: redactRestrictedData(entity.fields, row.data) })),
  });
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  const session = userSession(locals);
  if (!session.ok) return session.response;
  if (!params.id) return missingParams();
  const spec = await loadSpec(locals.db, session.tenantId, params.id);
  const body = await request.json().catch(() => null) as { entityKey?: string; data?: Record<string, unknown> } | null;
  const entity = spec && body?.entityKey ? entityOf(spec, body.entityKey) : null;
  if (!entity || !body?.data) return json({ error: 'Not found' }, 404);
  try {
    const id = await createRecord(locals.db, {
      tenantId: session.tenantId,
      appId: params.id,
      entity,
      userId: session.user.id,
      input: body.data,
    });
    return json({ id }, 201);
  } catch (error) {
    if (error instanceof RecordValidationError) return json({ error: error.message }, 400);
    if (error instanceof WorkspaceQuotaError) return json({ error: error.message }, 403);
    return fail(500);
  }
};
