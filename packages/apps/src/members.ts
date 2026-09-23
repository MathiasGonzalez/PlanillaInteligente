import { and, eq, isNull } from 'drizzle-orm';
import { invitations, memberships, users } from '@planilla/cloudflare/d1/schema';
import type { Database } from './db';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createInvitation(db: Database, params: { tenantId: string; userId: string }) {
  const token = randomToken();
  const id = crypto.randomUUID();
  await db.insert(invitations).values({
    id,
    tenantId: params.tenantId,
    tokenHash: await sha256Hex(token),
    role: 'member',
    createdByUserId: params.userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return { id, token };
}

export async function listInvitations(db: Database, tenantId: string) {
  return db.select({
    id: invitations.id,
    role: invitations.role,
    expiresAt: invitations.expiresAt,
    acceptedAt: invitations.acceptedAt,
  }).from(invitations).where(eq(invitations.tenantId, tenantId));
}

export async function acceptInvitation(db: Database, params: { token: string; userId: string }) {
  const tokenHash = await sha256Hex(params.token);
  const [invite] = await db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).limit(1);
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) return null;
  const [existing] = await db.select({ id: memberships.id }).from(memberships).where(and(
    eq(memberships.organizationId, invite.tenantId),
    eq(memberships.userId, params.userId),
  )).limit(1);
  if (!existing) {
    await db.insert(memberships).values({
      id: crypto.randomUUID(),
      organizationId: invite.tenantId,
      userId: params.userId,
      role: invite.role,
    });
  }
  await db.update(users).set({ defaultOrganizationId: invite.tenantId, updatedAt: new Date() }).where(eq(users.id, params.userId));
  await db.update(invitations).set({
    acceptedAt: new Date(),
    acceptedByUserId: params.userId,
    updatedAt: new Date(),
  }).where(and(eq(invitations.id, invite.id), isNull(invitations.acceptedAt)));
  return { tenantId: invite.tenantId, role: invite.role };
}

export async function listMembers(db: Database, tenantId: string) {
  return db.select({
    userId: users.id,
    email: users.email,
    name: users.name,
    role: memberships.role,
  }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.organizationId, tenantId));
}
