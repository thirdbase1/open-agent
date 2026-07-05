import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { Config } from '../config';

@Injectable()
export class PrismaFactory implements OnModuleDestroy {
  private readonly logger = new Logger('PrismaFactory');
  static INSTANCE: PrismaClient | null = null;
  readonly #instance: PrismaClient;
  readonly #connected: boolean;

  constructor(config: Config) {
    const url = config.db.datasourceUrl;
    const hasRealDb =
      process.env.DATABASE_URL &&
      !url.startsWith('postgresql://localhost:5432');

    if (hasRealDb) {
      this.#instance = new PrismaClient(config.db.prisma);
      this.#connected = true;
    } else {
      this.logger.warn(
        'No DATABASE_URL configured. Running without a database. ' +
          'Most features will be unavailable until DATABASE_URL is set.'
      );
      // Proxy that throws clear errors instead of crashing the process
      this.#instance = new Proxy({} as PrismaClient, {
        get(_, prop) {
          if (prop === '$connect' || prop === '$disconnect')
            return async () => {};
          if (prop === '$on' || prop === '$use') return () => {};
          if (typeof prop === 'symbol') return undefined;
          return () => {
            throw new Error(
              'Database is not configured. Set DATABASE_URL to enable database features.'
            );
          };
        },
      });
      this.#connected = false;
    }
    PrismaFactory.INSTANCE = this.#instance;
  }

  get() {
    return this.#instance;
  }

  async onModuleDestroy() {
    if (this.#connected) {
      await PrismaFactory.INSTANCE?.$disconnect();
    }
    PrismaFactory.INSTANCE = null;
  }
}
