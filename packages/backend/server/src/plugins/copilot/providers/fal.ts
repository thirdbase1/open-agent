import { createFal, type FalImageModel } from '@ai-sdk/fal';
import { generateImage } from 'ai';
import { Injectable } from '@nestjs/common';
import { z, ZodType } from 'zod';

import {
  CopilotPromptInvalid,
  CopilotProviderSideError,
  metrics,
  UserFriendlyError,
} from '../../../base';
import { CopilotProvider } from './provider';
import type {
  CopilotChatOptions,
  CopilotImageOptions,
  ModelConditions,
  PromptMessage,
} from './types';
import { CopilotProviderType, ModelInputType, ModelOutputType } from './types';

export type FalConfig = {
  apiKey: string;
};

const FalImageSchema = z
  .object({
    url: z.string(),
    seed: z.number().nullable().optional(),
    content_type: z.string(),
    file_name: z.string().nullable().optional(),
    file_size: z.number().nullable().optional(),
    width: z.number(),
    height: z.number(),
  })
  .optional();

type FalImage = z.infer<typeof FalImageSchema>;

const FalResponseSchema = z.object({
  detail: z
    .union([
      z.array(z.object({ type: z.string(), msg: z.string() })),
      z.string(),
    ])
    .optional(),
  images: z.array(FalImageSchema).nullable().optional(),
  image: FalImageSchema.nullable().optional(),
  output: z.string().nullable().optional(),
});

type FalResponse = z.infer<typeof FalResponseSchema>;

type FalPrompt = {
  model_name?: string;
  image_url?: string;
  prompt?: string;
  loras?: { path: string; scale?: number }[];
  controlnets?: {
    image_url: string;
    start_percentage?: number;
    end_percentage?: number;
  }[];
};

@Injectable()
export class FalProvider extends CopilotProvider<FalConfig> {
  override type = CopilotProviderType.FAL;

  override readonly models = [
    {
      id: 'fal-ai/flux/schnell',
      capabilities: [
        {
          input: [ModelInputType.Text],
          output: [ModelOutputType.Image],
          defaultForOutputType: true,
        },
      ],
    },
    // image to image models
    {
      id: 'fal-ai/lcm-sd15-i2i',
      capabilities: [
        {
          input: [ModelInputType.Image],
          output: [ModelOutputType.Image],
          defaultForOutputType: true,
        },
      ],
    },
    {
      id: 'fal-ai/clarity-upscaler',
      capabilities: [
        {
          input: [ModelInputType.Image],
          output: [ModelOutputType.Image],
        },
      ],
    },
    {
      id: 'fal-ai/face-to-sticker',
      capabilities: [
        {
          input: [ModelInputType.Image],
          output: [ModelOutputType.Image],
        },
      ],
    },
    {
      id: 'fal-ai/imageutils/rembg',
      capabilities: [
        {
          input: [ModelInputType.Image],
          output: [ModelOutputType.Image],
        },
      ],
    },
    {
      id: 'fal-ai/lora/image-to-image',
      capabilities: [
        {
          input: [ModelInputType.Image],
          output: [ModelOutputType.Image],
        },
      ],
    },
  ];

  #instance!: ReturnType<typeof createFal>;

  override configured(): boolean {
    return !!this.config.apiKey;
  }

  protected override setup() {
    super.setup();
    this.#instance = createFal({ apiKey: this.config.apiKey });
  }

  private extractArray<T>(value: T | T[] | undefined): T[] {
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  private extractPrompt(
    message?: PromptMessage,
    options: CopilotImageOptions = {}
  ): FalPrompt {
    if (!message) throw new CopilotPromptInvalid('Prompt is empty');
    const { content, attachments, params } = message;
    if (!content && (!Array.isArray(attachments) || !attachments.length)) {
      throw new CopilotPromptInvalid('Prompt or Attachments is empty');
    }
    if (Array.isArray(attachments) && attachments.length > 1) {
      throw new CopilotPromptInvalid('Only one attachment is allowed');
    }
    const lora = [
      ...this.extractArray(params?.lora),
      ...this.extractArray(options.loras),
    ].filter(
      (v): v is { path: string; scale?: number } =>
        !!v && typeof v === 'object' && typeof v.path === 'string'
    );
    return {
      model_name: options.modelName || undefined,
      image_url: attachments
        ?.map(v =>
          typeof v === 'string'
            ? v
            : v.mimeType.startsWith('image/')
              ? v.attachment
              : undefined
        )
        .find(v => !!v),
      prompt: content.trim(),
      loras: lora.length ? lora : undefined,
    };
  }

  private extractFalError(
    resp: FalResponse,
    message?: string
  ): CopilotProviderSideError {
    if (Array.isArray(resp.detail) && resp.detail.length) {
      const error = resp.detail[0].msg;
      return new CopilotProviderSideError({
        provider: this.type,
        kind: resp.detail[0].type,
        message: message ? `${message}: ${error}` : error,
      });
    } else if (typeof resp.detail === 'string') {
      const error = resp.detail;
      return new CopilotProviderSideError({
        provider: this.type,
        kind: resp.detail,
        message: message ? `${message}: ${error}` : error,
      });
    }
    return new CopilotProviderSideError({
      provider: this.type,
      kind: 'unknown',
      message: 'No content generated',
    });
  }

  private handleError(e: any) {
    if (e instanceof UserFriendlyError) {
      return e;
    }
    return new CopilotProviderSideError({
      provider: this.type,
      kind: 'unexpected_response',
      message: e?.message || 'Unexpected fal response',
    });
  }

  private parseSchema<R>(schema: ZodType<R>, data: unknown): R {
    const result = schema.safeParse(data);
    if (result.success) return result.data;
    const errors = JSON.stringify(result.error.errors);
    throw new CopilotProviderSideError({
      provider: this.type,
      kind: 'unexpected_response',
      message: `Unexpected fal response: ${errors}`,
    });
  }

  async text(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotChatOptions = {}
  ): Promise<string> {
    const model = this.selectModel(cond);

    try {
      metrics.ai.counter('chat_text_calls').add(1, { model: model.id });
      const prompt = this.extractPrompt(messages[messages.length - 1]);

      const response = await fetch(`https://fal.run/${model.id}`, {
        method: 'POST',
        headers: {
          Authorization: `key ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...prompt,
          sync_mode: true,
          enable_safety_checks: false,
        }),
        signal: options.signal,
      });

      const data = this.parseSchema(FalResponseSchema, await response.json());
      if (!data.output) {
        throw this.extractFalError(data, 'Failed to generate text');
      }
      return data.output;
    } catch (e: any) {
      metrics.ai.counter('chat_text_errors').add(1, { model: model.id });
      throw this.handleError(e);
    }
  }

  async *streamText(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotChatOptions | CopilotImageOptions = {}
  ): AsyncIterable<string> {
    const model = this.selectModel(cond);
    try {
      metrics.ai.counter('chat_text_stream_calls').add(1, { model: model.id });
      const result = await this.text(cond, messages, options);
      yield result;
    } catch (e) {
      metrics.ai.counter('chat_text_stream_errors').add(1, { model: model.id });
      throw e;
    }
  }

  override async *streamImages(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotImageOptions = {}
  ): AsyncIterable<string> {
    const model = this.selectModel({
      ...cond,
      outputType: ModelOutputType.Image,
    });

    try {
      metrics.ai
        .counter('generate_images_stream_calls')
        .add(1, { model: model.id });

      const prompt = this.extractPrompt(
        messages[messages.length - 1],
        options as CopilotImageOptions
      );

      // Use @ai-sdk/fal with generateImage for standard models
      const modelInstance = this.#instance.image(model.id);
      const result = await generateImage({
        model: modelInstance,
        prompt: prompt.prompt || '',
        size: options.width && options.height
          ? { width: options.width, height: options.height }
          : undefined,
        providerOptions: {
          fal: {
            ...(prompt.image_url ? { imageUrl: prompt.image_url } : {}),
            ...(prompt.loras ? { loras: prompt.loras } : {}),
            enableSafetyChecker: false,
          },
        },
        abortSignal: options.signal,
      });

      for (const image of result.images) {
        if (image.base64) {
          yield `data:image/png;base64,${image.base64}`;
        } else if (image.uint8Array) {
          yield `data:image/png;base64,${Buffer.from(image.uint8Array).toString('base64')}`;
        }
        if (options.signal?.aborted) {
          break;
        }
      }
      return;
    } catch (e: any) {
      metrics.ai
        .counter('generate_images_stream_errors')
        .add(1, { model: model.id });
      throw this.handleError(e);
    }
  }
}
