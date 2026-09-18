interface WorkersAiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    WORKERS_AI_MODEL?: string;
    AI_GATEWAY_ID?: string;
    AI?: WorkersAiBinding;
  }
}
