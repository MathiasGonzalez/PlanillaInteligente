import { env } from 'cloudflare:workers';

export const cloudflareEnv = env;

export type AppEnv = Cloudflare.Env;
