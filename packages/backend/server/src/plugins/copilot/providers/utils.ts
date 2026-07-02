import { GoogleVertexProviderSettings } from '@ai-sdk/google-vertex';
import { GoogleVertexAnthropicProviderSettings } from '@ai-sdk/google-vertex/anthropic';
import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  AssistantModelMessage,
  UserModelMessage,
  DataContent,
  FilePart,
  ImagePart,
  LanguageModelUsage,
  TextPart,
  TextStreamPart,
} from 'ai';
import { GoogleAuth, GoogleAuthOptions } from 'google-auth-library';
import z, { ZodType } from 'zod';

import { PromptService } from '../prompt';
import { CustomAITools } from '../tools';
import { CopilotProviderFactory } from './factory';
import { TokenTracker } from './token-tracker';
import {
  PromptMessage,
  StreamObject,
  StreamObjectToolResult,
  TokenSummary,
  TokenUsageDetail,
  TokenUsageTotal,
} from './types';

type ChatMessage = UserModelMessage | AssistantModelMessage;

const SIMPLE_IMAGE_URL_REGEX = /^(https?:\/\/|data:image\/)/;
const FORMAT_INFER_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  m4a: 'audio/aac',
  flac: 'audio/flac',
  ogv: 'video/ogg',
  wav: 'audio/wav',
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  md: 'text/plain',
  mov: 'video/mov',
  mpeg: 'video/mpeg',
  mp4: 'video/mp4',
  avi: 'video/avi',
  wmv: 'video/wmv',
  flv: 'video/flv',
};

export async function inferMimeType(url: string) {
  if (url.startsWith('data:')) {
    return url.split(';')[0].split(':')[1];
  }
  const pathname = new URL(url).pathname;
  const extension = pathname.split('.').pop();
  if (extension) {
    const ext = FORMAT_INFER_MAP[extension];
    if (ext) {
      return ext;
    }
    const mimeType = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
    }).then(res => res.headers.get('Content-Type'));
    if (mimeType) {
      return mimeType;
    }
  }
  return 'application/octet-stream';
}

export async function chatToGPTMessage(
  messages: PromptMessage[],
  // TODO(@darkskygit): move this logic in interface refactoring
  withAttachment: boolean = true,
  // NOTE: some providers in vercel ai sdk are not able to handle url attachments yet
  //       so we need to use base64 encoded attachments instead
  useBase64Attachment: boolean = false
): Promise<[string | undefined, ChatMessage[], ZodType?]> {
  const system = messages[0]?.role === 'system' ? messages.shift() : undefined;
  const schema =
    system?.params?.schema && system.params.schema instanceof ZodType
      ? system.params.schema
      : undefined;

  // filter redundant fields
  const msgs: ChatMessage[] = [];
  for (let { role, content, attachments, params } of messages.filter(
    m => m.role !== 'system'
  )) {
    content = content.trim();
    role = role as 'user' | 'assistant';
    const mimetype = params?.mimetype;
    if (Array.isArray(attachments)) {
      const contents: (TextPart | ImagePart | FilePart)[] = [];
      if (content.length) {
        contents.push({ type: 'text', text: content });
      }

      if (withAttachment) {
        for (let attachment of attachments) {
          let mediaType: string;
          if (typeof attachment === 'string') {
            mediaType =
              typeof mimetype === 'string'
                ? mimetype
                : await inferMimeType(attachment);
          } else {
            ({ attachment, mimeType: mediaType } = attachment);
          }
          if (SIMPLE_IMAGE_URL_REGEX.test(attachment)) {
            const data =
              attachment.startsWith('data:') || useBase64Attachment
                ? await fetch(attachment).then(r => r.arrayBuffer())
                : new URL(attachment);
            if (mediaType.startsWith('image/')) {
              contents.push({ type: 'image', image: data, mediaType });
            } else {
              contents.push({ type: 'file' as const, data, mediaType });
            }
          }
        }
      } else if (!content.length) {
        // temp fix for pplx
        contents.push({ type: 'text', text: '[no content]' });
      }

      msgs.push({ role, content: contents } as ChatMessage);
    } else {
      msgs.push({ role, content });
    }
  }

  return [system?.content, msgs, schema];
}

export function imageToUrl(image: DataContent | URL): string | undefined {
  if (typeof image === 'string') {
    return image;
  } else if (image instanceof URL) {
    return image.toString();
  } else if (image instanceof ArrayBuffer) {
    return `data:image/png;base64,${Buffer.from(image).toString('base64')}`;
  }
  return;
}

// pattern types the callback will receive
type Pattern =
  | { kind: 'index'; value: number } // [123]
  | { kind: 'link'; text: string; url: string } // [text](url)
  | { kind: 'wrappedLink'; text: string; url: string }; // ([text](url))

type NeedMore = { kind: 'needMore' };
type Failed = { kind: 'fail'; nextPos: number };
type Finished =
  | { kind: 'ok'; endPos: number; text: string; url: string }
  | { kind: 'index'; endPos: number; value: number };
type ParseStatus = Finished | NeedMore | Failed;

type PatternCallback = (m: Pattern) => string;

export class StreamPatternParser {
  #buffer = '';

  constructor(private readonly callback: PatternCallback) {}

  write(chunk: string): string {
    this.#buffer += chunk;
    const output: string[] = [];
    let i = 0;

    while (i < this.#buffer.length) {
      const ch = this.#buffer[i];

      //  [[[number]]] or [text](url) or ([text](url))
      if (ch === '[' || (ch === '(' && this.peek(i + 1) === '[')) {
        const isWrapped = ch === '(';
        const startPos = isWrapped ? i + 1 : i;
        const res = this.tryParse(startPos);
        if (res.kind === 'needMore') break;
        const { output: out, nextPos } = this.handlePattern(
          res,
          isWrapped,
          startPos,
          i
        );
        output.push(out);
        i = nextPos;
        continue;
      }
      output.push(ch);
      i += 1;
    }

    this.#buffer = this.#buffer.slice(i);
    return output.join('');
  }

  end(): string {
    const rest = this.#buffer;
    this.#buffer = '';
    return rest;
  }

  // =========== helpers ===========

  private peek(pos: number): string | undefined {
    return pos < this.#buffer.length ? this.#buffer[pos] : undefined;
  }

  private tryParse(pos: number): ParseStatus {
    const nestedRes = this.tryParseNestedIndex(pos);
    if (nestedRes) return nestedRes;
    return this.tryParseBracketPattern(pos);
  }

  private tryParseNestedIndex(pos: number): ParseStatus | null {
    if (this.peek(pos + 1) !== '[') return null;

    let i = pos;
    let bracketCount = 0;

    while (i < this.#buffer.length && this.#buffer[i] === '[') {
      bracketCount++;
      i++;
    }

    if (bracketCount >= 2) {
      if (i >= this.#buffer.length) {
        return { kind: 'needMore' };
      }

      let content = '';
      while (i < this.#buffer.length && this.#buffer[i] !== ']') {
        content += this.#buffer[i++];
      }

      let rightBracketCount = 0;
      while (i < this.#buffer.length && this.#buffer[i] === ']') {
        rightBracketCount++;
        i++;
      }

      if (i >= this.#buffer.length && rightBracketCount < bracketCount) {
        return { kind: 'needMore' };
      }

      if (
        rightBracketCount === bracketCount &&
        content.length > 0 &&
        this.isNumeric(content)
      ) {
        if (this.peek(i) === '(') {
          return { kind: 'fail', nextPos: i };
        }
        return { kind: 'index', endPos: i, value: Number(content) };
      }
    }

    return null;
  }

  private tryParseBracketPattern(pos: number): ParseStatus {
    let i = pos + 1; // skip '['
    if (i >= this.#buffer.length) {
      return { kind: 'needMore' };
    }

    let content = '';
    while (i < this.#buffer.length && this.#buffer[i] !== ']') {
      const nextChar = this.#buffer[i];
      if (nextChar === '[') {
        return { kind: 'fail', nextPos: i };
      }
      content += nextChar;
      i += 1;
    }

    if (i >= this.#buffer.length) {
      return { kind: 'needMore' };
    }
    const after = i + 1;
    const afterChar = this.peek(after);

    if (content.length > 0 && this.isNumeric(content) && afterChar !== '(') {
      // [number] pattern
      return { kind: 'index', endPos: after, value: Number(content) };
    } else if (afterChar !== '(') {
      // [text](url) pattern
      return { kind: 'fail', nextPos: after };
    }

    i = after + 1; // skip '('
    if (i >= this.#buffer.length) {
      return { kind: 'needMore' };
    }

    let url = '';
    while (i < this.#buffer.length && this.#buffer[i] !== ')') {
      url += this.#buffer[i++];
    }
    if (i >= this.#buffer.length) {
      return { kind: 'needMore' };
    }
    return { kind: 'ok', endPos: i + 1, text: content, url };
  }

  private isNumeric(str: string): boolean {
    return !Number.isNaN(Number(str)) && str.trim() !== '';
  }

  private handlePattern(
    pattern: Finished | Failed,
    isWrapped: boolean,
    start: number,
    current: number
  ): { output: string; nextPos: number } {
    if (pattern.kind === 'fail') {
      return {
        output: this.#buffer.slice(current, pattern.nextPos),
        nextPos: pattern.nextPos,
      };
    }

    if (isWrapped) {
      const afterLinkPos = pattern.endPos;
      if (this.peek(afterLinkPos) !== ')') {
        if (afterLinkPos >= this.#buffer.length) {
          return { output: '', nextPos: current };
        }
        return { output: '(', nextPos: start };
      }

      const out =
        pattern.kind === 'index'
          ? this.callback({ ...pattern, kind: 'index' })
          : this.callback({ ...pattern, kind: 'wrappedLink' });
      return { output: out, nextPos: afterLinkPos + 1 };
    } else {
      const out =
        pattern.kind === 'ok'
          ? this.callback({ ...pattern, kind: 'link' })
          : this.callback({ ...pattern, kind: 'index' });
      return { output: out, nextPos: pattern.endPos };
    }
  }
}

export class CitationParser {
  private readonly citations: string[] = [];

  private readonly parser = new StreamPatternParser(p => {
    switch (p.kind) {
      case 'index': {
        if (p.value <= this.citations.length) {
          return `[^${p.value}]`;
        }
        return `[${p.value}]`;
      }
      case 'wrappedLink': {
        const index = this.citations.indexOf(p.url);
        if (index === -1) {
          this.citations.push(p.url);
          return `[^${this.citations.length}]`;
        }
        return `[^${index + 1}]`;
      }
      case 'link': {
        return `[${p.text}](${p.url})`;
      }
    }
  });

  public push(citation: string) {
    this.citations.push(citation);
  }

  public parse(content: string) {
    return this.parser.write(content);
  }

  public end() {
    return this.parser.end() + '\n' + this.getFootnotes();
  }

  private getFootnotes() {
    const footnotes = this.citations.map((citation, index) => {
      return `[^${index + 1}]: {"type":"url","url":"${encodeURIComponent(
        citation
      )}"}`;
    });
    return footnotes.join('\n');
  }
}

export abstract class BaseStreamParser<T> {
  protected readonly startTime: number;
  protected isFinished = false;

  constructor(protected readonly modelId: string) {
    this.startTime = Date.now();
  }

  async handleFinish(usage?: PromiseLike<LanguageModelUsage>): Promise<void> {
    if (this.isFinished) return;
    this.isFinished = true;
    const tracker = TokenTracker.getCurrentTracker();
    if (!tracker) return;

    const endTime = Date.now();
    const duration = endTime - this.startTime;
    const step = tracker.getStepName();

    if (usage) {
      try {
        const resolvedUsage = await usage;
        if (resolvedUsage) {
          const tokenUsage = {
            inputTokens: resolvedUsage.inputTokens || 0,
            outputTokens: resolvedUsage.outputTokens || 0,
            reasoningTokens: resolvedUsage.outputTokenDetails?.reasoningTokens || undefined,
            totalTokens:
              (resolvedUsage.inputTokens || 0) +
              (resolvedUsage.outputTokens || 0),
            totalWithReasoning: resolvedUsage.totalTokens || undefined,
          };

          tracker.recordUsage(step, this.modelId, duration, tokenUsage);
        }
      } catch {
        // Fallback to duration-only tracking if usage fails
        this.recordFallbackUsage(step, duration);
      }
    } else {
      this.recordFallbackUsage(step, duration);
    }
  }

  handleError(): void {
    if (this.isFinished) return;
    this.isFinished = true;
    const tracker = TokenTracker.getCurrentTracker();
    if (!tracker) return;

    const endTime = Date.now();
    const duration = endTime - this.startTime;
    const step = tracker.getStepName();

    this.recordFallbackUsage(step, duration);
  }

  private recordFallbackUsage(step: string, duration: number): void {
    const tracker = TokenTracker.getCurrentTracker();
    if (!tracker) return;
    tracker.recordUsage(step, this.modelId, duration);
  }

  abstract parse(chunk: any): T | null;
}

type ChunkType = TextStreamPart<CustomAITools>['type'];

export function toError(error: unknown): Error {
  if (typeof error === 'string') {
    return new Error(error);
  } else if (error instanceof Error) {
    return error;
  } else if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error
  ) {
    return new Error(String(error.message));
  } else {
    return new Error(JSON.stringify(error));
  }
}

type DocEditFootnote = {
  intent: string;
  result: string;
};
export class TextStreamParser extends BaseStreamParser<string> {
  private readonly logger = new Logger(TextStreamParser.name);
  private readonly CALLOUT_PREFIX = '\n[!]\n';

  private lastType: ChunkType | undefined;

  private prefix: string | null = this.CALLOUT_PREFIX;

  private readonly docEditFootnotes: DocEditFootnote[] = [];

  public parse(chunk: TextStreamPart<CustomAITools> | StreamObjectToolResult) {
    let result = '';
    switch (chunk.type) {
      case 'text-delta': {
        if (!this.prefix) {
          this.resetPrefix();
        }
        result = chunk.text;
        result = this.addNewline(chunk.type, result);
        break;
      }
      case 'reasoning-delta': {
        result = chunk.text;
        result = this.addPrefix(result);
        result = this.markAsCallout(result);
        break;
      }
      case 'tool-call': {
        this.logger.debug(
          `[tool-call] toolName: ${chunk.toolName}, toolCallId: ${chunk.toolCallId}`
        );
        result = this.addPrefix(result);
        switch (chunk.toolName) {
          case 'conversation_summary': {
            result += `\nSummarizing context\n`;
            break;
          }
          case 'web_search_cloudsway':
          case 'web_search_exa': {
            result += `\nSearching the web "${chunk.input.query}"\n`;
            break;
          }
          case 'web_crawl_cloudsway':
          case 'web_crawl_exa': {
            result += `\nCrawling the web "${chunk.input.url}"\n`;
            break;
          }
          case 'doc_keyword_search': {
            result += `\nSearching the keyword "${chunk.input.query}"\n`;
            break;
          }
          case 'doc_read': {
            result += `\nReading the doc "${chunk.input.doc_id}"\n`;
            break;
          }
          case 'doc_compose': {
            result += `\nWriting document "${chunk.input.title}"\n`;
            break;
          }
          case 'doc_edit': {
            this.docEditFootnotes.push({
              intent: chunk.input.instructions,
              result: '',
            });
            break;
          }
          case 'make_it_real': {
            result += `\nImprove document with make it real\n`;
            break;
          }
          case 'python_coding': {
            result += `\nGenerating python code\n`;
            break;
          }
          case 'e2b_python_sandbox': {
            result += `\nExecuting python code in sandbox\n`;
            break;
          }
        }
        result = this.markAsCallout(result);
        break;
      }
      case 'tool-result': {
        this.logger.debug(
          `[tool-result] toolName: ${chunk.toolName}, toolCallId: ${chunk.toolCallId}`
        );
        result = this.addPrefix(result);
        switch (chunk.toolName) {
          case 'doc_semantic_search': {
            const output = chunk.output;
            if (Array.isArray(output)) {
              result += `\nFound ${output.length} document${output.length !== 1 ? 's' : ''} related to “${chunk.input.query}”.\n`;
            } else if (typeof output === 'string') {
              result += `\n${output}\n`;
            } else {
              this.logger.warn(
                `Unexpected result type for doc_semantic_search: ${output?.message || 'Unknown error'}`
              );
            }
            break;
          }
          case 'doc_compose': {
            const output = chunk.output;
            if (output && typeof output === 'object' && 'title' in output) {
              result += `\nDocument "${output.title}" created successfully with ${output.wordCount} words.\n`;
            }
            break;
          }
          case 'web_search_cloudsway':
          case 'web_search_exa': {
            const output = chunk.output;
            if (Array.isArray(output)) {
              result += `\n${this.getWebSearchLinks(output)}\n`;
            }
            break;
          }
          case 'make_it_real': {
            if (
              chunk.output &&
              typeof chunk.output === 'object' &&
              'content' in chunk.output
            ) {
              result += `\n${chunk.output.content}\n`;
            }
            break;
          }
          case 'python_coding': {
            if (chunk.output && typeof chunk.output === 'string') {
              result += `\n${chunk.output}\n`;
            }
            break;
          }
          case 'e2b_python_sandbox': {
            break;
          }
        }
        result = this.markAsCallout(result);
        break;
      }
      case 'error': {
        throw toError(chunk.error);
      }
    }
    if (chunk.type !== 'tool-incomplete-result') {
      this.lastType = chunk.type;
    }
    return result;
  }

  public end(): string {
    const footnotes = this.docEditFootnotes.map((footnote, index) => {
      return `[^edit${index + 1}]: ${JSON.stringify({ type: 'doc-edit', ...footnote })}`;
    });
    return footnotes.join('\n');
  }

  private addPrefix(text: string) {
    if (this.prefix) {
      const result = this.prefix + text;
      this.prefix = null;
      return result;
    }
    return text;
  }

  private resetPrefix() {
    this.prefix = this.CALLOUT_PREFIX;
  }

  private addNewline(chunkType: ChunkType, result: string) {
    if (this.lastType && this.lastType !== chunkType) {
      return '\n\n' + result;
    }
    return result;
  }

  private markAsCallout(text: string) {
    return text.replaceAll('\n', '\n> ');
  }

  private getWebSearchLinks(
    list: {
      title: string | null;
      url: string;
    }[]
  ): string {
    const links = list.reduce((acc, result) => {
      return acc + `\n\n[${result.title ?? result.url}](${result.url})\n\n`;
    }, '');
    return links;
  }
}

export class StreamObjectParser extends BaseStreamParser<StreamObject> {
  private readonly logger = new Logger(StreamObjectParser.name);
  private lastSummary: StreamObject | null = null;

  constructor(
    modelId: string,
    private readonly moduleRef?: ModuleRef
  ) {
    super(modelId);
  }

  public parse(
    chunk: TextStreamPart<CustomAITools> | StreamObjectToolResult
  ): StreamObject | null {
    switch (chunk.type) {
      case 'reasoning-delta': {
        return { type: 'reasoning' as const, textDelta: chunk.text };
      }
      case 'text-delta': {
        const { type, text: textDelta } = chunk;
        return { type, textDelta };
      }
      case 'tool-call':
      case 'tool-incomplete-result':
      case 'tool-result': {
        const { type, toolCallId, toolName, input: args } = chunk;
        const result = 'output' in chunk ? chunk.output : undefined;
        return { type, toolCallId, toolName, args, result } as StreamObject;
      }
      case 'error': {
        throw toError(chunk.error);
      }
      default: {
        return null;
      }
    }
  }

  public async mergeTextDelta(chunks: StreamObject[]): Promise<StreamObject[]> {
    const objects = chunks.reduce((acc, curr) => {
      const prev = acc.at(-1);
      switch (curr.type) {
        case 'reasoning':
        case 'text-delta': {
          if (prev && prev.type === curr.type) {
            prev.textDelta += curr.textDelta;
          } else {
            acc.push(curr);
          }
          break;
        }
        case 'tool-result': {
          const index = acc.findIndex(
            item =>
              item.type === 'tool-call' &&
              item.toolCallId === curr.toolCallId &&
              item.toolName === curr.toolName
          );
          if (index !== -1) {
            acc[index] = curr;
          } else {
            acc.push(curr);
          }
          break;
        }
        default: {
          acc.push(curr);
          break;
        }
      }
      return acc;
    }, [] as StreamObject[]);
    objects.push(await this.statusStreamObject());
    return objects;
  }

  public mergeContent(chunks: StreamObject[]): string {
    return chunks.reduce((acc, curr) => {
      if (curr.type === 'text-delta') {
        acc += curr.textDelta;
      }
      return acc;
    }, '');
  }

  private async chatWithPrompt(
    promptName: string,
    content: string
  ): Promise<string | null> {
    if (!this.moduleRef) return null;
    const promptService = this.moduleRef.get(PromptService, { strict: false });
    const providerFactory = this.moduleRef.get(CopilotProviderFactory, {
      strict: false,
    });
    const prompt = await promptService.get(promptName);
    if (!prompt) return null;
    const cond = { modelId: prompt.model };
    const provider = await providerFactory.getProvider(cond);
    if (!provider) return null;

    return await provider.text(
      cond,
      [...prompt.finish({ content })],
      Object.assign({}, prompt.config)
    );
  }

  private async summaryUsage(
    total: TokenUsageTotal | undefined,
    steps: TokenUsageDetail[] | undefined
  ): Promise<TokenSummary | null> {
    if (!total || !steps) {
      return null;
    }

    try {
      const map = new Map<string, TokenSummary['report'][number]>(); // key = model, val = agg object
      const defaultObj = {
        processed: 0,
        generated: 0,
        calls: 0,
        timeTaken: 0,
      };
      for (const r of steps) {
        const key = r.model;
        if (!map.has(key)) {
          map.set(key, { model: key, ...defaultObj });
        }
        // oxlint-disable-next-line typescript-eslint(no-non-null-assertion)
        const agg = map.get(key)!;
        agg.calls += 1;
        agg.timeTaken += r.duration;

        if (r.usage) {
          agg.processed += r.usage.inputTokens ?? 0;
          agg.generated += r.usage.outputTokens ?? 0;
        }
      }
      const report = [...map.values()].map(it => ({
        ...it,
        timeTaken: Number((it.timeTaken / 1000).toFixed(1)), // ms→s
      }));
      const overview = await this.chatWithPrompt(
        'Summarize the token usage',
        JSON.stringify(report)
      );
      if (overview) {
        return { overview, report };
      } else {
        const { inputTokens, outputTokens, timing } = total;
        const durationSec = timing.duration / 1000;
        const overview =
          `In this task, the system processed about ${inputTokens.toLocaleString()} ` +
          `tokens of input and produced roughly ${outputTokens.toLocaleString()} ` +
          `tokens of output in ${durationSec.toFixed(1)} seconds, ` +
          `spread across ${timing.callCount} model/tool calls.`;
        return { overview, report };
      }
    } catch (e) {
      this.logger.error('Failed to get module references', e);

      return null;
    }
  }

  public async statusStreamObject(): Promise<StreamObject> {
    if (this.lastSummary) return this.lastSummary;
    const tracker = TokenTracker.getCurrentTracker();
    const tokenUsage = tracker?.getTotalUsage();
    const records = tracker?.getCurrentUsages();
    const summary = await this.summaryUsage(tokenUsage, records);
    const statusObject = {
      type: 'status' as const,
      result: {
        completed: !!tokenUsage && !!records,
        summary: summary || undefined,
        tokenUsage,
        records,
      },
    };
    this.lastSummary = statusObject;
    return statusObject;
  }
}

export const VertexModelListSchema = z.object({
  publisherModels: z.array(
    z.object({
      name: z.string(),
      versionId: z.string(),
    })
  ),
});

export async function getGoogleAuth(
  options: GoogleVertexAnthropicProviderSettings | GoogleVertexProviderSettings,
  publisher: 'anthropic' | 'google'
) {
  function getBaseUrl() {
    const { baseURL, location } = options;
    if (baseURL?.trim()) {
      try {
        const url = new URL(baseURL);
        if (url.pathname.endsWith('/')) {
          url.pathname = url.pathname.slice(0, -1);
        }
        return url.toString();
      } catch {}
    } else if (location) {
      return `https://${location}-aiplatform.googleapis.com/v1beta1/publishers/${publisher}`;
    }
    return undefined;
  }

  async function generateAuthToken() {
    if (!options.googleAuthOptions) {
      return undefined;
    }
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      ...(options.googleAuthOptions as GoogleAuthOptions),
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token;
  }

  const token = await generateAuthToken();

  return {
    baseUrl: getBaseUrl(),
    headers: token ? () => ({ Authorization: `Bearer ${token}` }) : undefined,
    fetch: options.fetch,
  };
}
