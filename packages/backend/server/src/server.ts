import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import graphqlUploadExpress from 'graphql-upload/graphqlUploadExpress.mjs';

import {
  OpenAgentLogger,
  CacheInterceptor,
  CloudThrottlerGuard,
  Config,
  GlobalExceptionFilter,
  URLHelper,
} from './base';
import { SocketIoAdapter } from './base/websocket';
import { AuthGuard } from './core/auth';
import { serverTimingAndCache } from './middleware/timing';

const OneMB = 1024 * 1024;

export async function run() {
  // Log critical env var status for debugging Vercel deployment issues
  const requiredEnvVars = ['DATABASE_URL', 'REDIS_URL'];
  const missing = requiredEnvVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.warn(
      `[open-agent] WARNING: Missing env vars: ${missing.join(', ')}. ` +
        `Using defaults — app may not function correctly in production.`
    );
  }

  const { AppModule } = await import('./app.module');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
    rawBody: true,
    bodyParser: true,
    bufferLogs: true,
  });

  app.useBodyParser('raw', { limit: 100 * OneMB });

  const logger = app.get(OpenAgentLogger);
  app.useLogger(logger);
  const config = app.get(Config);

  if (config.server.path) {
    app.setGlobalPrefix(config.server.path);
  }

  app.use(serverTimingAndCache);

  app.use(
    graphqlUploadExpress({
      maxFileSize: 100 * OneMB,
      maxFiles: 32,
    })
  );

  app.useGlobalGuards(app.get(AuthGuard), app.get(CloudThrottlerGuard));
  app.useGlobalInterceptors(app.get(CacheInterceptor));
  app.useGlobalFilters(new GlobalExceptionFilter(app.getHttpAdapter()));
  app.use(cookieParser());
  // only enable shutdown hooks in production
  // https://docs.nestjs.com/fundamentals/lifecycle-events#application-shutdown
  if (env.prod) {
    app.enableShutdownHooks();
  }

  const adapter = new SocketIoAdapter(app);
  app.useWebSocketAdapter(adapter);

  const url = app.get(URLHelper);
  const listeningHost = '0.0.0.0';

  // Vercel assigns PORT dynamically — override config if set
  const vercelPort = parseInt(process.env.PORT || '', 10);
  const listenPort = vercelPort || config.server.port;
  await app.listen(listenPort, listeningHost);

  logger.log(`Open-Agent Server is running in [${env.DEPLOYMENT_TYPE}] mode`);
  logger.log(`Listening on http://${listeningHost}:${listenPort}`);
  logger.log(`And the public server should be recognized as ${url.baseUrl}`);
}
