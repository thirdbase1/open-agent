import { z } from 'zod';

import {
  defineModuleConfig,
  StorageJSONSchema,
  StorageProviderConfig,
} from '../../base';
import { CopilotPromptScenario } from './prompt/prompts';
import {
  AnthropicOfficialConfig,
} from './providers/anthropic';
import { GeminiGenerativeConfig } from './providers/gemini';
import { MorphConfig } from './providers/morph';
import { OpenAIConfig } from './providers/openai';
import { PerplexityConfig } from './providers/perplexity';
declare global {
  interface AppConfigSchema {
    copilot: {
      enabled: boolean;
      unsplash: { key: string };
      pexels: { key: string };
      parallel: { key: string };
      firecrawl: { key: string };
      agentBrowser: { command: string };
      storage: ConfigItem<StorageProviderConfig>;
      scenarios: ConfigItem<CopilotPromptScenario>;
      providers: {
        openai: OpenAIConfig;
        gemini: GeminiGenerativeConfig;
        perplexity: PerplexityConfig;
        anthropic: AnthropicOfficialConfig;
        morph: MorphConfig;
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
  'providers.morph.apiKey': {
    desc: 'API key for the morph provider (not needed when useGateway=true).',
    default: '',
    env: 'MORPH_API_KEY',
  },
  'providers.morph.useGateway': {
    desc: 'Whether to route morph calls through Vercel AI Gateway.',
    default: true,
  },
  'unsplash.key': {
    desc: 'API key for Unsplash image search.',
    default: '',
    env: 'UNSPLASH_ACCESS_KEY',
  },
  'pexels.key': {
    desc: 'API key for Pexels image search.',
    default: '',
    env: 'PEXELS_API_KEY',
  },
  'parallel.key': {
    desc: 'API key for Parallel web search and extract.',
    default: '',
    env: 'PARALLEL_API_KEY',
  },
  'firecrawl.key': {
    desc: 'API key for Firecrawl crawling and extraction.',
    default: '',
    env: 'FIRECRAWL_API_KEY',
  },
  'agentBrowser.command': {
    desc: 'Command to invoke agent-browser CLI (used as fallback; primary path is Vercel Sandbox).',
    default: 'agent-browser',
    env: 'AGENT_BROWSER_COMMAND',
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