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
        openai: ConfigItem<OpenAIConfig>;
        fal: ConfigItem<FalConfig>;
        gemini: ConfigItem<GeminiGenerativeConfig>;
        geminiVertex: ConfigItem<GeminiVertexConfig>;
        perplexity: ConfigItem<PerplexityConfig>;
        anthropic: ConfigItem<AnthropicOfficialConfig>;
        anthropicVertex: ConfigItem<AnthropicVertexConfig>;
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
  'providers.openai': {
    desc: 'The config for the openai provider.',
    default: {
      apiKey: '',
      baseURL: 'https://api.openai.com/v1',
      useGateway: true,
    },
    link: 'https://github.com/openai/openai-node',
  },
  'providers.fal': {
    desc: 'The config for the fal provider.',
    default: {
      apiKey: '',
    },
  },
  'providers.gemini': {
    desc: 'The config for the gemini provider.',
    default: {
      apiKey: '',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      useGateway: true,
    },
  },
  'providers.geminiVertex': {
    desc: 'The config for the gemini provider in Google Vertex AI.',
    default: {},
    schema: VertexSchema,
  },
  'providers.perplexity': {
    desc: 'The config for the perplexity provider.',
    default: {
      apiKey: '',
      useGateway: true,
    },
  },
  'providers.anthropic': {
    desc: 'The config for the anthropic provider.',
    default: {
      apiKey: '',
      baseURL: 'https://api.anthropic.com/v1',
      useGateway: true,
    },
  },
  'providers.anthropicVertex': {
    desc: 'The config for the anthropic provider in Google Vertex AI.',
    default: {},
    schema: VertexSchema,
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
