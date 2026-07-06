import { createGateway, type GatewayModelId } from '@ai-sdk/gateway';
import {
  AISDKError,
  embedMany,
  experimental_generateImage as generateImage,
  generateObject,
  generateText,
  stepCountIs,
  streamText,
} from 'ai';

import {
  CopilotPromptInvalid,
  CopilotProviderSideError,
  metrics,
  UserFriendlyError,
} from '../../../base';
import { CopilotProvider } from './provider';
import { TokenTracker } from './token-tracker';
import type {
  CopilotChatOptions,
  CopilotEmbeddingOptions,
  CopilotImageOptions,
  CopilotProviderModel,
  CopilotStructuredOptions,
  ModelConditions,
  PromptMessage,
  StreamObject,
} from './types';
import { CopilotProviderType, ModelInputType, ModelOutputType } from './types';
import {
  chatToGPTMessage,
  CitationParser,
  StreamObjectParser,
  TextStreamParser,
} from './utils';

export const DEFAULT_DIMENSIONS = 256;

export type GatewayConfig = {
  apiKey: string;
  baseURL?: string;
};

/**
 * GatewayProvider replaces the previous per-vendor CopilotProvider implementations
 * (openai.ts, anthropic/*, gemini/*, perplexity.ts) with a single provider that routes
 * every call through Vercel AI Gateway.
 *
 * Verified against ai-sdk.dev/providers/ai-sdk-providers/ai-gateway (fetched directly, not
 * assumed):
 *  - Model addressing is a plain string in `creator/model-name` format (e.g. `openai/gpt-5.4`,
 *    `anthropic/claude-sonnet-4.6`). The SDK auto-routes through Gateway for any such string.
 *  - `createGateway({ apiKey })` returns a callable provider: `gateway(modelId)` is a drop-in
 *    LanguageModel for generateText/streamText/generateObject - same call sites as before,
 *    only the model-construction line changes.
 *  - `gateway.textEmbeddingModel(id)` / `gateway.imageModel(id)` cover embedding + image
 *    generation the same way `openai.embedding(id)` / `openai.image(id)` did per-vendor.
 *  - `gateway.getAvailableModels()` is a documented dynamic-discovery API, replacing each old
 *    provider's bespoke `/models` REST polling.
 *  - Confirmed via `@ai-sdk/gateway` changelog (github.com/vercel/ai) that `GatewayModelId` is
 *    an exported type used to type LanguageModel calls - used below for `this.model(id)`.
 *
 * Deliberately NOT folded into this class (left as separate, unchanged provider files):
 *  - `morph.ts` (fast-apply doc editing) and `fal.ts` (FAL-specific image models) call
 *    vendor-specific REST APIs that are not LLM completion calls - Gateway doesn't proxy those.
 *  - `oracle.ts` (OCI GenAI) - kept pending explicit confirmation it can be retired too, since
 *    it may serve BYOK/OCI-billing customers who need to stay off Gateway.
 */
export class GatewayProvider extends CopilotProvider<GatewayConfig> {
  readonly type = CopilotProviderType.Gateway;

  // Gateway-qualified model ids. Capability tags mirror what the old per-vendor files declared
  // for the same upstream model, so existing prompt configs referencing these ids keep working.
  readonly models: CopilotProviderModel[] = [
    {
      id: 'openai/gpt-5.4',
      capabilities: [
        {
          input: [ModelInputType.Text, ModelInputType.Image],
          output: [
            ModelOutputType.Text,
            ModelOutputType.Object,
            ModelOutputType.Structured,
          ],
          defaultForOutputType: true,
        },
      ],
    },
    {
      id: 'openai/gpt-5.4-mini',
      capabilities: [
        {
          input: [ModelInputType.Text, ModelInputType.Image],
          output: [
            ModelOutputType.Text,
            ModelOutputType.Object,
            ModelOutputType.Structured,
          ],
        },
      ],
    },
    {
      id: 'anthropic/claude-sonnet-4.6',
      capabilities: [
        {
          input: [ModelInputType.Text, ModelInputType.Image],
          output: [
            ModelOutputType.Text,
            ModelOutputType.Object,
            ModelOutputType.Structured,
          ],
        },
      ],
    },
    {
      id: 'anthropic/claude-opus-4.8',
      capabilities: [
        {
          input: [ModelInputType.Text, ModelInputType.Image],
          output: [ModelOutputType.Text, ModelOutputType.Object],
        },
      ],
    },
    {
      id: 'google/gemini-3-pro',
      capabilities: [
        {
          input: [
            ModelInputType.Text,
            ModelInputType.Image,
            ModelInputType.Audio,
          ],
          output: [ModelOutputType.Text, ModelOutputType.Object],
        },
      ],
    },
    {
      id: 'google/gemini-3-flash',
      capabilities: [
        {
          input: [
            ModelInputType.Text,
            ModelInputType.Image,
            ModelInputType.Audio,
          ],
          output: [ModelOutputType.Text, ModelOutputType.Object],
        },
      ],
    },
    {
      id: 'perplexity/sonar-pro',
      capabilities: [
        { input: [ModelInputType.Text], output: [ModelOutputType.Text] },
      ],
    },
    {
      id: 'xai/grok-4',
      capabilities: [
        { input: [ModelInputType.Text], output: [ModelOutputType.Text] },
      ],
    },
    {
      id: 'openai/text-embedding-3-large',
      capabilities: [
        {
          input: [ModelInputType.Text],
          output: [ModelOutputType.Embedding],
          defaultForOutputType: true,
        },
      ],
    },
    {
      id: 'openai/gpt-image-1',
      capabilities: [
        {
          input: [ModelInputType.Text, ModelInputType.Image],
          output: [ModelOutputType.Image],
          defaultForOutputType: true,
        },
      ],
    },
  ];

  #gateway!: ReturnType<typeof createGateway>;

  override configured(): boolean {
    return !!this.config.apiKey;
  }

  protected override setup() {
    super.setup();
    this.#gateway = createGateway({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
    });
  }

  private handleError(
    e: any,
    model: string,
    options: CopilotImageOptions = {}
  ) {
    if (e instanceof UserFriendlyError) {
      return e;
    } else if (e instanceof AISDKError) {
      if (e.message.includes('safety') || e.message.includes('risk')) {
        metrics.ai
          .counter('chat_text_risk_errors')
          .add(1, { model, user: options.user || undefined });
      }
      return new CopilotProviderSideError({
        provider: this.type,
        kind: e.name || 'unknown',
        message: e.message,
      });
    }
    return new CopilotProviderSideError({
      provider: this.type,
      kind: 'unexpected_response',
      message: e?.message || 'Unexpected AI Gateway response',
    });
  }

  override async refreshOnlineModels() {
    try {
      if (this.config.apiKey && !this.onlineModelList.length) {
        const { models } = await this.#gateway.getAvailableModels();
        this.onlineModelList = models.map(m => m.id);
      }
    } catch (e) {
      this.logger.error('Failed to fetch available Gateway models', e);
    }
  }

  private model(id: string) {
    return this.#gateway(id as GatewayModelId);
  }

  async text(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotChatOptions = {}
  ): Promise<string> {
    const fullCond = { ...cond, outputType: ModelOutputType.Text };
    await this.checkParams({ messages, cond: fullCond, options });
    const model = this.selectModel(fullCond);

    try {
      metrics.ai.counter('chat_text_calls').add(1, { model: model.id });

      const { text } = await TokenTracker.trackAICall(model.id, async () => {
        const [system, msgs] = await chatToGPTMessage(messages);
        const { tools } = await this.getTools(options, model.id);
        return await generateText({
          model: this.model(model.id),
          system,
          messages: msgs,
          temperature: options.temperature ?? 0,
          maxOutputTokens: options.maxTokens ?? 4096,
          tools,
          stopWhen: stepCountIs(this.MAX_STEPS),
          abortSignal: options.signal,
        });
      });

      return text.trim();
    } catch (e: any) {
      metrics.ai.counter('chat_text_errors').add(1, { model: model.id });
      throw this.handleError(e, model.id, options);
    }
  }

  async *streamText(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotChatOptions = {}
  ): AsyncIterable<string> {
    const fullCond = { ...cond, outputType: ModelOutputType.Text };
    await this.checkParams({ messages, cond: fullCond, options });
    const model = this.selectModel(fullCond);
    const textParser = new TextStreamParser(model.id);

    try {
      metrics.ai.counter('chat_text_stream_calls').add(1, { model: model.id });
      const { fullStream, usage } = await this.getFullStream(
        model,
        messages,
        options
      );
      const citationParser = new CitationParser();
      for await (const chunk of fullStream) {
        switch (chunk.type) {
          case 'text-delta': {
            let result = textParser.parse(chunk);
            result = citationParser.parse(result);
            yield result;
            break;
          }
          case 'finish': {
            const footnotes = textParser.end();
            const result =
              citationParser.end() + (footnotes.length ? '\n' + footnotes : '');
            yield result;
            break;
          }
          default: {
            yield textParser.parse(chunk);
            break;
          }
        }
        if (options.signal?.aborted) {
          await fullStream.cancel();
          break;
        }
      }
      await textParser.handleFinish(usage);
    } catch (e: any) {
      metrics.ai.counter('chat_text_stream_errors').add(1, { model: model.id });
      textParser.handleError();
      throw this.handleError(e, model.id, options);
    }
  }

  override async *streamObject(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotChatOptions = {}
  ): AsyncIterable<StreamObject> {
    const fullCond = { ...cond, outputType: ModelOutputType.Object };
    await this.checkParams({ cond: fullCond, messages, options });
    const model = this.selectModel(fullCond);
    const parser = new StreamObjectParser(model.id);

    try {
      metrics.ai
        .counter('chat_object_stream_calls')
        .add(1, { model: model.id });
      const { fullStream, usage } = await this.getFullStream(
        model,
        messages,
        options
      );
      for await (const chunk of fullStream) {
        const result = parser.parse(chunk);
        if (result) yield result;
        if (options.signal?.aborted) {
          parser.handleError();
          await fullStream.cancel();
          break;
        }
      }
      await parser.handleFinish(usage);
    } catch (e: any) {
      metrics.ai
        .counter('chat_object_stream_errors')
        .add(1, { model: model.id });
      parser.handleError();
      throw this.handleError(e, model.id, options);
    }
  }

  override async structure(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotStructuredOptions = {}
  ): Promise<string> {
    const fullCond = { ...cond, outputType: ModelOutputType.Structured };
    await this.checkParams({ messages, cond: fullCond, options });
    const model = this.selectModel(fullCond);

    try {
      metrics.ai.counter('chat_text_calls').add(1, { model: model.id });
      const { object } = await TokenTracker.trackAICall(model.id, async () => {
        const [system, msgs, schema] = await chatToGPTMessage(messages);
        if (!schema) throw new CopilotPromptInvalid('Schema is required');
        return await generateObject({
          model: this.model(model.id),
          system,
          messages: msgs,
          temperature: options.temperature ?? 0,
          maxOutputTokens: options.maxTokens ?? 4096,
          maxRetries: options.maxRetries ?? 3,
          schema,
          abortSignal: options.signal,
        });
      });
      return JSON.stringify(object);
    } catch (e: any) {
      metrics.ai.counter('chat_text_errors').add(1, { model: model.id });
      throw this.handleError(e, model.id, options);
    }
  }

  private async getFullStream(
    model: CopilotProviderModel,
    messages: PromptMessage[],
    options: CopilotChatOptions = {}
  ) {
    const [system, msgs] = await chatToGPTMessage(messages);
    const { tools } = await this.getTools(options, model.id);
    const { fullStream, usage } = streamText({
      model: this.model(model.id),
      system,
      messages: msgs,
      frequencyPenalty: options.frequencyPenalty ?? 0,
      presencePenalty: options.presencePenalty ?? 0,
      temperature: options.temperature ?? 0,
      maxOutputTokens: options.maxTokens ?? 4096,
      tools,
      stopWhen: stepCountIs(this.MAX_STEPS),
      abortSignal: options.signal,
    });
    return { fullStream, usage };
  }

  override async *streamImages(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotImageOptions = {}
  ) {
    const fullCond = { ...cond, outputType: ModelOutputType.Image };
    await this.checkParams({ messages, cond: fullCond, options });
    const model = this.selectModel(fullCond);

    metrics.ai
      .counter('generate_images_stream_calls')
      .add(1, { model: model.id });
    const { content: prompt } = [...messages].pop() || {};
    if (!prompt) throw new CopilotPromptInvalid('Prompt is required');

    try {
      const result = await generateImage({
        model: this.#gateway.imageModel(model.id as GatewayModelId),
        prompt,
      });
      for (const image of result.images) {
        const dataUrl = `data:image/png;base64,${image.base64}`;
        yield dataUrl;
        if (options.signal?.aborted) break;
      }
      return;
    } catch (e: any) {
      metrics.ai.counter('generate_images_errors').add(1, { model: model.id });
      throw this.handleError(e, model.id, options);
    }
  }

  override async embedding(
    cond: ModelConditions,
    messages: string | string[],
    options: CopilotEmbeddingOptions = { dimensions: DEFAULT_DIMENSIONS }
  ): Promise<number[][]> {
    messages = Array.isArray(messages) ? messages : [messages];
    const fullCond = { ...cond, outputType: ModelOutputType.Embedding };
    await this.checkParams({ embeddings: messages, cond: fullCond, options });
    const model = this.selectModel(fullCond);

    try {
      metrics.ai
        .counter('generate_embedding_calls')
        .add(1, { model: model.id });
      const startTime = Date.now();

      const { embeddings, usage } = await embedMany({
        model: this.#gateway.textEmbeddingModel(model.id as GatewayModelId),
        values: messages,
      });

      TokenTracker.getCurrentTracker()?.recordUsage(
        'embedding',
        model.id,
        Date.now() - startTime,
        {
          inputTokens: usage.tokens || 0,
          outputTokens: 0,
          totalTokens: usage.tokens || 0,
        }
      );

      return embeddings.filter((v: any) => v && Array.isArray(v));
    } catch (e: any) {
      metrics.ai
        .counter('generate_embedding_errors')
        .add(1, { model: model.id });
      throw this.handleError(e, model.id, options);
    }
  }
}
