import type { APIRoute } from 'astro';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { missingParams, ownerSession, requireUser } from '../../../../lib/access';
import { fail, json } from '../../../../app/http/responses';
import { deleteApp } from '@planilla/apps/retention';

export const POST: APIRoute = async ({ locals, params, redirect, request }) => {
  const wantsJson = request.headers.get('accept')?.includes('application/json');
  const session = ownerSession(locals);
  if (!session.ok) {
    if (wantsJson) return session.response;
    return redirect(requireUser(locals) ? '/' : '/login');
  }
  if (!params.id) return missingParams();
  try {
    const deleted = await deleteApp(locals.db, cloudflareEnv.BUCKET, session.tenantId, params.id);
    if (wantsJson) return json({ deleted });
    return redirect('/');
  } catch {
    return fail(500);
  }
};
