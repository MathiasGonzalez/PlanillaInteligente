import type { APIRoute } from 'astro';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { requireOwner } from '../../../../../../lib/access';
import { fail, json } from '../../../../../../app/http/responses';
import { applyProposal } from '@planilla/apps/evolution';
import { scheduleAppJob } from '@planilla/apps/jobs';

export const POST: APIRoute = async ({ locals, params }) => {
  const session = requireOwner(locals);
  if (!session || !params.id || !params.proposalId) return json({ error: 'Unauthorized' }, 401);
  try {
    const result = await applyProposal(locals.db, {
      tenantId: session.tenantId,
      appId: params.id,
      proposalId: params.proposalId,
      userId: session.user.id,
    });
    if (result.queued) {
      await scheduleAppJob(locals.db, { ...cloudflareEnv, ANALYSIS_MODE: 'queue' }, {
        kind: 'apply-proposal',
        tenantId: session.tenantId,
        appId: params.id,
        refId: params.proposalId,
        requestedByUserId: session.user.id,
      });
    }
    return json(result);
  } catch {
    return fail(500);
  }
};
