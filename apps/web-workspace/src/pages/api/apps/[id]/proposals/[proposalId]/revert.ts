import type { APIRoute } from 'astro';
import { requireOwner } from '../../../../../../lib/access';
import { fail, json } from '../../../../../../app/http/responses';
import { revertProposal } from '@planilla/apps/evolution';

export const POST: APIRoute = async ({ locals, params }) => {
  const session = requireOwner(locals);
  if (!session || !params.id || !params.proposalId) return json({ error: 'Unauthorized' }, 401);
  try {
    const reverted = await revertProposal(locals.db, {
      tenantId: session.tenantId,
      appId: params.id,
      proposalId: params.proposalId,
    });
    if (!reverted) return json({ error: 'No se puede revertir: hubo cambios posteriores o no hay datos de esa propuesta.' }, 409);
    return json({ reverted: true });
  } catch {
    return fail(500);
  }
};
