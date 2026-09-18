import type { APIRoute } from 'astro';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { destroyUserSession } from '../../../lib/auth';

export const POST: APIRoute = async ({ cookies, locals, redirect }) => {
  await destroyUserSession(locals.db, cloudflareEnv.SESSION_KV, cookies, locals.session?.sessionToken ?? null);
  return redirect('/login');
};
