import { AiPromptRole } from '@prisma/client';
import { z } from 'zod';

// ========== provider ==========

export enum CopilotProviderType {
  Anthropic = 'anthropic',
  Gemini = 'gemini',
  OpenAI = 'openai',
  Perplexity = 'perplexity',
  Morph = 'morph',
}

export const CopilotProviderSchema = z.object({
  type: z.nativeEnum(CopilotProviderType),
});

// ========== prompt ==========

export const PromptTools = z
  .enum([
    'browserUse',
    'choose',
    'codeArtifact',
    'conversationSummary',
    'taskAnalysis',
    // artifact tools
    'docCompose',
    // work with morph
    'docEdit',
    // work with indexer
    'docRead',
    'docKeywordSearch',
    // work with embeddings
    'docSemanticSearch',
    'todoList',
    'markTodo',
    // web search via parallel + firecrawl
    'webSearch',
    // make it real
    'makeItReal',
    // python coding
    'pythonCoding',
    // vercel python sandbox
    'pythonSandbox',
    // web fetch (no browser/API needed)
    'webFetch',
    // url scanner (metadata, links, SEO)
    'urlScanner',
    // quick compute (JS eval for fast calculations)
    'quickCompute',
  ])
  .array();

export const PromptConfigStrictSchema = z.object({
  tools: PromptTools.nullable().optional(),
  // params requirements
  requireContent: z.boolean().nullable().optional(),
  requireAttachment: z.boolean().nullable().optional(),
  // structure output
  maxRetries: z.number().nullable().optional(),
  // openai
  frequencyPenalty: z.number().nullable().optional(),
  presencePenalty: z.number().nullable().optional(),
  temperature: z.number().nullable().optional(),
  topP: z.number().nullable().optional(),
  maxTokens: z.number().nullable().optional(),
  // google
  audioTimestamp: z.boolean().nullable().optional(),
});

export const PromptConfigSchema =
  PromptConfigStrictSchema.nullable().optional();

export type PromptConfig = z.infer<typeof PromptConfigSchema>;

// ========== message ==========

export const EmbeddingMessage = z.array(z.string().trim().min(1)).min(1);

export const ChatMessageRole = Object.values(AiPromptRole) as [
  'system',
  'assistant',
  'user',
];

export const ChatMessageAttachment = z.union([
  z.string().url(),
  z.object({
    attachment: z.string(),
    mimeType: z.string(),
  }),
]);

export const TokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number().optional(),
  totalTokens: z.number(),
  totalWithReasoning: z.number().optional(),
});

export const TokenUsageTotalSchema = TokenUsageSchema.extend({
  timing: z.object({
    duration: z.number(),
    reasoningDuration: z.number(),
    averageCallDuration: z.number(),
    callCount: z.number(),
  }),
});

export const TokenUsageDetailSchema = z.object({
  step: z.string(),
  model: z.string(),
  usage: TokenUsageSchema.optional(),
  duration: z.number(),
  reasoningDuration: z.number().optional(),
});

export const TokenTrackingContextSchema = z.object({
  requestId: z.string(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  toolChain: z.array(z.string()),
  usageRecords: z.array(TokenUsageDetailSchema),
});

export const TokenReport = z.object({
  model: z.string(),
  processed: z.number(),
  generated: z.number(),
  calls: z.number(),
  timeTaken: z.number(),
});

export const TokenSummarySchema = z.object({
  overview: z.string(),
  report: z.array(TokenReport),
});

export type TokenSummary = z.infer<typeof TokenSummarySchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type TokenUsageTotal = z.infer<typeof TokenUsageTotalSchema>;
export type TokenUsageDetail = z.infer<typeof TokenUsageDetailSchema>;
export type TokenTrackingContext = z.infer<typeof TokenTrackingContextSchema>;

const StreamObjectPureSchema = [
  z.object({
    type: z.literal('text-delta'),
    textDelta: z.string(),
  }),
  z.object({
    type: z.literal('reasoning'),
    textDelta: z.string(),
  }),
  z.object({
    type: z.literal('tool-call'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.any()),
  }),
  z.object({
    type: z.literal('tool-result'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.any()),
    result: z.any(),
  }),
  z.object({
    type: z.literal('status'),
    result: z.object({
      completed: z.boolean(),
      summary: TokenSummarySchema.optional(),
      tokenUsage: TokenUsageTotalSchema.optional(),
      records: z.array(TokenUsageDetailSchema).optional(),
    }),
  }),
] as const;
const StreamObjectToolResultSchema = z.object({
  type: z.literal('tool-incomplete-result'),
  toolName: z.string().optional(),
  toolCallId: z.string(),
  input: z.record(z.any()).optional(),
  data: z.discriminatedUnion('type', StreamObjectPureSchema),
});

export const StreamObjectSchema = z.discriminatedUnion('type', [
  ...StreamObjectPureSchema,
  StreamObjectToolResultSchema,
]);

export const PureMessageSchema = z.object({
  content: z.string(),
  streamObjects: z.array(StreamObjectSchema).optional().nullable(),
  attachments: z.array(ChatMessageAttachment).optional().nullable(),
  params: z.record(z.any()).optional().nullable(),
});

export const PromptMessageSchema = PureMessageSchema.extend({
  role: z.enum(ChatMessageRole),
}).strict();
export type PromptMessage = z.infer<typeof PromptMessageSchema>;
export type PromptParams = NonNullable<PromptMessage['params']>;
export type StreamObjectPure = z.infer<(typeof StreamObjectPureSchema)[number]>;
export type StreamObjectToolResult = z.infer<
  typeof StreamObjectToolResultSchema
>;
export type StreamObject = z.infer<typeof StreamObjectSchema>;

// ========== options ==========

const CopilotProviderOptionsSchema = z.object({
  signal: z.instanceof(AbortSignal).optional(),
  user: z.string().optional(),
  session: z.string().optional(),
});

export const CopilotChatOptionsSchema = CopilotProviderOptionsSchema.merge(
  PromptConfigStrictSchema
).optional();

export type CopilotChatOptions = z.infer<typeof CopilotChatOptionsSchema>;
export type CopilotChatTools = NonNullable<
  NonNullable<CopilotChatOptions>['tools']
>[number];

export const CopilotStructuredOptionsSchema =
  CopilotProviderOptionsSchema.merge(PromptConfigStrictSchema).optional();

export type CopilotStructuredOptions = z.infer<
  typeof CopilotStructuredOptionsSchema
>;

export const CopilotImageOptionsSchema = CopilotProviderOptionsSchema.merge(
  PromptConfigStrictSchema
)
  .extend({
    quality: z.string().optional(),
    seed: z.number().optional(),
  })
  .optional();

export type CopilotImageOptions = z.infer<typeof CopilotImageOptionsSchema>;

export const CopilotEmbeddingOptionsSchema =
  CopilotProviderOptionsSchema.extend({
    dimensions: z.number(),
  }).optional();

export type CopilotEmbeddingOptions = z.infer<
  typeof CopilotEmbeddingOptionsSchema
>;

export enum ModelInputType {
  Text = 'text',
  Image = 'image',
  Audio = 'audio',
}

export enum ModelOutputType {
  Text = 'text',
  Object = 'object',
  Embedding = 'embedding',
  Image = 'image',
  Structured = 'structured',
}

export interface ModelCapability {
  input: ModelInputType[];
  output: ModelOutputType[];
  defaultForOutputType?: boolean;
}

export interface CopilotProviderModel {
  id: string;
  capabilities: ModelCapability[];
}

export type ModelConditions = {
  inputTypes?: ModelInputType[];
  modelId?: string;
};

export type ModelFullConditions = ModelConditions & {
  outputType?: ModelOutputType;
};
