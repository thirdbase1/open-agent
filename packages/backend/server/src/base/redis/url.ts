import { RedisOptions } from 'ioredis';

// Managed/serverless Redis (Upstash on Vercel Marketplace, Vercel's older KV
// product, Heroku, Railway, etc.) is typically handed to an app as a single
// connection URL rather than discrete host/port/user/pass fields. We check a
// short, ordered list of the env var names these platforms commonly use, so
// deploying to Vercel + Upstash doesn't require the user to manually split a
// URL into pieces — while self-hosted setups that still use
// REDIS_SERVER_HOST/PORT/etc. keep working unchanged (this is only a
// fallback, checked before the discrete fields are applied).
const CONNECTION_URL_ENVS = ['REDIS_URL', 'KV_URL', 'UPSTASH_REDIS_URL'];

export function redisOptionsFromConnectionUrl(): Partial<RedisOptions> | null {
  for (const name of CONNECTION_URL_ENVS) {
    const raw = process.env[name];
    if (!raw) continue;
    try {
      const url = new URL(raw);
      const isTls = url.protocol === 'rediss:';
      return {
        host: url.hostname,
        port: url.port ? Number(url.port) : 6379,
        username: url.username || undefined,
        password: url.password || undefined,
        ...(isTls ? { tls: {} } : {}),
      };
    } catch {
      // malformed value under one of these names — ignore and keep
      // checking the rest / fall back to discrete config fields.
    }
  }
  return null;
}
