import {
  createPerplexity,
  type PerplexityProvider as VercelPerplexityProvider,
} from '@ai-sdk/perplexity';
import { generateText, streamText } from 'ai';
import { z } from 'zod';

import { CopilotProviderSideError, metrics } from '../../../base';
import { CopilotProvider } from './provider';
import {
  CopilotChatOptions,
  CopilotProviderModel,
  CopilotProviderType,
  ModelConditions,
  ModelOutputType,
  PromptMessage,
} from './types';
import { chatToGPTMessage, CitationParser } from './utils';

export type PerplexityConfig = {
  apiKey: string;
  endpoint?: string;
  useGateway?: boolean;
};

const DEFAULT_VERCEL_AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1';

const PerplexityErrorSchema = z.union([
  z.object({
    detail: z.array(
      z.object({
        loc: z.array(z.string()),
        msg: z.string(),
        type: z.string(),
      })
    ),
  }),
  z.object({
    error: z.object({
      message: z.string(),
      type: z.string(),
      code: z.number(),
    }),
  }),
]);

type PerplexityError = z.infer<typeof PerplexityErrorSchema>;

export class PerplexityProvider extends CopilotProvider<PerplexityConfig> {
  readonly type = CopilotProviderType.Perplexity;

  // Models fetched dynamically from Vercel AI Gateway
  private _models: CopilotProviderModel[] = [];
  override get models(): CopilotProviderModel[] {
    return this._models;
  }

  override async refreshOnlineModels() {
    try {
      const { gatewayModelService } = await import('./gateway-models');
      this._models = await gatewayModelService.getModelsForProvider(
        CopilotProviderType.Perplexity
      );
      this.onlineModelList = this._models.map(m => m.id);
      if (this._models.length > 0) {
        this._models[0].capabilities[0].defaultForOutputType = true;
        this.logger.log(
          `Loaded ${this._models.length} Perplexity models from AI Gateway`
        );
      }
    } catch (e) {
      this.logger.error('Failed to fetch Perplexity models from AI Gateway', e);
    }
  }

  #instance!: VercelPerplexityProvider;

  override configured(): boolean {
    return this.config.useGateway || !!this.config.apiKey;
  }

  protected override setup() {
    super.setup();
    this.#instance = createPerplexity({
      apiKey: this.config.apiKey,
      baseURL: this.getBaseURL(),
    });
  }

  private getBaseURL() {
    if (this.config.useGateway) {
      return DEFAULT_VERCEL_AI_GATEWAY_URL;
    }
    return this.config.endpoint;
  }

  private getLanguageModel(model: string) {
    return this.config.useGateway
      ? `perplexity/${model}`
      : this.#instance(model);
  }

  async text(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotChatOptions = {}
  ): Promise<string> {
    const fullCond = { ...cond, outputType: ModelOutputType.Text };
    await this.checkParams({ cond: fullCond, messages, options });
    const model = this.selectModel(fullCond);

    try {
      metrics.ai.counter('chat_text_calls').add(1, { model: model.id });

      const [system, msgs] = await chatToGPTMessage(messages, false);

      const modelInstance = this.getLanguageModel(model.id);

      const { text, sources } = await generateText({
        model: modelInstance,
        system,
        messages: msgs,
        temperature: options.temperature ?? 0,
        maxOutputTokens: options.maxTokens ?? 4096,
        abortSignal: options.signal,
      });

      const parser = new CitationParser();
      for (const source of sources.filter(s => s.sourceType === 'url')) {
        parser.push(source.url);
      }

      let result = text.replaceAll(/<\/?think>\n/g, '\n---\n');
      result = parser.parse(result);
      result += parser.end();
      return result;
    } catch (e: any) {
      metrics.ai.counter('chat_text_errors').add(1, { model: model.id });
      throw this.handleError(e);
    }
  }

  async *streamText(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotChatOptions = {}
  ): AsyncIterable<string> {
    const fullCond = { ...cond, outputType: ModelOutputType.Text };
    await this.checkParams({ cond: fullCond, messages, options });
    const model = this.selectModel(fullCond);

    try {
      metrics.ai.counter('chat_text_stream_calls').add(1, { model: model.id });

      const [system, msgs] = await chatToGPTMessage(messages, false);

      const modelInstance = this.getLanguageModel(model.id);

      const stream = streamText({
        model: modelInstance,
        system,
        messages: msgs,
        temperature: options.temperature ?? 0,
        maxOutputTokens: options.maxTokens ?? 4096,
        abortSignal: options.signal,
      });

      const parser = new CitationParser();
      for await (const chunk of stream.stream) {
        switch (chunk.type) {
          case 'source': {
            if (chunk.sourceType === 'url') {
              parser.push(chunk.url);
            }
            break;
          }
          case 'text-delta': {
            const text = chunk.text.replaceAll(/<\/?think>\n?/g, '\n---\n');
            const result = parser.parse(text);
            yield result;
            break;
          }
          case 'finish-step': {
            const result = parser.end();
            yield result;
            break;
          }
          case 'error': {
            const json =
              typeof chunk.error === 'string'
                ? JSON.parse(chunk.error)
                : chunk.error;
            if (json && typeof json === 'object') {
              const data = PerplexityErrorSchema.parse(json);
              if ('detail' in data || 'error' in data) {
                throw this.convertError(data);
              }
            }
          }
        }
      }
    } catch (e) {
      metrics.ai.counter('chat_text_stream_errors').add(1, { model: model.id });
      throw e;
    }
  }

  private convertError(e: PerplexityError) {
    function getErrMessage(e: PerplexityError) {
      let err = 'Unexpected perplexity response';
      if ('detail' in e) {
        err = e.detail[0].msg || err;
      } else if ('error' in e) {
        err = e.error.message || err;
      }
      return err;
    }

    throw new CopilotProviderSideError({
      provider: this.type,
      kind: 'unexpected_response',
      message: getErrMessage(e),
    });
  }

  private handleError(e: any) {
    if (e instanceof CopilotProviderSideError) {
      return e;
    }
    return new CopilotProviderSideError({
      provider: this.type,
      kind: 'unexpected_response',
      message: e?.message || 'Unexpected perplexity response',
    });
  }
}
