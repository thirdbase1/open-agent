import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Tool, ToolSet } from 'ai';
import { z } from 'zod';

import {
  Cache,
  Config,
  CopilotPromptInvalid,
  CopilotProviderNotSupported,
  OnEvent,
} from '../../../base';
import { Models } from '../../../models';
import { CopilotContextService } from '../context';
import { PromptService } from '../prompt';
import { CopilotStorage } from '../storage';
import {
  buildDocSearchGetter,
  buildSaveDocGetter,
  createAgentBrowserTool,
  createWebFetchTool,
  createUrlScannerTool,
  createQuickComputeTool,
  createDesignGeneratorTool,
  createDesignSystemTool,
  createVisualPolishTool,
  createChooseTool,
  createCodeArtifactTool,
  createConversationSummaryTool,
  createDocComposeTool,
  createDocSemanticSearchTool,
  createVercelPythonSandboxTool,
  createFirecrawlTool,
  createParallelExtractTool,
  createParallelSearchTool,
  createMakeItRealTool,
  createMarkTodoTool,
  createTaskAnalysisTool,
  createTodoTool,
  createImageVisionTool,
  createTranslatorTool,
  createCodeReviewerTool,
  createContentWriterTool,
  createDataAnalyzerTool,
  createDocSummarizerTool,
  createVoiceGeneratorTool,
} from '../tools';
import { createPythonCodingTool } from '../tools/python-coding';
import { CopilotProviderFactory } from './factory';
import {
  type CopilotChatOptions,
  CopilotChatTools,
  type CopilotEmbeddingOptions,
  type CopilotImageOptions,
  CopilotProviderModel,
  CopilotProviderType,
  CopilotStructuredOptions,
  EmbeddingMessage,
  ModelCapability,
  ModelConditions,
  ModelFullConditions,
  ModelInputType,
  type PromptMessage,
  PromptMessageSchema,
  StreamObject,
  StreamObjectToolResult,
} from './types';

type GetToolResult = {
  toolOneTimeStream: ReadableStream<StreamObjectToolResult>;
  tools: ToolSet;
};

@Injectable()
export abstract class CopilotProvider<C = any> {
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly MAX_STEPS = 20;
  protected onlineModelList: string[] = [];

  abstract readonly type: CopilotProviderType;
  abstract readonly models: CopilotProviderModel[];
  abstract configured(): boolean;

  @Inject() protected readonly OpenAgentConfig!: Config;
  @Inject() protected readonly factory!: CopilotProviderFactory;
  @Inject() protected readonly moduleRef!: ModuleRef;
  @Inject() protected readonly cache!: Cache;
  @Inject() protected readonly copilotStorage!: CopilotStorage;

  get config(): C {
    return this.OpenAgentConfig.copilot.providers[this.type] as C;
  }

  @OnEvent('config.init')
  async onConfigInit() {
    this.setup();
  }

  @OnEvent('config.changed')
  async onConfigChanged(event: Events['config.changed']) {
    if ('copilot' in event.updates) {
      this.setup();
    }
  }

  protected setup() {
    if (this.configured()) {
      this.factory.register(this);
      this.refreshOnlineModels().catch(e =>
        this.logger.error('Failed to refresh online models', e)
      );
    } else {
      this.factory.unregister(this);
    }
  }

  protected async refreshOnlineModels() {}

  private findValidModel(
    cond: ModelFullConditions
  ): CopilotProviderModel | undefined {
    const { modelId, outputType, inputTypes } = cond;
    const matcher = (cap: ModelCapability) =>
      (!outputType || cap.output.includes(outputType)) &&
      (!inputTypes?.length ||
        inputTypes.every(type => cap.input.includes(type)));

    if (modelId) {
      const hasOnlineModel = this.onlineModelList.includes(modelId);

      const model = this.models.find(
        m => m.id === modelId && m.capabilities.some(matcher)
      );

      if (model) return model;
      // allow online model without capabilities check
      if (hasOnlineModel) return { id: modelId, capabilities: [] };
      return undefined;
    }
    if (!outputType) return undefined;

    // First try to find a model with defaultForOutputType flag
    const defaultModel = this.models.find(m =>
      m.capabilities.some(c => matcher(c) && c.defaultForOutputType)
    );
    if (defaultModel) return defaultModel;

    // Fallback: return the first model that matches the capability criteria.
    // This prevents crashes when no model has defaultForOutputType set.
    return this.models.find(m => m.capabilities.some(matcher));
  }

  // make it async to allow dynamic check available models in some providers
  async match(cond: ModelFullConditions = {}): Promise<boolean> {
    return this.configured() && !!this.findValidModel(cond);
  }

  protected selectModel(cond: ModelFullConditions): CopilotProviderModel {
    const model = this.findValidModel(cond);
    if (model) return model;

    const { modelId, outputType, inputTypes } = cond;
    throw new CopilotPromptInvalid(
      modelId
        ? `Model ${modelId} does not support ${outputType ?? '<any>'} output with ${inputTypes ?? '<any>'} input`
        : outputType
          ? `No model supports ${outputType} output with ${inputTypes ?? '<any>'} input for provider ${this.type}`
          : 'Output type is required when modelId is not provided'
    );
  }

  protected getProviderSpecificTools(
    _toolName: CopilotChatTools,
    _model: string
  ): [string, Tool?] | undefined {
    return;
  }

  // use for tool use, shared between providers
  protected async getTools(
    options: CopilotChatOptions,
    model: string
  ): Promise<GetToolResult> {
    const { readable: toolStreams, writable } =
      new TransformStream<StreamObjectToolResult>();
    const tools: ToolSet = {};
    if (options?.tools?.length) {
      this.logger.debug(`getTools: ${JSON.stringify(options.tools)}`);
      const prompt = this.moduleRef.get(PromptService, {
        strict: false,
      });
      const models = this.moduleRef.get(Models, {
        strict: false,
      });
      const saveDoc = buildSaveDocGetter(models, prompt, this.factory).bind(
        null,
        options
      );

      for (const tool of options.tools) {
        const toolDef = this.getProviderSpecificTools(tool, model);
        if (toolDef) {
          // allow provider prevent tool creation
          if (toolDef[1]) {
            tools[toolDef[0]] = toolDef[1];
          }
          continue;
        }
        switch (tool) {
          case 'browserUse': {
            tools.agent_browser = createAgentBrowserTool(
              this.OpenAgentConfig,
              options.sessionId,
              options.user
            );
            break;
          }
          case 'codeArtifact': {
            tools.code_artifact = createCodeArtifactTool(prompt, this.factory);
            break;
          }
          case 'choose': {
            tools.choose = createChooseTool();
            break;
          }
          case 'conversationSummary': {
            tools.conversation_summary = createConversationSummaryTool(
              options.session,
              prompt,
              this.factory
            );
            break;
          }
          case 'taskAnalysis': {
            tools.task_analysis = createTaskAnalysisTool(
              options.session,
              prompt,
              this.factory
            );
            break;
          }
          case 'docSemanticSearch': {
            const context = this.moduleRef.get(CopilotContextService, {
              strict: false,
            });
            const docContext = options.session
              ? await context.getBySessionId(options.session)
              : null;
            const searchDocs = buildDocSearchGetter(context, docContext);
            tools.doc_semantic_search = createDocSemanticSearchTool(
              searchDocs.bind(null, options)
            );
            break;
          }
          case 'todoList': {
            tools.todo_list = createTodoTool(this.cache);
            break;
          }
          case 'markTodo': {
            tools.mark_todo = createMarkTodoTool(this.cache);
            break;
          }
          case 'webSearch': {
            tools.web_search_parallel = createParallelSearchTool(
              this.OpenAgentConfig
            );
            tools.web_extract_parallel = createParallelExtractTool(
              this.OpenAgentConfig
            );
            tools.web_crawl_firecrawl = createFirecrawlTool(
              this.OpenAgentConfig
            );
            break;
          }
          case 'docCompose': {
            tools.doc_compose = createDocComposeTool(
              writable,
              prompt,
              this.factory,
              saveDoc
            );
            break;
          }
          case 'makeItReal': {
            tools.make_it_real = createMakeItRealTool(
              writable,
              prompt,
              this.factory,
              saveDoc
            );
            break;
          }
          case 'pythonCoding': {
            tools.python_coding = createPythonCodingTool(
              writable,
              prompt,
              this.factory
            );
            break;
          }
          case 'pythonSandbox': {
            const copilotStorage = this.copilotStorage;
            tools.vercel_python_sandbox = createVercelPythonSandboxTool(
              writable,
              this.OpenAgentConfig,
              copilotStorage,
              options.user || '',
              options.sessionId
            );
            break;
          }
          case 'webFetch': {
            tools.web_fetch = createWebFetchTool();
            break;
          }
          case 'urlScanner': {
            tools.url_scanner = createUrlScannerTool();
            break;
          }
          case 'quickCompute': {
            tools.quick_compute = createQuickComputeTool();
            break;
          }
          case 'designGenerator': {
            tools.design_generator = createDesignGeneratorTool();
            break;
          }
          case 'designSystem': {
            tools.design_system = createDesignSystemTool();
            break;
          }
          case 'visualPolish': {
            tools.visual_polish = createVisualPolishTool();
            break;
          }
          case 'imageVision': {
            tools.image_vision = createImageVisionTool();
            break;
          }
          case 'translator': {
            tools.translator = createTranslatorTool();
            break;
          }
          case 'codeReviewer': {
            tools.code_reviewer = createCodeReviewerTool();
            break;
          }
          case 'contentWriter': {
            tools.content_writer = createContentWriterTool();
            break;
          }
          case 'dataAnalyzer': {
            tools.data_analyzer = createDataAnalyzerTool();
            break;
          }
          case 'docSummarizer': {
            tools.doc_summarizer = createDocSummarizerTool();
            break;
          }
          case 'voiceGenerator': {
            tools.voice_generator = createVoiceGeneratorTool();
            break;
          }
        }
      }
    }
    return { tools, toolOneTimeStream: toolStreams };
  }

  private handleZodError(ret: z.SafeParseReturnType<any, any>) {
    if (ret.success) return;
    const issues = ret.error.issues.map(i => {
      const path =
        'root' +
        (i.path.length
          ? `.${i.path.map(seg => (typeof seg === 'number' ? `[${seg}]` : `.${seg}`)).join('')}`
          : '');
      return `${i.message}${path}`;
    });
    throw new CopilotPromptInvalid(issues.join('; '));
  }

  protected async checkParams({
    cond,
    messages,
    embeddings,
    options = {},
  }: {
    cond: ModelFullConditions;
    messages?: PromptMessage[];
    embeddings?: string[];
    options?: CopilotChatOptions;
  }) {
    const model = this.selectModel(cond);
    const multimodal = model.capabilities.some(c =>
      [ModelInputType.Image, ModelInputType.Audio].some(t =>
        c.input.includes(t)
      )
    );

    if (messages) {
      const { requireContent = true, requireAttachment = false } = options;

      const MessageSchema = z
        .array(
          PromptMessageSchema.extend({
            content: requireContent
              ? z.string().trim().min(1)
              : z.string().optional().nullable(),
          })
            .passthrough()
            .catchall(z.union([z.string(), z.number(), z.date(), z.null()]))
            .refine(
              m =>
                !(multimodal && requireAttachment && m.role === 'user') ||
                (m.attachments ? m.attachments.length > 0 : true),
              { message: 'attachments required in multimodal mode' }
            )
        )
        .optional();

      this.handleZodError(MessageSchema.safeParse(messages));
    }
    if (embeddings) {
      this.handleZodError(EmbeddingMessage.safeParse(embeddings));
    }
  }

  abstract text(
    model: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotChatOptions
  ): Promise<string>;

  abstract streamText(
    model: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotChatOptions
  ): AsyncIterable<string>;

  streamObject(
    _model: ModelConditions,
    _messages: PromptMessage[],
    _options?: CopilotChatOptions
  ): AsyncIterable<StreamObject> {
    throw new CopilotProviderNotSupported({
      provider: this.type,
      kind: 'object',
    });
  }

  structure(
    _cond: ModelConditions,
    _messages: PromptMessage[],
    _options?: CopilotStructuredOptions
  ): Promise<string> {
    throw new CopilotProviderNotSupported({
      provider: this.type,
      kind: 'structure',
    });
  }

  streamImages(
    _model: ModelConditions,
    _messages: PromptMessage[],
    _options?: CopilotImageOptions
  ): AsyncIterable<string> {
    throw new CopilotProviderNotSupported({
      provider: this.type,
      kind: 'image',
    });
  }

  embedding(
    _model: ModelConditions,
    _text: string | string[],
    _options?: CopilotEmbeddingOptions
  ): Promise<number[][]> {
    throw new CopilotProviderNotSupported({
      provider: this.type,
      kind: 'embedding',
    });
  }

  async rerank(
    _model: ModelConditions,
    _messages: PromptMessage[][],
    _options?: CopilotChatOptions
  ): Promise<number[]> {
    throw new CopilotProviderNotSupported({
      provider: this.type,
      kind: 'rerank',
    });
  }
}
