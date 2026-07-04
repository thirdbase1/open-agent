import {
  type AnthropicProvider as AnthropicSDKProvider,
  createAnthropic,
} from '@ai-sdk/anthropic';
import {
  CopilotProviderModel,
  CopilotProviderType,
  ModelOutputType,
} from '../types';
import { AnthropicProvider } from './anthropic';

export type AnthropicOfficialConfig = {
  apiKey: string;
  baseURL?: string;
  useGateway?: boolean;
};

const DEFAULT_VERCEL_AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1';

export class AnthropicOfficialProvider extends AnthropicProvider<AnthropicOfficialConfig> {
  override readonly type = CopilotProviderType.Anthropic;

  // Models are fetched dynamically from the Vercel AI Gateway.
  // No hardcoded model IDs — the gateway provides all available models.
  private _models: CopilotProviderModel[] = [];
  override get models(): CopilotProviderModel[] {
    return this._models;
  }

  override async refreshOnlineModels() {
    try {
      const { gatewayModelService } = await import('../gateway-models');
      this._models = await gatewayModelService.getModelsForProvider(
        CopilotProviderType.Anthropic
      );
      this.onlineModelList = this._models.map(m => m.id);
      if (this._models.length > 0) {
        // Mark first text model as default
        const textModel = this._models.find(m =>
          m.capabilities.some(c => c.output.includes(ModelOutputType.Text))
        );
        if (textModel) {
          textModel.capabilities[0].defaultForOutputType = true;
        }
        this.logger.log(`Loaded ${this._models.length} models from AI Gateway`);
      }
    } catch (e) {
      this.logger.error('Failed to fetch models from AI Gateway', e);
    }
  }

  protected instance!: AnthropicSDKProvider;

  override configured(): boolean {
    return this.config.useGateway || !!this.config.apiKey;
  }

  override setup() {
    super.setup();
    this.instance = createAnthropic({
      apiKey: this.config.apiKey,
      baseURL: this.getBaseURL(),
    });
  }

  protected override isGatewayEnabled() {
    return !!this.config.useGateway;
  }

  /**
   * Vercel AI Gateway is used by passing provider-prefixed model strings
   * directly to AI SDK 7. Authentication is automatic from AI_GATEWAY_API_KEY
   * or Vercel OIDC tokens in Vercel deployments.
   */
  protected override getGatewayModel(model: string) {
    return `anthropic/${model}`;
  }

  private getBaseURL() {
    if (this.config.useGateway) {
      return DEFAULT_VERCEL_AI_GATEWAY_URL;
    }
    return this.config.baseURL;
  }
}
