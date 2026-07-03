import { RedisOptions } from 'ioredis';
import { z } from 'zod';

import { defineModuleConfig } from '../config';

declare global {
  interface AppConfigSchema {
    redis: {
      host: string;
      port: number;
      db: number;
      username: string;
      password: string;
      // Upstash (and most managed/serverless Redis providers) require TLS.
      // Ignored if a `rediss://` connection URL env var is detected instead
      // (see ./url.ts) — that already implies TLS.
      tls: boolean;
      ioredis: ConfigItem<
        Omit<
          RedisOptions,
          'host' | 'port' | 'db' | 'username' | 'password' | 'tls'
        >
      >;
    };
  }
}

defineModuleConfig('redis', {
  db: {
    desc: 'The database index of redis server to be used(Must be less than 10). Only meaningful for self-hosted Redis — managed/serverless providers like Upstash only support database 0, so app-level isolation between cache/session/socketio/queue now uses key prefixes instead of separate db indexes.',
    default: 0,
    env: ['REDIS_SERVER_DATABASE', 'integer'],
    shape: z.number().int().nonnegative().max(10),
  },
  host: {
    desc: 'The host of the redis server.',
    default: 'localhost',
    env: ['REDIS_SERVER_HOST', 'string'],
  },
  port: {
    desc: 'The port of the redis server.',
    default: 6379,
    env: ['REDIS_SERVER_PORT', 'integer'],
    shape: z.number().positive(),
  },
  username: {
    desc: 'The username of the redis server.',
    default: '',
    env: ['REDIS_SERVER_USERNAME', 'string'],
  },
  password: {
    desc: 'The password of the redis server.',
    default: '',
    env: ['REDIS_SERVER_PASSWORD', 'string'],
  },
  tls: {
    desc: 'Whether to connect to the redis server over TLS. Required for Upstash and most managed Redis providers.',
    default: false,
    env: ['REDIS_ENABLE_TLS', 'boolean'],
  },
  ioredis: {
    desc: 'The config for the ioredis client.',
    default: {},
    link: 'https://github.com/luin/ioredis',
  },
});
