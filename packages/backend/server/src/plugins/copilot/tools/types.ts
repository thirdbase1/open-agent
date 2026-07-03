import { ToolSet } from 'ai';

import type { createBrowserUseTool } from './browser-use';
import type { createChooseTool } from './choose';
import type { createCloudswayReadTool } from './cloudsway-read';
import type { createCloudswaySearchTool } from './cloudsway-search';
import type { createCodeArtifactTool } from './code-artifact';
import type { createConversationSummaryTool } from './conversation-summary';
import type { createDocComposeTool } from './doc-compose';
import type { createDocSemanticSearchTool } from './doc-semantic-search';
import type { createVercelPythonSandboxTool } from './vercel-python-sandbox';
import type { createExaCrawlTool } from './exa-crawl';
import type { createExaSearchTool } from './exa-search';
import type { createMakeItRealTool } from './make-it-real';
import type { createPythonCodingTool } from './python-coding';
import type { createTaskAnalysisTool } from './task-analysis';
import type { createMarkTodoTool, createTodoTool } from './todo';

export interface CustomAITools extends ToolSet {
  browser_use: ReturnType<typeof createBrowserUseTool>;
  choose: ReturnType<typeof createChooseTool>;
  code_artifact: ReturnType<typeof createCodeArtifactTool>;
  conversation_summary: ReturnType<typeof createConversationSummaryTool>;
  doc_semantic_search: ReturnType<typeof createDocSemanticSearchTool>;
  doc_compose: ReturnType<typeof createDocComposeTool>;
  vercel_python_sandbox: ReturnType<typeof createVercelPythonSandboxTool>;
  web_search_exa: ReturnType<typeof createExaSearchTool>;
  web_crawl_exa: ReturnType<typeof createExaCrawlTool>;
  web_search_cloudsway: ReturnType<typeof createCloudswaySearchTool>;
  web_crawl_cloudsway: ReturnType<typeof createCloudswayReadTool>;
  todo_list: ReturnType<typeof createTodoTool>;
  mark_todo: ReturnType<typeof createMarkTodoTool>;
  make_it_real: ReturnType<typeof createMakeItRealTool>;
  python_coding: ReturnType<typeof createPythonCodingTool>;
  python_sandbox: ReturnType<typeof createVercelPythonSandboxTool>;
  task_analysis: ReturnType<typeof createTaskAnalysisTool>;
}

export const Tools = [
  'browser_use',
  'choose',
  'code_artifact',
  'doc_compose',
  'doc_semantic_search',
  'web_search_cloudsway',
  'web_crawl_cloudsway',
  'web_search_exa',
  'web_crawl_exa',
  'python_coding',
  'vercel_python_sandbox',
  'make_it_real',
  'conversation_summary',
  'todo_list',
  'mark_todo',
  'task_analysis',
];
