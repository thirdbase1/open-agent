// oxlint-disable no-array-index-key
import { Loading } from '@afk/component';
import type { StreamObject } from '@afk/graphql';
import { CheckBoxCheckSolidIcon, EmbedWebIcon } from '@blocksuite/icons/rc';

import { MessageCard } from '@/components/ui/card/message-card';
import { TypeMarkdownText } from '@/components/ui/markdown';

import { AIReasoningCard } from './ai-reasoning-card';
import { BrowserUseResult, transformStep } from './browser-use-result';
import { ChooseResult } from './choose-result';
import { CodeArtifactResult } from './code-artifact-result';
import { E2bPythonResult } from './e2b-python-result';
import { GeneratingCard } from './generating-card';
import { GenericToolCalling } from './generic-tool-calling';
import { GenericToolResult } from './generic-tool-result';
import { MakeItRealResult } from './make-it-real-result';
import { PythonCodeResult } from './python-code-result';
import { TaskAnalysisCard } from './task-analysis-card';
import { TodoListResult } from './todo-list-result';
import { WebCrawlResult } from './web-crawl-result';
import { WebSearchResult } from './web-search-result';

interface ChatContentStreamObjectsProps {
  streamObjects: StreamObject[];
  isStreaming?: boolean;
  isAssistant?: boolean;
}

const speed = [3, 8];
/**
 * Basic renderer that converts server-side `streamObjects` into simple
 * React components, imitating the logic of the core Lit implementation.
 * – text-delta: rendered as Markdown
 * – reasoning: rendered as Markdown inside a grey box
 * – tool-call: placeholder card "🔧 Calling {toolName} …"
 * – tool-result: placeholder card with the result JSON
 */
export function ChatContentStreamObjects({
  streamObjects,
  isStreaming = false,
  isAssistant = false,
}: ChatContentStreamObjectsProps) {
  if (!streamObjects?.length) return null;

  return (
    <div className="flex flex-col gap-2 max-w-full text-left prose w-full">
      {streamObjects.map((obj, idx) => {
        const loading = isStreaming && idx === streamObjects.length - 1;
        const key = `${obj.toolCallId ?? obj.type}-${idx}`;
        switch (obj.type) {
          case 'text-delta': {
            return (
              <TypeMarkdownText
                key={key}
                text={obj.textDelta ?? ''}
                loading={loading}
                className={isAssistant ? 'min-w-full' : undefined}
                speed={speed}
              />
            );
          }

          case 'reasoning':
            return (
              <AIReasoningCard
                key={key}
                text={obj.textDelta ?? ''}
                loading={loading}
                className={isAssistant ? 'min-w-full' : undefined}
              />
            );

          case 'tool-call':
            if (
              obj.toolName === 'doc_compose' ||
              obj.toolName === 'make_it_real'
            ) {
              return (
                <GeneratingCard
                  key={key}
                  title={'Generating...'}
                  content={obj.textDelta ?? ''}
                  icon={<Loading />}
                />
              );
            }
            // Specialized handling for web_search placeholder
            if (
              ['web_search_parallel'].includes(
                obj.toolName ?? ''
              )
            ) {
              // Attempt to extract query from args (GraphQL returns JSON string or object)
              let query = undefined as string | undefined;
              if (typeof obj.args === 'string') {
                try {
                  const parsed = JSON.parse(obj.args);
                  query = parsed?.query ?? undefined;
                } catch {
                  // ignore
                }
              } else if (obj.args && typeof obj.args === 'object') {
                query = obj.args.query ?? undefined;
              }

              return (
                <GenericToolCalling
                  key={key}
                  title={
                    query
                      ? `Searching the web for "${query}"`
                      : 'Searching the web'
                  }
                />
              );
            }

            if (
              ['web_extract_parallel', 'web_crawl_firecrawl'].includes(
                obj.toolName ?? ''
              )
            ) {
              const url = obj.args?.url;
              return (
                <GenericToolCalling
                  key={key}
                  title={`Crawling "${url}"`}
                  icon={<EmbedWebIcon />}
                />
              );
            }

            if (obj.toolName === 'agent_browser' && obj.textDelta) {
              const result = transformStep(obj.textDelta as any);
              if (result) {
                return <BrowserUseResult key={key} result={result} />;
              } else {
                return 'Error';
              }
            }

            if (obj.toolName === 'python_coding') {
              return (
                <GeneratingCard
                  key={key}
                  title={'Coding...'}
                  content={obj.textDelta ?? ''}
                  icon={<Loading />}
                />
              );
            }
            if (obj.toolName === 'e2b_python_sandbox') {
              return (
                <GeneratingCard
                  key={key}
                  title={'Running python code...'}
                  content={obj.textDelta ?? ''}
                  icon={<Loading />}
                />
              );
            }

            return (
              <GenericToolCalling
                key={key}
                title={`Calling ${obj.toolName ?? 'tool'} …`}
              />
            );

          case 'tool-result': {
            if (obj.toolName === 'code_artifact' && obj.result) {
              return <CodeArtifactResult key={key} result={obj.result} />;
            }
            // Special handling for make_it_real tool
            if (obj.toolName === 'make_it_real' && obj.result) {
              return (
                <MakeItRealResult
                  key={key}
                  docId={obj.result.docId}
                  title={obj.result.title}
                />
              );
            }
            if (obj.toolName === 'doc_compose' && obj.result) {
              return (
                <MakeItRealResult
                  key={key}
                  docId={obj.result.docId}
                  title={obj.result.title}
                />
              );
            }

            // Special handling for web_search/web_crawl tool
            if (
              ['web_search_parallel'].includes(
                obj.toolName ?? ''
              ) &&
              obj.result
            ) {
              const results =
                obj.result.results || obj.result.data || obj.result;
              return (
                <WebSearchResult
                  key={key}
                  results={Array.isArray(results) ? results : [results]}
                  query={obj.result.query}
                />
              );
            }
            if (
              ['web_extract_parallel', 'web_crawl_firecrawl'].includes(
                obj.toolName ?? ''
              ) &&
              obj.result
            ) {
              const results =
                obj.result.results || obj.result.data || obj.result;
              return (
                <WebCrawlResult
                  key={key}
                  results={Array.isArray(results) ? results : [results]}
                />
              );
            }

            // Specialized handling for todo list
            if (
              ['todo_list', 'mark_todo'].includes(obj.toolName ?? '') &&
              obj.result?.list
            ) {
              return <TodoListResult key={key} result={obj.result as any} />;
            }

            if (obj.toolName === 'python_coding' && obj.result) {
              return <PythonCodeResult key={key} result={obj.result} />;
            }

            // Specialized handling for e2b python sandbox
            if (obj.toolName === 'e2b_python_sandbox' && obj.result) {
              return (
                <E2bPythonResult
                  key={key}
                  result={obj.result as unknown as any}
                />
              );
            }

            if (obj.toolName === 'agent_browser' && obj.result) {
              if (obj.result && typeof obj.result === 'object') {
                return (
                  <BrowserUseResult key={key} result={obj.result as any} />
                );
              }
              return (
                <MessageCard
                  key={key}
                  status="loading"
                  className="my-5"
                  title="Agent browser task processing..."
                />
              );
            }

            if (obj.toolName === 'task_analysis' && obj.result) {
              return (
                <TaskAnalysisCard
                  key={key}
                  reasoning={obj.result.reasoning}
                  suggestedApproach={obj.result.suggestedApproach}
                  complexity={obj.result.complexity as any}
                  estimatedSteps={obj.result.estimatedSteps as any}
                />
              );
            }

            if (obj.toolName === 'choose') {
              return <ChooseResult key={key} result={obj.result as any} />;
            }

            // Default tool result display

            return (
              <GenericToolResult
                key={key}
                icon={<CheckBoxCheckSolidIcon />}
                title={`${obj.toolName ?? 'Tool'} result`}
              >
                <pre className="whitespace-pre-wrap break-all text-xs max-h-48 overflow-auto">
                  {JSON.stringify(obj.result, null, 2)}
                </pre>
              </GenericToolResult>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}
