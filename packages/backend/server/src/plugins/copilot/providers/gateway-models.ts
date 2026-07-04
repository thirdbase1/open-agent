import { Logger } from '@nestjs/common';

import {
  CopilotProviderModel,
  CopilotProviderType,
  ModelInputType,
  ModelOutputType,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// GatewayModelService — fetches models dynamically from the Vercel AI Gateway
// ═══════════════════════════════════════════════════════════════════════════
//
// The Vercel AI Gateway exposes a public REST endpoint that returns all 298+
// models across 31+ creators with pricing, context windows, and capabilities.
// No auth required — this works everywhere.
//
// Endpoint: https://ai-gateway.vercel.sh/v1/models
// Docs: https://vercel.com/docs/ai-gateway/models-and-providers
//       https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway

const GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface GatewayModel {
  id: string;
  object: string;
  created: number;
  released: number;
  owned_by: string;
  name: string;
  description: string;
  context_window: number;
  max_tokens: number;
  type: string; // 'language' | 'image' | 'video' | 'embedding' | 'reranking' | 'speech' | 'transcription' | 'realtime'
  tags: string[];
  pricing: {
    input: string;
    output: string;
  };
}

interface GatewayModelsResponse {
  object: string;
  data: GatewayModel[];
}

// Map gateway creator names to CopilotProviderType
const CREATOR_TO_PROVIDER: Record<string, CopilotProviderType> = {
  anthropic: CopilotProviderType.Anthropic,
  openai: CopilotProviderType.OpenAI,
  google: CopilotProviderType.Gemini,
  perplexity: CopilotProviderType.Perplexity,
  morph: CopilotProviderType.Morph,
};

// Map gateway model types to our ModelInputType / ModelOutputType
function gatewayTypeToCapabilities(model: GatewayModel): {
  input: ModelInputType[];
  output: ModelOutputType[];
} {
  const tags = model.tags || [];

  switch (model.type) {
    case 'language': {
      const input: ModelInputType[] = [ModelInputType.Text];
      if (tags.includes('vision') || tags.includes('file-input')) {
        input.push(ModelInputType.Image);
      }
      if (tags.includes('audio')) {
        input.push(ModelInputType.Audio);
      }
      const output: ModelOutputType[] = [
        ModelOutputType.Text,
        ModelOutputType.Object,
      ];
      return { input, output };
    }
    case 'image':
      return { input: [ModelInputType.Text], output: [ModelOutputType.Image] };
    case 'embedding':
      return {
        input: [ModelInputType.Text],
        output: [ModelOutputType.Embedding],
      };
    case 'reranking':
      return {
        input: [ModelInputType.Text],
        output: [ModelOutputType.Structured],
      };
    case 'speech':
      return {
        input: [ModelInputType.Text],
        output: [ModelOutputType.Structured],
      };
    case 'transcription':
      return { input: [ModelInputType.Audio], output: [ModelOutputType.Text] };
    case 'realtime':
      return {
        input: [ModelInputType.Text, ModelInputType.Audio],
        output: [ModelOutputType.Text],
      };
    case 'video':
      return {
        input: [ModelInputType.Text, ModelInputType.Image],
        output: [ModelOutputType.Structured],
      };
    default:
      return { input: [ModelInputType.Text], output: [ModelOutputType.Text] };
  }
}

class GatewayModelService {
  private readonly logger = new Logger('GatewayModelService');
  private cache: GatewayModel[] | null = null;
  private cacheTime = 0;
  private fetchPromise: Promise<GatewayModel[]> | null = null;

  async getModels(): Promise<GatewayModel[]> {
    // Return cached if fresh
    if (this.cache && Date.now() - this.cacheTime < CACHE_TTL_MS) {
      return this.cache;
    }

    // Deduplicate concurrent fetches
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = this.fetchModels();
    try {
      const models = await this.fetchPromise;
      this.cache = models;
      this.cacheTime = Date.now();
      return models;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async fetchModels(): Promise<GatewayModel[]> {
    try {
      const res = await fetch(GATEWAY_MODELS_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new Error(`Gateway models API returned ${res.status}`);
      }
      const data = (await res.json()) as GatewayModelsResponse;
      this.logger.log(
        `Fetched ${data.data.length} models from Vercel AI Gateway`
      );
      return data.data;
    } catch (err) {
      this.logger.error('Failed to fetch models from AI Gateway', err);
      // Return cached if available even if stale
      if (this.cache) return this.cache;
      return [];
    }
  }

  /**
   * Get models for a specific provider type (e.g. Anthropic, OpenAI, Gemini).
   * Returns CopilotProviderModel[] with capabilities mapped from gateway tags.
   */
  async getModelsForProvider(
    providerType: CopilotProviderType
  ): Promise<CopilotProviderModel[]> {
    const allModels = await this.getModels();
    const creatorName = this.getCreatorName(providerType);
    if (!creatorName) return [];

    return allModels
      .filter(m => m.owned_by === creatorName)
      .map(m => {
        const caps = gatewayTypeToCapabilities(m);
        return {
          id: m.id.replace(`${creatorName}/`, ''), // strip provider prefix for internal use
          capabilities: [
            {
              input: caps.input,
              output: caps.output,
              // Mark the first text model as default
              defaultForOutputType: false,
            },
          ],
        };
      });
  }

  /**
   * Get ALL models from all providers, grouped by provider type.
   */
  async getAllModels(): Promise<
    Array<{
      provider: CopilotProviderType;
      modelId: string;
      capabilities: Array<{ input: string[]; output: string[] }>;
    }>
  > {
    const allModels = await this.getModels();
    const result: Array<{
      provider: CopilotProviderType;
      modelId: string;
      capabilities: Array<{ input: string[]; output: string[] }>;
    }> = [];

    for (const model of allModels) {
      const providerType = CREATOR_TO_PROVIDER[model.owned_by];
      if (!providerType) continue; // skip providers we don't support yet

      const caps = gatewayTypeToCapabilities(model);
      result.push({
        provider: providerType,
        modelId: model.id, // full gateway format: creator/model-name
        capabilities: [
          {
            input: caps.input.map(t => t as string),
            output: caps.output.map(t => t as string),
          },
        ],
      });
    }

    return result;
  }

  /**
   * Get the full gateway model ID (creator/model-name) for a given provider + model.
   */
  getGatewayModelId(
    providerType: CopilotProviderType,
    modelId: string
  ): string {
    const creator = this.getCreatorName(providerType);
    if (!creator) return modelId;
    // If already in creator/model format, return as-is
    if (modelId.includes('/')) return modelId;
    return `${creator}/${modelId}`;
  }

  private getCreatorName(providerType: CopilotProviderType): string | null {
    for (const [creator, type] of Object.entries(CREATOR_TO_PROVIDER)) {
      if (type === providerType) return creator;
    }
    return null;
  }

  /**
   * Get text-generating models only (for chat UI model picker).
   */
  async getTextModels(): Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      contextWindow: number;
      tags: string[];
    }>
  > {
    const allModels = await this.getModels();
    return allModels
      .filter(m => m.type === 'language')
      .map(m => ({
        id: m.id,
        name: m.name,
        provider: m.owned_by,
        contextWindow: m.context_window,
        tags: m.tags || [],
      }));
  }

  /**
   * Get image-generating models only.
   */
  async getImageModels(): Promise<
    Array<{ id: string; name: string; provider: string }>
  > {
    const allModels = await this.getModels();
    return allModels
      .filter(m => m.type === 'image')
      .map(m => ({ id: m.id, name: m.name, provider: m.owned_by }));
  }

  /**
   * Get video-generating models only.
   */
  async getVideoModels(): Promise<
    Array<{ id: string; name: string; provider: string }>
  > {
    const allModels = await this.getModels();
    return allModels
      .filter(m => m.type === 'video')
      .map(m => ({ id: m.id, name: m.name, provider: m.owned_by }));
  }

  /**
   * Get speech (TTS) models only.
   */
  async getSpeechModels(): Promise<
    Array<{ id: string; name: string; provider: string }>
  > {
    const allModels = await this.getModels();
    return allModels
      .filter(m => m.type === 'speech')
      .map(m => ({ id: m.id, name: m.name, provider: m.owned_by }));
  }
}

// Singleton
export const gatewayModelService = new GatewayModelService();
export { GatewayModelService };
