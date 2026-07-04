import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from '@ai-sdk/google';

import {
  CopilotProviderModel,
  CopilotProviderType,
  ModelOutputType,
} from '../types';
import { GeminiProvider } from './gemini';

export type GeminiGenerativeConfig = {
  apiKey: string;
  baseURL?: string;
  useGateway?: boolean;
};

const DEFAULT_VERCEL_AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1';

export class GeminiGenerativeProvider extends GeminiProvider<GeminiGenerativeConfig> {
  override readonly type = CopilotProviderType.Gemini;

  // Models are fetched dynamically from the Vercel AI Gateway.
  private _models: CopilotProviderModel[] = [];
  override get models(): CopilotProviderModel[] {
    return this._models;
  }

  protected instance!: GoogleGenerativeAIProvider;

  override configured(): boolean {
    return this.config.useGateway || !!this.config.apiKey;
  }

  protected override setup() {
    super.setup();
    this.instance = createGoogleGenerativeAI({
      apiKey: this.config.apiKey,
      baseURL: this.getBaseURL(),
    });
  }

  protected override isGatewayEnabled() {
    return !!this.config.useGateway;
  }

  protected override getGatewayModel(model: string) {
    return `google/${model}`;
  }

  private getBaseURL() {
    if (this.config.useGateway) {
      return DEFAULT_VERCEL_AI_GATEWAY_URL;
    }
    return this.config.baseURL;
  }

  override async refreshOnlineModels() {
    try {
      const { gatewayModelService } = await import('../gateway-models');
      this._models = await gatewayModelService.getModelsForProvider(
        CopilotProviderType.Gemini
      );
      this.onlineModelList = this._models.map(m => m.id);
      if (this._models.length > 0) {
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
}
