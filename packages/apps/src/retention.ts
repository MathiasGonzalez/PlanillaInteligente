import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { appChangeProposals, apps, emailLoginChallenges, invitations, memberships, organizations, recordChanges, sessions, users, workbooks } from '@planilla/cloudflare/d1/schema';
import { deleteKv } from '@planilla/cloudflare/kv';
import { deleteObject, deleteObjectsByPrefix } from '@planilla/cloudflare/r2';
import type { Database } from './db';

export const ACCOUNT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CHANGE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const PROPOSAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_RETENTION_MS = 24 * 60 * 60 * 1000;

async function revokeSessionRows(
  db: Database,
  kv: KVNamespace | undefined,
  rows: Array<{ sessionToken: string }>,
  deleteRows: () => Promise<unknown>,
) {
  await Promise.all(rows.map((row) => deleteKv(kv, `session:${row.sessionToken}`)));
  if (rows.length > 0) await deleteRows();
}

export async function deleteSessionByToken(db: Database, kv: KVNamespace | undefined, sessionToken: string) {
  await revokeSessionRows(db, kv, [{ sessionToken }], () => db.delete(sessions).where(eq(sessions.sessionToken, sessionToken)));
}

export async function revokeSessionsForUser(db: Database, kv: KVNamespace | undefined, userId: string) {
  const rows = await db.select({ sessionToken: sessions.sessionToken }).from(sessions).where(eq(sessions.userId, userId));
  await revokeSessionRows(db, kv, rows, () => db.delete(sessions).where(eq(sessions.userId, userId)));
}

export async function revokeSessionsForTenant(db: Database, kv: KVNamespace | undefined, tenantId: string) {
  const rows = await db.select({ sessionToken: sessions.sessionToken }).from(sessions).where(eq(sessions.activeOrganizationId, tenantId));
  await revokeSessionRows(db, kv, rows, () => db.delete(sessions).where(eq(sessions.activeOrganizationId, tenantId)));
}

async function deleteUsersWithoutMembership(db: Database, userIds: string[]) {
  for (const userId of userIds) {
    const [remaining] = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
    if (!remaining) await db.delete(users).where(eq(users.id, userId));
  }
}

export async function eraseOrganization(db: Database, bucket: R2Bucket, kv: KVNamespace | undefined, organizationId: string) {
  const members = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.organizationId, organizationId));
  await deleteObjectsByPrefix(bucket, `${organizationId}/`);
  await revokeSessionsForTenant(db, kv, organizationId);
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await deleteUsersWithoutMembership(db, members.map((member) => member.userId));
}

export async function deleteApp(db: Database, bucket: R2Bucket, tenantId: string, appId: string) {
  const [app] = await db.select().from(apps).where(and(eq(apps.id, appId), eq(apps.tenantId, tenantId))).limit(1);
  if (!app) return false;
  if (app.workbookId) {
    const others = await db.select({ id: apps.id }).from(apps).where(and(eq(apps.workbookId, app.workbookId), eq(apps.tenantId, tenantId)));
    if (others.length === 1) {
      const [workbook] = await db.select({ r2Key: workbooks.r2Key }).from(workbooks).where(and(eq(workbooks.id, app.workbookId), eq(workbooks.tenantId, tenantId))).limit(1);
      if (workbook) await deleteObject(bucket, workbook.r2Key);
      await db.delete(workbooks).where(and(eq(workbooks.id, app.workbookId), eq(workbooks.tenantId, tenantId)));
    }
  }
  await db.delete(apps).where(and(eq(apps.id, appId), eq(apps.tenantId, tenantId)));
  return true;
}

export async function deactivateOrganization(db: Database, organizationId: string) {
  const now = new Date();
  await db.update(organizations).set({ deactivatedAt: now, updatedAt: now }).where(and(eq(organizations.id, organizationId), isNull(organizations.deactivatedAt)));
}

export async function purgeDeactivatedOrganizations(db: Database, bucket: R2Bucket, kv: KVNamespace | undefined, now = new Date()) {
  const cutoff = new Date(now.getTime() - ACCOUNT_RETENTION_MS);
  const due = await db.select({ id: organizations.id }).from(organizations).where(and(isNotNull(organizations.deactivatedAt), lt(organizations.deactivatedAt, cutoff)));
  for (const organization of due) await eraseOrganization(db, bucket, kv, organization.id);
  return due.length;
}

export async function purgeExpiredSessions(db: Database, kv: KVNamespace | undefined, now = new Date()) {
  const expired = await db.select({ sessionToken: sessions.sessionToken }).from(sessions).where(lt(sessions.expiresAt, now));
  await revokeSessionRows(db, kv, expired, () => db.delete(sessions).where(lt(sessions.expiresAt, now)));
  return expired.length;
}

export async function purgeOperationalResidue(db: Database, now = new Date()) {
  const challenges = await db.delete(emailLoginChallenges).where(lt(emailLoginChallenges.createdAt, new Date(now.getTime() - CHALLENGE_RETENTION_MS)));
  const tenants = await db.select({ id: organizations.id }).from(organizations);
  const changeCutoff = new Date(now.getTime() - CHANGE_RETENTION_MS);
  const proposalCutoff = new Date(now.getTime() - PROPOSAL_RETENTION_MS);
  for (const tenant of tenants) {
    await db.delete(invitations).where(and(
      eq(invitations.tenantId, tenant.id),
      lt(invitations.expiresAt, now),
      isNull(invitations.acceptedAt),
    ));
    await db.delete(recordChanges).where(and(
      eq(recordChanges.tenantId, tenant.id),
      lt(recordChanges.createdAt, changeCutoff),
    ));
    await db.delete(appChangeProposals).where(and(
      eq(appChangeProposals.tenantId, tenant.id),
      lt(appChangeProposals.createdAt, proposalCutoff),
      or(
        eq(appChangeProposals.status, 'pending'),
        eq(appChangeProposals.status, 'rejected'),
        eq(appChangeProposals.status, 'failed'),
        eq(appChangeProposals.status, 'stale'),
      ),
    ));
  }
  return { challenges: challenges.meta?.changes ?? 0 };
}
