import { Injectable, Logger } from '@nestjs/common';

import { ServerFeature, ServerService } from '../../../core';
import { gatewayModelService } from './gateway-models';
import type { CopilotProvider } from './provider';
import { CopilotProviderType, ModelFullConditions } from './types';

@Injectable()
export class CopilotProviderFactory {
  constructor(private readonly server: ServerService) {}

  private readonly logger = new Logger(CopilotProviderFactory.name);

  readonly #providers = new Map<CopilotProviderType, CopilotProvider>();

  async getProvider(
    cond: ModelFullConditions,
    filter: {
      prefer?: CopilotProviderType;
    } = {}
  ): Promise<CopilotProvider | null> {
    this.logger.debug(
      `Resolving copilot provider for output type: ${cond.outputType}`
    );
    let candidate: CopilotProvider | null = null;
    for (const [type, provider] of this.#providers.entries()) {
      if (filter.prefer && filter.prefer !== type) {
        continue;
      }

      const isMatched = await provider.match(cond);

      if (isMatched) {
        candidate = provider;
        this.logger.debug(`Copilot provider candidate found: ${type}`);
        break;
      }
    }

    return candidate;
  }

  async getProviderByModel(
    modelId: string,
    filter: {
      prefer?: CopilotProviderType;
    } = {}
  ): Promise<CopilotProvider | null> {
    this.logger.debug(`Resolving copilot provider for model: ${modelId}`);

    let candidate: CopilotProvider | null = null;
    for (const [type, provider] of this.#providers.entries()) {
      if (filter.prefer && filter.prefer !== type) {
        continue;
      }

      if (await provider.match({ modelId })) {
        candidate = provider;
        this.logger.debug(`Copilot provider candidate found: ${type}`);
      }
    }

    return candidate;
  }

  register(provider: CopilotProvider) {
    this.#providers.set(provider.type, provider);
    this.logger.log(`Copilot provider [${provider.type}] registered.`);
    this.server.enableFeature(ServerFeature.Copilot);
  }

  /**
   * List all available models from the Vercel AI Gateway.
   * Models are fetched dynamically from https://ai-gateway.vercel.sh/v1/models
   * and cached for 5 minutes. No hardcoded model IDs.
   */
  async listAllModels(): Promise<
    Array<{
      provider: CopilotProviderType;
      modelId: string;
      capabilities: Array<{ input: string[]; output: string[] }>;
    }>
  > {
    // Try fetching from the gateway first
    const gatewayModels = await gatewayModelService.getAllModels();
    if (gatewayModels.length > 0) {
      return gatewayModels;
    }

    // Fallback to provider-registered models if gateway is unreachable
    this.logger.warn(
      'Gateway models unavailable, falling back to provider models'
    );
    const models: Array<{
      provider: CopilotProviderType;
      modelId: string;
      capabilities: Array<{ input: string[]; output: string[] }>;
    }> = [];
    for (const [type, provider] of this.#providers.entries()) {
      for (const model of provider.models) {
        models.push({
          provider: type,
          modelId: model.id,
          capabilities: model.capabilities.map(c => ({
            input: c.input,
            output: c.output,
          })),
        });
      }
    }
    return models;
  }

  unregister(provider: CopilotProvider) {
    this.#providers.delete(provider.type);
    this.logger.log(`Copilot provider [${provider.type}] unregistered.`);
    if (this.#providers.size === 0) {
      this.server.disableFeature(ServerFeature.Copilot);
    }
  }
}
