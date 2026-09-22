import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { appSpecVersions } from '@planilla/cloudflare/d1/schema';
import { requireOwner } from '../../../../../../lib/access';
import { fail, json } from '../../../../../../app/http/responses';
import { saveSpecVersion } from '@planilla/apps/records';
import { parseAppSpec } from '@planilla/apps/spec';

export const POST: APIRoute = async ({ locals, params }) => {
  const session = requireOwner(locals);
  const version = Number(params.version);
  if (!session || !params.id || !Number.isInteger(version)) return json({ error: 'Unauthorized' }, 401);
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
