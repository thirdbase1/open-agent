import { DynamicModule, ExecutionContext } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';
import { ClsModule } from 'nestjs-cls';

import { AppController } from './app.controller';
import {
  getRequestFromHost,
  getRequestIdFromHost,
  getRequestIdFromRequest,
  ScannerModule,
} from './base';
import { CacheModule } from './base/cache';
import { ConfigModule } from './base/config';
import { ErrorModule } from './base/error';
import { EventModule } from './base/event';
import { GqlModule } from './base/graphql';
import { HelpersModule } from './base/helpers';
import { JobModule } from './base/job';
import { LoggerModule } from './base/logger';
import { MetricsModule } from './base/metrics';
import { MutexModule } from './base/mutex';
import { PrismaModule } from './base/prisma';
import { RedisModule } from './base/redis';
import { StorageProviderModule } from './base/storage';
import { RateLimiterModule } from './base/throttler';
import { WebSocketModule } from './base/websocket';
import { AuthModule } from './core/auth';
import { ServerConfigModule, ServerConfigResolverModule } from './core/config';
import { FeatureModule } from './core/features';
import { MailModule } from './core/mail';
import { QuotaModule } from './core/quota';
import { StorageModule } from './core/storage';
import { UserModule } from './core/user';
import { VersionModule } from './core/version';
import { Env } from './env';
import { ModelsModule } from './models';
import { CopilotModule } from './plugins/copilot';
import { GCloudModule } from './plugins/gcloud';
import { OAuthModule } from './plugins/oauth';

export const FunctionalityModules = [
  ClsModule.forRoot({
    global: true,
    // for http / graphql request
    middleware: {
      mount: true,
      generateId: true,
      idGenerator(req: Request) {
        // make every request has a unique id to tracing
        return getRequestIdFromRequest(req, 'http');
      },
      setup(cls, req: Request, res: Response) {
        res.setHeader('X-Request-Id', cls.getId());
        cls.set(CLS_REQUEST_HOST, req.hostname);
      },
    },
    // for websocket connection
    // https://papooch.github.io/nestjs-cls/considerations/compatibility#websockets
    interceptor: {
      mount: true,
      generateId: true,
      idGenerator(context: ExecutionContext) {
        // make every request has a unique id to tracing
        return getRequestIdFromHost(context);
      },
      setup(cls, context: ExecutionContext) {
        const req = getRequestFromHost(context);
        cls.set(CLS_REQUEST_HOST, req.hostname);
      },
    },
    plugins: [
      // https://papooch.github.io/nestjs-cls/plugins/available-plugins/transactional/prisma-adapter
      new ClsPluginTransactional({
        adapter: new TransactionalAdapterPrisma({
          prismaInjectionToken: PrismaClient,
        }),
      }),
    ],
  }),
  LoggerModule,
  ScannerModule,
  PrismaModule,
  EventModule,
  ConfigModule,
  RedisModule,
  CacheModule,
  MutexModule,
  MetricsModule,
  RateLimiterModule,
  StorageProviderModule,
  HelpersModule,
  ErrorModule,
  WebSocketModule,
  JobModule.forRoot(),
  ModelsModule,
  ScheduleModule.forRoot(),
];

export class AppModuleBuilder {
  private readonly modules: OpenAgentModule[] = [];

  use(...modules: OpenAgentModule[]): this {
    modules.forEach(m => {
      this.modules.push(m);
    });

    return this;
  }

  useIf(predicator: () => boolean, ...modules: OpenAgentModule[]): this {
    if (predicator()) {
      this.use(...modules);
    }

    return this;
  }

  compile(): DynamicModule {
    class AppModule {}

    return {
      module: AppModule,
      imports: this.modules,
      controllers: [AppController],
    };
  }
}

export function buildAppModule(env: Env) {
  const factor = new AppModuleBuilder();

  factor
    // basic
    .use(...FunctionalityModules)

    // auth
    .use(UserModule, AuthModule)

    // business modules
    .use(ServerConfigModule, FeatureModule, QuotaModule, MailModule)

    // graphql server only
    .useIf(
      () => env.flavors.graphql,
      GqlModule,
      VersionModule,
      StorageModule,
      ServerConfigResolverModule,
      CopilotModule,
      OAuthModule
    )

    // gcloud
    .useIf(() => env.gcp, GCloudModule);

  return factor.compile();
}

export const AppModule = buildAppModule(env);
