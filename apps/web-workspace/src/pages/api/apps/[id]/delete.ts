import type { APIRoute } from 'astro';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { requireOwner } from '../../../../lib/access';
import { fail, json } from '../../../../app/http/responses';
import { deleteApp } from '@planilla/apps/retention';

export const POST: APIRoute = async ({ locals, params, redirect, request }) => {
  const session = requireOwner(locals);
  if (!session || !params.id) return redirect('/login');
  const wantsJson = request.headers.get('accept')?.includes('application/json');
  try {
    const deleted = await deleteApp(locals.db, cloudflareEnv.BUCKET, session.tenantId, params.id);
    if (wantsJson) return json({ deleted });
    return redirect('/');
  } catch {
    return fail(500);
  }
};
