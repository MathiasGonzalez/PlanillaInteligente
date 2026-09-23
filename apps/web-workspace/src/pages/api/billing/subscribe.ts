import type { APIRoute } from 'astro';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { hasMercadopagoToken } from '@planilla/apps/billing';
import { ownerSession } from '../../../lib/access';
import { json } from '../../../app/http/responses';

export const POST: APIRoute = async ({ locals }) => {
  const session = ownerSession(locals);
  if (!session.ok) return session.response;
  if (!hasMercadopagoToken(cloudflareEnv.MERCADOPAGO_ACCESS_TOKEN)) {
    return json({ error: 'El cobro todavía no está conectado.' }, 503);
  }
  return json({ error: 'El checkout se conecta en el paso siguiente.' }, 501);
};
