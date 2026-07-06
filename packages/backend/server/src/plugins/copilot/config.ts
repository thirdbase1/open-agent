import {
  defineModuleConfig,
  StorageJSONSchema,
  StorageProviderConfig,
} from '../../base';
import { CopilotPromptScenario } from './prompt/prompts';
import type { FalConfig } from './providers/fal';
import type { GatewayConfig } from './providers/gateway';
import { MorphConfig } from './providers/morph';
import { OracleConfig } from './providers/oracle';
import { OracleSchema } from './providers/types';
declare global {
  interface AppConfigSchema {
    copilot: {
      enabled: boolean;
      unsplash: ConfigItem<{
        key: string;
      }>;
      exa: ConfigItem<{
        key: string;
      }>;
      cloudsway: ConfigItem<{
        basePath: string;
        readEndpoint: string;
        searchEndpoint: string;
        accessKey: string;
      }>;
      e2b: ConfigItem<{
        key: string;
      }>;
      browserUse: ConfigItem<{
        key: string;
      }>;
      storage: ConfigItem<StorageProviderConfig>;
      scenarios: ConfigItem<CopilotPromptScenario>;
      providers: {
        // Phase 3 (Vercel-native migration): single Gateway config replaces
        // openai/gemini/geminiVertex/perplexity/anthropic/anthropicVertex.
        gateway: ConfigItem<GatewayConfig>;
        fal: ConfigItem<FalConfig>;
        morph: ConfigItem<MorphConfig>;
        oracle: ConfigItem<OracleConfig>;
      };
    };
  }
}

defineModuleConfig('copilot', {
  enabled: {
    desc: 'Whether to enable the copilot plugin.',
    default: false,
  },
  scenarios: {
    desc: 'Use custom models in scenarios and override default settings.',
    default: {
      override_enabled: false,
      scenarios: {
        audio_transcribing: 'gemini-2.5-flash',
        chat: 'claude-sonnet-4@20250514',
        embedding: 'gemini-embedding-001',
        image: 'gpt-image-1',
        rerank: 'gpt-4.1',
        coding: 'claude-sonnet-4@20250514',
        complex_text_generation: 'gpt-4o-2024-08-06',
        quick_decision_making: 'gpt-5-mini',
        quick_text_generation: 'gemini-2.5-flash',
        polish_and_summarize: 'gemini-2.5-flash',
      },
    },
  },
  'providers.gateway': {
    desc: 'The config for Vercel AI Gateway (replaces the previous separate openai/gemini/geminiVertex/perplexity/anthropic/anthropicVertex provider configs). Set AI_GATEWAY_API_KEY.',
    default: {
      apiKey: '',
      // Default prefix per ai-sdk.dev/providers/ai-sdk-providers/ai-gateway (verified, not
      // assumed): "https://ai-gateway.vercel.sh/v4/ai". Left here explicitly so it's easy to
      // override for self-hosted/BYOK setups without touching code.
      baseURL: 'https://ai-gateway.vercel.sh/v4/ai',
    },
    link: 'https://vercel.com/docs/ai-gateway',
  },
  'providers.fal': {
    desc: 'The config for the fal provider.',
    default: {
      apiKey: '',
    },
  },
  'providers.morph': {
    desc: 'The config for the morph provider.',
    default: {},
  },
  'providers.oracle': {
    desc: 'The config for the oracle provider.',
    default: {},
    schema: OracleSchema,
  },
  unsplash: {
    desc: 'The config for the unsplash key.',
    default: {
      key: '',
    },
  },
  exa: {
    desc: 'The config for the exa web search key.',
    default: {
      key: '',
    },
  },
  cloudsway: {
    desc: 'The config for the Cloudsway web search and reader.',
    default: {
      basePath: 'https://searchapi.cloudsway.net',
      readEndpoint: '',
      searchEndpoint: '',
      accessKey: '',
    },
  },
  browserUse: {
    desc: 'The config for the browser use key',
    default: {
      key: '',
    },
  },
  e2b: {
    desc: 'The config for the e2b key',
    default: {
      key: '',
    },
  },
  storage: {
    desc: 'The config for the storage provider.',
    default: {
      provider: 'fs',
      bucket: 'copilot',
      config: {
        path: '~/.open-agent/storage',
      },
    },
    schema: StorageJSONSchema,
  },
});
