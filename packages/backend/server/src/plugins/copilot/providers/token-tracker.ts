import { AsyncLocalStorage } from 'node:async_hooks';

import type { LanguageModelUsage } from 'ai';

import type {
  TokenTrackingContext,
  TokenUsage,
  TokenUsageDetail,
  TokenUsageTotal,
} from './types';

export interface CreateContextParams {
  requestId: string;
  sessionId?: string;
  userId?: string;
  toolChain?: string[];
}

export interface TrackingOptions {
  extractUsage?: (result: any) => TokenUsage;
  step?: string;
}

export class TokenUsageTracker {
  constructor(private readonly context: TokenTrackingContext) {}

  recordUsage(
    step: string,
    model: string,
    duration: number,
    usage?: TokenUsage,
    reasoningDuration?: number
  ): void {
    this.context.usageRecords.push({
      step,
      model,
      usage,
      duration,
      reasoningDuration,
    });
  }

  getCurrentUsages(): TokenUsageDetail[] {
    return this.context.usageRecords;
  }

  getTotalUsage(): TokenUsageTotal {
    if (this.context.usageRecords.length === 0) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        totalWithReasoning: 0,
        timing: {
          duration: 0,
          reasoningDuration: 0,
          averageCallDuration: 0,
          callCount: 0,
        },
      };
    }

    const records = this.context.usageRecords;
    const inputTokens = records.reduce(
      (sum, r) => sum + (r.usage?.inputTokens ?? 0),
      0
    );
    const outputTokens = records.reduce(
      (sum, r) => sum + (r.usage?.outputTokens ?? 0),
      0
    );
    const reasoningTokens = records.reduce(
      (sum, r) => sum + (r.usage?.reasoningTokens ?? 0),
      0
    );
    const totalTokens = records.reduce(
      (sum, r) => sum + (r.usage?.totalTokens ?? 0),
      0
    );
    const totalWithReasoning = records.reduce(
      (sum, r) =>
        sum + (r.usage?.totalWithReasoning ?? r.usage?.totalTokens ?? 0),
      0
    );

    const totalDuration = records.reduce((sum, r) => sum + r.duration, 0);
    const totalReasoningDuration = records.reduce(
      (sum, r) => sum + (r.reasoningDuration || 0),
      0
    );

    return {
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
      totalWithReasoning,
      timing: {
        duration: totalDuration,
        reasoningDuration: totalReasoningDuration,
        averageCallDuration: totalDuration / records.length,
        callCount: records.length,
      },
    };
  }

  pushTool(toolName: string): void {
    this.context.toolChain.push(toolName);
  }

  popTool(): void {
    this.context.toolChain.pop();
  }

  getStepName(options?: { step?: string }): string {
    if (options?.step) {
      return options.step;
    }

    const currentTool = this.context.toolChain.slice(-1)[0] || 'main_request';

    if (this.context.toolChain.length === 1) {
      return currentTool;
    } else {
      return `tool_call:${currentTool}`;
    }
  }

  getTrackingReport(): {
    requestId: string;
    sessionId?: string;
    userId?: string;
    summary: TokenUsageTotal;
    details: TokenUsageDetail[];
  } {
    return {
      requestId: this.context.requestId,
      sessionId: this.context.sessionId,
      userId: this.context.userId,
      summary: this.getTotalUsage(),
      details: this.context.usageRecords,
    };
  }

  get requestId(): string {
    return this.context.requestId;
  }

  get sessionId(): string | undefined {
    return this.context.sessionId;
  }

  get userId(): string | undefined {
    return this.context.userId;
  }

  get toolChain(): string[] {
    return [...this.context.toolChain]; // 返回副本以防止外部修改
  }

  get rawContext(): TokenTrackingContext {
    return this.context;
  }
}

export class TokenTrackingManager {
  private static instance: TokenTrackingManager;
  private readonly storage = new AsyncLocalStorage<TokenTrackingContext>();

  private constructor() {}

  static getInstance(): TokenTrackingManager {
    if (!TokenTrackingManager.instance) {
      TokenTrackingManager.instance = new TokenTrackingManager();
    }
    return TokenTrackingManager.instance;
  }

  /**
   * 创建新的 tracking context 并返回 tracker
   */
  createContext(params: CreateContextParams): TokenUsageTracker {
    const context: TokenTrackingContext = {
      requestId: params.requestId,
      sessionId: params.sessionId,
      userId: params.userId,
      toolChain: params.toolChain || [],
      usageRecords: [],
    };

    this.storage.enterWith(context);
    return new TokenUsageTracker(context);
  }

  /**
   * 获取当前的 tracker
   */
  getCurrentTracker(): TokenUsageTracker | undefined {
    const context = this.storage.getStore();
    return context ? new TokenUsageTracker(context) : undefined;
  }

  /**
   * 获取或创建 tracker
   */
  getOrCreateTracker(options: {
    sessionId: string;
    userId: string;
    toolChain: string[];
  }): TokenUsageTracker {
    const current = this.getCurrentTracker();
    if (current) {
      return current;
    }

    return this.createContext({
      requestId: `${options.sessionId}_${Date.now()}`,
      sessionId: options.sessionId,
      userId: options.userId,
      toolChain: options.toolChain,
    });
  }

  /**
   * 在指定的 tracker context 中运行函数
   */
  async runWith<T>(
    tracker: TokenUsageTracker,
    fn: () => Promise<T>
  ): Promise<T> {
    const context = tracker.rawContext;
    return this.storage.run(context, async () => {
      const ret = await fn();

      // wrap AsyncIterable if needed
      if (this.isAsyncGenerator(ret)) {
        return this.wrapAsyncGenerator(ret) as any;
      } else if (this.isAsyncIterable(ret)) {
        return this.wrapAsyncIterable(ret, context) as any;
      }

      return ret;
    });
  }

  /**
   * 跟踪 AI 调用
   */
  async trackAICall<T extends { usage: LanguageModelUsage }>(
    modelId: string,
    aiCallFn: () => Promise<T>,
    options?: TrackingOptions
  ): Promise<T> {
    const startTime = Date.now();
    const tracker = this.getCurrentTracker();

    if (!tracker) return aiCallFn();

    const step = tracker.getStepName(options);

    try {
      const result = await aiCallFn();
      const endTime = Date.now();
      const duration = endTime - startTime;

      const usage = options?.extractUsage
        ? options.extractUsage(result)
        : this.extractUsage(result, modelId);

      tracker.recordUsage(step, modelId, duration, usage);
      return result;
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      tracker.recordUsage(step, modelId, duration);

      throw error;
    }
  }

  /**
   * 包装异步生成器
   */
  private wrapAsyncGenerator<T = unknown, TReturn = any, TNext = unknown>(
    generator: AsyncGenerator<T, TReturn, TNext>
  ): AsyncGenerator<T, TReturn, TNext> {
    const ctx = this.storage.getStore();
    if (!ctx) {
      return generator;
    }

    return {
      next: () => this.storage.run(ctx, () => generator.next()),
      return: args => this.storage.run(ctx, () => generator.return(args)),
      throw: args => this.storage.run(ctx, () => generator.throw(args)),

      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  /**
   * 包装异步可迭代对象
   */
  private wrapAsyncIterable<T>(
    src: AsyncIterable<T>,
    ctx: TokenTrackingContext
  ): AsyncIterable<T> {
    const storage = this.storage;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const item of src) {
          yield storage.run(ctx, () => item);
        }
      },
    };
  }

  /**
   * 检查是否为异步生成器
   */
  private isAsyncGenerator<T>(obj: any): obj is AsyncGenerator<T> {
    return (
      obj &&
      typeof obj[Symbol.asyncIterator] === 'function' &&
      typeof obj.next === 'function' &&
      typeof obj.return === 'function' &&
      typeof obj.throw === 'function'
    );
  }

  /**
   * 检查是否为异步可迭代对象
   */
  private isAsyncIterable<T>(obj: any): obj is AsyncIterable<T> {
    return obj && typeof obj[Symbol.asyncIterator] === 'function';
  }

  /**
   * 从结果中提取 token 使用情况
   */
  private extractUsage(result: any, _modelId?: string): TokenUsage {
    const usage = result.usage;

    if (usage) {
      return {
        inputTokens: usage.inputTokens || usage.promptTokens || 0,
        outputTokens: usage.outputTokens || usage.completionTokens || 0,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens || usage.reasoningTokens || undefined,
        totalTokens: usage.totalTokens || (usage.inputTokens || usage.promptTokens || 0) + (usage.outputTokens || usage.completionTokens || 0),
        totalWithReasoning: usage.totalTokens || undefined,
      };
    } else {
      // 如果没有usage信息，需要使用tiktoken计算（这部分后续实现）
      return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    }
  }
}

export const TokenTracker = TokenTrackingManager.getInstance();
