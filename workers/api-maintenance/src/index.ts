import { createDatabase } from '@planilla/cloudflare/d1';
import { purgeDeactivatedOrganizations, purgeExpiredSessions, purgeOperationalResidue } from '@planilla/apps/retention';

interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  SESSION_KV?: KVNamespace;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const db = createDatabase(env.DB);
      const organizations = await purgeDeactivatedOrganizations(db, env.BUCKET, env.SESSION_KV);
      const sessions = await purgeExpiredSessions(db, env.SESSION_KV);
      const residue = await purgeOperationalResidue(db);
      console.log(JSON.stringify({ event: 'retention_purge', organizations, sessions, challenges: residue.challenges }));
    })());
  },
};
