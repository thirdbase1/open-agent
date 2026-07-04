import { z } from 'zod';
import { Config } from '../../../base';
import { toolError } from './error';
import { createTool } from './utils';
const BASE = 'https://api.firecrawl.dev';
export const createFirecrawlTool = (config: Config) =>
  createTool({ toolName: 'web_crawl_firecrawl' }, {
    description: 'Scrape/crawl a URL with Firecrawl. Returns markdown, HTML, screenshots, or links.',
    inputSchema: z.object({ url: z.string().url(), formats: z.array(z.string()).default(['markdown']), onlyMainContent: z.boolean().default(true) }),
    execute: async ({ url, formats, onlyMainContent }) => {
      try {
        const key = config.copilot.firecrawl.key;
        const res = await fetch(BASE + '/v2/scrape', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ url, formats, onlyMainContent }) });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
      } catch (e: any) { return toolError('Firecrawl Failed', e.message); }
    },
  });
