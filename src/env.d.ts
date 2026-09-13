/// <reference types="astro/client" />

interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  SESSION_KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
}

declare namespace App {
  interface Locals {
    runtime: { env: Env };
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
