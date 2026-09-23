import type { APIRoute } from 'astro';
import { cloudflareEnv } from '@planilla/cloudflare/env';
import { missingParams, ownerSession } from '../../../../../../lib/access';
import { fail, json } from '../../../../../../app/http/responses';
import { applyProposal } from '@planilla/apps/evolution';
import { scheduleAppJob } from '@planilla/apps/jobs';

export const POST: APIRoute = async ({ locals, params }) => {
  const session = ownerSession(locals);
  if (!session.ok) return session.response;
  if (!params.id || !params.proposalId) return missingParams();
  try {
    const result = await applyProposal(locals.db, {
      tenantId: session.tenantId,
      appId: params.id,
      proposalId: params.proposalId,
      userId: session.user.id,
    });
    if (result.queued) {
      await scheduleAppJob(locals.db, cloudflareEnv, {
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
