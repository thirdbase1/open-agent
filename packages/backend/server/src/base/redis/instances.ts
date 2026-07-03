import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis as IORedis, RedisOptions } from 'ioredis';

import { Config } from '../config';
import { redisOptionsFromConnectionUrl } from './url';

// Managed/serverless Redis (Upstash via Vercel Marketplace, and most other
// hosted Redis) only supports database 0 — the classic `SELECT 1/2/3` /
// per-db isolation this app used to rely on doesn't work there. So instead
// of separating cache/session/socketio/queue traffic by db index, we now
// separate them by ioredis `keyPrefix`, which works identically everywhere
// (self-hosted Redis, Upstash, or any other provider) since it's applied
// client-side before commands are sent, not by picking a different backend
// database.
//
// Exception: the BullMQ queue connection. BullMQ's own docs explicitly warn
// against using ioredis's keyPrefix on a connection it manages — it can
// corrupt the keys its Lua scripts construct internally. BullMQ already has
// its own namespacing for this (the `prefix` option configured once in
// job/queue/index.ts), so QueueRedis intentionally gets no keyPrefix here.
function baseOptions(config: Config): RedisOptions {
  return {
    ...config.redis,
    ...(config.redis.tls ? { tls: {} } : {}),
    ...redisOptionsFromConnectionUrl(),
    ...config.redis.ioredis,
  };
}

class Redis extends IORedis implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(this.constructor.name);

  errorHandler = (err: Error) => {
    this.logger.error(err);
  };

  onModuleInit() {
    this.on('error', this.errorHandler);
  }

  onModuleDestroy() {
    this.disconnect();
  }

  override duplicate(override?: Partial<RedisOptions>): IORedis {
    const client = super.duplicate(override);
    client.on('error', this.errorHandler);
    return client;
  }
}

@Injectable()
export class CacheRedis extends Redis {
  constructor(config: Config) {
    super({ ...baseOptions(config), keyPrefix: 'cache:' });
  }
}

@Injectable()
export class SessionRedis extends Redis {
  constructor(config: Config) {
    super({ ...baseOptions(config), keyPrefix: 'session:' });
  }
}

@Injectable()
export class SocketIoRedis extends Redis {
  constructor(config: Config) {
    super({ ...baseOptions(config), keyPrefix: 'socketio:' });
  }
}

@Injectable()
export class QueueRedis extends Redis {
  constructor(config: Config) {
    super({
      ...baseOptions(config),
      // required explicitly set to `null` by bullmq
      maxRetriesPerRequest: null,
    });
  }
}
