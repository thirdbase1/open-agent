import { Injectable, Logger } from '@nestjs/common';

import {
  R2StorageConfig,
  S3StorageConfig,
  StorageProvider,
  StorageProviderConfig,
  StorageProviders,
} from './providers';

/**
 * When R2 env vars are present (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET), they override the config-file / admin-panel
 * storage settings. This lets you deploy on Vercel without touching the
 * runtime config API — just set env vars.
 *
 * Cloudflare R2 free tier: 10 GB storage, Class A ops free, zero egress.
 */
function maybeOverrideFromEnv(
  config: StorageProviderConfig
): StorageProviderConfig {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (accountId && accessKeyId && secretAccessKey) {
    const r2Config: R2StorageConfig = {
      accountId,
      credentials: { accessKeyId, secretAccessKey },
      region: 'auto',
      forcePathStyle: true,
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    return {
      provider: 'cloudflare-r2',
      bucket: bucket || config.bucket,
      config: r2Config,
    };
  }

  // Also support generic S3 env vars (AWS_S3_*) for AWS Marketplace users
  const s3AccessKey = process.env.AWS_S3_ACCESS_KEY_ID;
  const s3SecretKey = process.env.AWS_S3_SECRET_ACCESS_KEY;
  const s3Bucket = process.env.AWS_S3_BUCKET;
  const s3Region = process.env.AWS_S3_REGION;
  const s3Endpoint = process.env.AWS_S3_ENDPOINT;

  if (s3AccessKey && s3SecretKey) {
    const s3Config: S3StorageConfig = {
      credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey },
      region: s3Region || 'us-east-1',
      ...(s3Endpoint ? { endpoint: s3Endpoint, forcePathStyle: true } : {}),
    };
    return {
      provider: 'aws-s3',
      bucket: s3Bucket || config.bucket,
      config: s3Config,
    };
  }

  return config;
}

@Injectable()
export class StorageProviderFactory {
  private readonly logger = new Logger(StorageProviderFactory.name);

  create(config: StorageProviderConfig): StorageProvider {
    const resolved = maybeOverrideFromEnv(config);

    if (resolved !== config) {
      this.logger.log(
        `Storage provider overridden from env vars: ${resolved.provider}/${resolved.bucket}`
      );
    }

    const Provider = StorageProviders[resolved.provider];

    if (!Provider) {
      throw new Error(`Unknown storage provider type: ${resolved.provider}`);
    }

    return new Provider(resolved.config, resolved.bucket);
  }
}
