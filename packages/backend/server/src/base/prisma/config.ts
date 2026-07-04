import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { defineModuleConfig } from '../config';

declare global {
  interface AppConfigSchema {
    db: {
      datasourceUrl: string;
      prisma: ConfigItem<Prisma.PrismaClientOptions>;
    };
  }
}

defineModuleConfig('db', {
  datasourceUrl: {
    desc: 'The datasource url for the prisma client.',
    default: 'postgresql://localhost:5432/open_agent',
    env: 'DATABASE_URL',
    // Don't use z.string().url() — Postgres connection strings often have
    // special characters in passwords (e.g. p@ssw0rd!) that fail URL
    // validation. Just ensure it's a non-empty string.
    shape: z.string().min(1),
  },
  prisma: {
    desc: 'The config for the prisma client.',
    default: {},
    link: 'https://www.prisma.io/docs/reference/api-reference/prisma-client-reference',
  },
});
