import { z } from 'zod';

import { defineModuleConfig, JSONSchema } from '../../base';

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  args?: Record<string, string>;
}

export type OIDCArgs = {
  scope?: string;
  claim_id?: string;
  claim_email?: string;
  claim_name?: string;
};

export interface OAuthOIDCProviderConfig extends OAuthProviderConfig {
  issuer: string;
  args?: OIDCArgs;
}

export enum OAuthProviderName {
  Google = 'google',
  GitHub = 'github',
  OIDC = 'oidc',
}

// NOTE: these are plain nested objects (not `ConfigItem<T>`) so that each
// field (clientId, clientSecret, ...) is its own leaf config path and can
// carry its own `env` binding — same pattern already used by mailer's
// `SMTP.host`/`SMTP.port`/etc. This lets client id/secret be set directly as
// Vercel env vars instead of only via the runtime admin config API, while
// admin overrides (which operate on individual module.key paths, see
// ConfigFactory.validate) keep working exactly as before since the final
// runtime shape (`{ clientId, clientSecret, args }`) is unchanged.
declare global {
  interface AppConfigSchema {
    oauth: {
      providers: {
        [OAuthProviderName.Google]: {
          clientId: string;
          clientSecret: string;
          args: ConfigItem<Record<string, string>>;
        };
        [OAuthProviderName.GitHub]: {
          clientId: string;
          clientSecret: string;
          args: ConfigItem<Record<string, string>>;
        };
        [OAuthProviderName.OIDC]: {
          clientId: string;
          clientSecret: string;
          issuer: string;
          args: ConfigItem<OIDCArgs>;
        };
      };
    };
  }
}

const genericArgsDescriptor = {
  desc: 'Extra query args merged into the authorization request.',
  default: {},
  schema: { type: 'object' as const },
};

defineModuleConfig('oauth', {
  'providers.google.clientId': {
    desc: 'Google OAuth client id.',
    default: '',
    env: 'OAUTH_GOOGLE_CLIENT_ID',
    link: 'https://developers.google.com/identity/protocols/oauth2/web-server',
  },
  'providers.google.clientSecret': {
    desc: 'Google OAuth client secret.',
    default: '',
    env: 'OAUTH_GOOGLE_CLIENT_SECRET',
  },
  'providers.google.args': genericArgsDescriptor,
  'providers.github.clientId': {
    desc: 'GitHub OAuth client id.',
    default: '',
    env: 'OAUTH_GITHUB_CLIENT_ID',
    link: 'https://docs.github.com/en/apps/oauth-apps',
  },
  'providers.github.clientSecret': {
    desc: 'GitHub OAuth client secret.',
    default: '',
    env: 'OAUTH_GITHUB_CLIENT_SECRET',
  },
  'providers.github.args': genericArgsDescriptor,
  'providers.oidc.clientSecret': {
    desc: 'OIDC OAuth client secret.',
    default: '',
    env: 'OAUTH_OIDC_CLIENT_SECRET',
  },
  'providers.oidc.issuer': {
    desc: 'OIDC issuer url.',
    default: '',
    env: 'OAUTH_OIDC_ISSUER',
    validate: val => {
      if (!val) {
        return { success: true, data: val };
      }
      return z
        .string()
        .url()
        .regex(/^https?:\/\//, 'issuer must be a valid URL')
        .safeParse(val);
    },
  },
  'providers.oidc.args': {
    desc: 'Extra OIDC arguments (scope, claim mappings).',
    default: {},
    schema: {
      type: 'object',
      properties: {
        scope: { type: 'string' },
        claim_id: { type: 'string' },
        claim_email: { type: 'string' },
        claim_name: { type: 'string' },
      },
    },
    shape: z.object({
      scope: z.string().optional(),
      claim_id: z.string().optional(),
      claim_email: z.string().optional(),
      claim_name: z.string().optional(),
    }),
  },
});

// kept for anything still importing the flat JSONSchema shape elsewhere
export const OAuthProviderJSONSchema: JSONSchema = {
  type: 'object',
  properties: {
    clientId: { type: 'string' },
    clientSecret: { type: 'string' },
    args: { type: 'object' },
  },
};
