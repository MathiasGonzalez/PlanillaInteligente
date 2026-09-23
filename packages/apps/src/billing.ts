import { desc, eq } from 'drizzle-orm';
import { billingAccounts, payments } from '@planilla/cloudflare/d1/schema';
import type { Database } from './db';

export async function createBillingAccount(db: Database, organizationId: string) {
  await db.insert(billingAccounts).values({
    organizationId,
    plan: 'free',
    status: 'none',
  });
}

export async function getBillingAccount(db: Database, organizationId: string) {
  const [row] = await db.select().from(billingAccounts).where(eq(billingAccounts.organizationId, organizationId)).limit(1);
  return row ?? null;
}

export async function listPayments(db: Database, tenantId: string) {
  return db.select().from(payments).where(eq(payments.tenantId, tenantId)).orderBy(desc(payments.createdAt)).limit(50);
}

export function hasMercadopagoToken(accessToken?: string) {
  return Boolean(accessToken?.trim());
}
