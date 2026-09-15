/// <reference types="astro/client" />

interface WorkersAiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}

interface QueueBinding<T = unknown> {
  send(message: T): Promise<void>;
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    SESSION_KV?: KVNamespace;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    TURNSTILE_SECRET_KEY: string;
    WORKERS_AI_MODEL?: string;
    AI_GATEWAY_ID?: string;
    AI?: WorkersAiBinding;
    ENRICHMENT_QUEUE?: QueueBinding<import('./spreadsheets/enrichment/types').SpreadsheetEnrichmentMessage>;
  }
}

declare namespace App {
  interface Locals {
    db: import('drizzle-orm/d1').DrizzleD1Database<typeof import('./db/schema')>;
    user:
      | {
          id: string;
          email: string;
          name: string | null;
          image: string | null;
          defaultOrganizationId: string | null;
          role: 'owner' | 'admin' | 'member';
        }
      | null;
    session:
      | {
          id: string;
          userId: string;
          sessionToken: string;
          activeOrganizationId: string;
          expiresAt: string;
        }
      | null;
    tenantId: string | null;
  }
}
