import { z } from 'zod';
import { Config } from '../../../base';
import { toolError } from './error';
import { createTool } from './utils';

const BASE = 'https://api.parallel.ai';

export const createParallelSearchTool = (config: Config) =>
  createTool(
    { toolName: 'web_search_parallel' },
    {
      description: 'Search the live web with Parallel. Natural-language objective + 2-3 keyword queries. Returns citation-aware excerpts.',
      inputSchema: z.object({
        objective: z.string().describe('Research objective with key entity/topic'),
        search_queries: z.array(z.string()).min(2).max(3).describe('2-3 diverse keyword queries'),
      }),
      execute: async ({ objective, search_queries }) => {
        try {
          const key = config.copilot.parallel.key;
          const res = await fetch(`${BASE}/v1/search`, { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ objective, search_queries }) });
          if (!res.ok) throw new Error(await res.text());
          return await res.json();
        } catch (e: any) { return toolError('Parallel Search Failed', e.message); }
      },
    }
  );

export const createParallelExtractTool = (config: Config) =>
  createTool(
    { toolName: 'web_extract_parallel' },
    {
      description: 'Extract content from known URLs via Parallel Extract. Handles JS pages and PDFs.',
      inputSchema: z.object({ urls: z.array(z.string()).min(1).max(20), target_content: z.string().optional() }),
      execute: async ({ urls, target_content }) => {
        try {
          const key = config.copilot.parallel.key;
          const res = await fetch(`${BASE}/v1/extract`, { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ urls, objective: target_content }) });
          if (!res.ok) throw new Error(await res.text());
          return await res.json();
        } catch (e: any) { return toolError('Parallel Extract Failed', e.message); }
      },
    }
  );
