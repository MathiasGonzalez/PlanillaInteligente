import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from '@planilla/cloudflare/d1/schema';

export type Database = DrizzleD1Database<typeof schema>;

export interface AiEnv {
  AI?: { run(model: string, input: unknown, options?: unknown): Promise<unknown> };
  WORKERS_AI_MODEL?: string;
  AI_GATEWAY_ID?: string;
}
