import { z } from 'zod';

import {
  defineModuleConfig,
  StorageJSONSchema,
  StorageProviderConfig,
} from '../../base';
import { CopilotPromptScenario } from './prompt/prompts';
import {
  AnthropicOfficialConfig,
  AnthropicVertexConfig,
} from './providers/anthropic';
import type { FalConfig } from './providers/fal';
import { GeminiGenerativeConfig, GeminiVertexConfig } from './providers/gemini';
import { MorphConfig } from './providers/morph';
import { OpenAIConfig } from './providers/openai';
import { OracleConfig } from './providers/oracle';
import { PerplexityConfig } from './providers/perplexity';
import { OracleSchema, VertexSchema } from './providers/types';
declare global {
  interface AppConfigSchema {
    copilot: {
      enabled: boolean;
      unsplash: { key: string };
      exa: { key: string };
      cloudsway: {
        basePath: string;
        readEndpoint: string;
        searchEndpoint: string;
        accessKey: string;
      };
      e2b: { key: string };
      browserUse: { key: string };
      storage: ConfigItem<StorageProviderConfig>;
      scenarios: ConfigItem<CopilotPromptScenario>;
      // openai/fal/gemini/perplexity/anthropic/morph are plain nested
      // objects (not `ConfigItem<T>`) so each field is its own leaf config
      // path and apiKey can carry an `env` binding — same pattern as
      // mailer's `SMTP.host`. geminiVertex/anthropicVertex/oracle use GCP
      // service-account/OCI credentials rather than a single api key, left
      // as opaque ConfigItem objects (unchanged, out of scope here).
      providers: {
        openai: OpenAIConfig;
        fal: FalConfig;
        gemini: GeminiGenerativeConfig;
        geminiVertex: ConfigItem<GeminiVertexConfig>;
        perplexity: PerplexityConfig;
        anthropic: AnthropicOfficialConfig;
        anthropicVertex: ConfigItem<AnthropicVertexConfig>;
        morph: MorphConfig;
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
  'providers.openai.apiKey': {
    desc: 'API key for the openai provider.',
    default: '',
    env: 'OPENAI_API_KEY',
    link: 'https://github.com/openai/openai-node',
  },
  'providers.openai.baseURL': {
    desc: 'Base URL for the openai provider.',
    default: 'https://api.openai.com/v1',
  },
  'providers.openai.oldApiStyle': {
    desc: 'Whether to use the legacy (pre-Responses) OpenAI API style.',
    default: false,
  },
  'providers.openai.useGateway': {
    desc: 'Whether to route openai calls through Vercel AI Gateway.',
    default: true,
  },
  'providers.fal.apiKey': {
    desc: 'API key for the fal provider.',
    default: '',
    env: 'FAL_API_KEY',
  },
  'providers.gemini.apiKey': {
    desc: 'API key for the gemini provider.',
    default: '',
    env: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  'providers.gemini.baseURL': {
    desc: 'Base URL for the gemini provider.',
    default: 'https://generativelanguage.googleapis.com/v1beta',
  },
  'providers.gemini.useGateway': {
    desc: 'Whether to route gemini calls through Vercel AI Gateway.',
    default: true,
  },
  'providers.geminiVertex': {
    desc: 'The config for the gemini provider in Google Vertex AI.',
    default: {},
    schema: VertexSchema,
  },
  'providers.perplexity.apiKey': {
    desc: 'API key for the perplexity provider.',
    default: '',
    env: 'PERPLEXITY_API_KEY',
  },
  'providers.perplexity.endpoint': {
    desc: 'Custom base URL for the perplexity provider (only used when useGateway is false).',
    default: undefined,
    shape: z.string().optional(),
  },
  'providers.perplexity.useGateway': {
    desc: 'Whether to route perplexity calls through Vercel AI Gateway.',
    default: true,
  },
  'providers.anthropic.apiKey': {
    desc: 'API key for the anthropic provider.',
    default: '',
    env: 'ANTHROPIC_API_KEY',
  },
  'providers.anthropic.baseURL': {
    desc: 'Base URL for the anthropic provider.',
    default: 'https://api.anthropic.com/v1',
  },
  'providers.anthropic.useGateway': {
    desc: 'Whether to route anthropic calls through Vercel AI Gateway.',
    default: true,
  },
  'providers.anthropicVertex': {
    desc: 'The config for the anthropic provider in Google Vertex AI.',
    default: {},
    schema: VertexSchema,
  },
  'providers.morph.apiKey': {
    desc: 'API key for the morph provider.',
    default: '',
    env: 'MORPH_API_KEY',
  },
  'providers.oracle': {
    desc: 'The config for the oracle provider.',
    default: {},
    schema: OracleSchema,
  },
  'unsplash.key': {
    desc: 'API key for Unsplash image search.',
    default: '',
    env: 'UNSPLASH_ACCESS_KEY',
  },
  'exa.key': {
    desc: 'API key for Exa web search.',
    default: '',
    env: 'EXA_API_KEY',
  },
  'cloudsway.basePath': {
    desc: 'Base path for the Cloudsway web search and reader API.',
    default: 'https://searchapi.cloudsway.net',
  },
  'cloudsway.readEndpoint': {
    desc: 'Read endpoint for Cloudsway.',
    default: '',
    env: 'CLOUDSWAY_READ_ENDPOINT',
  },
  'cloudsway.searchEndpoint': {
    desc: 'Search endpoint for Cloudsway.',
    default: '',
    env: 'CLOUDSWAY_SEARCH_ENDPOINT',
  },
  'cloudsway.accessKey': {
    desc: 'Access key for Cloudsway.',
    default: '',
    env: 'CLOUDSWAY_ACCESS_KEY',
  },
  'browserUse.key': {
    desc: 'API key for browser-use.com (used by the browser-use agent tool).',
    default: '',
    env: 'BROWSER_USE_API_KEY',
  },
  'e2b.key': {
    desc: 'API key for the E2B sandbox tool.',
    default: '',
    env: 'E2B_API_KEY',
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
