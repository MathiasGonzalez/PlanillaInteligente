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
    TURNSTILE_SITE_KEY: string;
    TURNSTILE_SECRET_KEY: string;
    WORKERS_AI_MODEL?: string;
    AI_GATEWAY_ID?: string;
    TOKEN_ENCRYPTION_KEY?: string;
    AUTH_HMAC_KEY?: string;
    ANALYSIS_MODE?: string;
    EMAIL_SEND_URL?: string;
    EMAIL_API_KEY?: string;
    MERCADOPAGO_ACCESS_TOKEN?: string;
    MERCADOPAGO_WEBHOOK_SECRET?: string;
    MERCADOPAGO_PUBLIC_KEY?: string;
    AI?: WorkersAiBinding;
    ENRICHMENT_QUEUE?: QueueBinding<import('@planilla/apps/jobs').AppJobMessage>;
  }
}

declare namespace App {
  interface Locals {
    db: import('drizzle-orm/d1').DrizzleD1Database<typeof import('@planilla/cloudflare/d1/schema')>;
    user:
      | {
          id: string;
          email: string;
          name: string | null;
          image: string | null;
          defaultOrganizationId: string | null;
          role: 'owner' | 'member';
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
    orgDeactivated: boolean;
  }
}
