import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { appSpecVersions } from '@planilla/cloudflare/d1/schema';
import { missingParams, ownerSession } from '../../../../../../lib/access';
import { fail, json } from '../../../../../../app/http/responses';
import { saveSpecVersion } from '@planilla/apps/records';
import { parseAppSpec } from '@planilla/apps/spec';

export const POST: APIRoute = async ({ locals, params }) => {
  const session = ownerSession(locals);
  if (!session.ok) return session.response;
  const version = Number(params.version);
  if (!params.id || !Number.isInteger(version)) return missingParams();
  const [row] = await locals.db.select().from(appSpecVersions).where(and(
    eq(appSpecVersions.tenantId, session.tenantId),
    eq(appSpecVersions.appId, params.id),
    eq(appSpecVersions.version, version),
  )).limit(1);
  const spec = row ? parseAppSpec(row.spec) : null;
  if (!spec) return json({ error: 'Not found' }, 404);
  try {
    const next = await saveSpecVersion(locals.db, {
      tenantId: session.tenantId,
      appId: params.id,
      spec,
      source: 'restore',
      userId: session.user.id,
    });
    return json({ version: next });
  } catch {
    return fail(500);
  }
};
