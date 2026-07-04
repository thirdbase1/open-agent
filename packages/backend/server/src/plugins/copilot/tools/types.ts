import { ToolSet } from 'ai';

import type { createAgentBrowserTool } from './agent-browser';
import type { createChooseTool } from './choose';
import type { createCodeArtifactTool } from './code-artifact';
import type { createConversationSummaryTool } from './conversation-summary';
import type { createDocComposeTool } from './doc-compose';
import type { createDocSemanticSearchTool } from './doc-semantic-search';
import type { createFirecrawlTool } from './firecrawl';
import type { createParallelExtractTool, createParallelSearchTool } from './parallel-search';
import type { createVercelPythonSandboxTool } from './vercel-python-sandbox';
import type { createMakeItRealTool } from './make-it-real';
import type { createPythonCodingTool } from './python-coding';
import type { createTaskAnalysisTool } from './task-analysis';
import type { createMarkTodoTool, createTodoTool } from './todo';

export interface CustomAITools extends ToolSet {
  agent_browser: ReturnType<typeof createAgentBrowserTool>;
  choose: ReturnType<typeof createChooseTool>;
  code_artifact: ReturnType<typeof createCodeArtifactTool>;
  conversation_summary: ReturnType<typeof createConversationSummaryTool>;
  doc_semantic_search: ReturnType<typeof createDocSemanticSearchTool>;
  doc_compose: ReturnType<typeof createDocComposeTool>;
  vercel_python_sandbox: ReturnType<typeof createVercelPythonSandboxTool>;
  web_search_parallel: ReturnType<typeof createParallelSearchTool>;
  web_extract_parallel: ReturnType<typeof createParallelExtractTool>;
  web_crawl_firecrawl: ReturnType<typeof createFirecrawlTool>;
  todo_list: ReturnType<typeof createTodoTool>;
  mark_todo: ReturnType<typeof createMarkTodoTool>;
  make_it_real: ReturnType<typeof createMakeItRealTool>;
  python_coding: ReturnType<typeof createPythonCodingTool>;
  python_sandbox: ReturnType<typeof createVercelPythonSandboxTool>;
  task_analysis: ReturnType<typeof createTaskAnalysisTool>;
}

export const Tools = [
  'agent_browser', 'choose', 'code_artifact', 'doc_compose', 'doc_semantic_search',
  'web_search_parallel', 'web_extract_parallel', 'web_crawl_firecrawl',
  'python_coding', 'vercel_python_sandbox', 'make_it_real',
  'conversation_summary', 'todo_list', 'mark_todo', 'task_analysis',
];
