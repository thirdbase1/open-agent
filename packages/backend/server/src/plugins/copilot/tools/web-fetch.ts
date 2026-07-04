import { z } from 'zod';
import { toolError } from './error';
import { createTool } from './utils';

// Web Fetch — lightweight URL fetcher that doesn't need a browser or external API.
// Uses Node's built-in fetch to retrieve page content, extract text, and return
// markdown-friendly output. Great for reading docs, APIs, and static pages
// without spinning up a sandbox or calling a paid API.

function htmlToText(html: string): string {
  return html
    // Remove script/style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    // Convert common elements to markdown
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gis, '\n$1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>(.*?)<\/pre>/gis, '\n```\n$1\n```\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Clean up whitespace
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const createWebFetchTool = () =>
  createTool({ toolName: 'web_fetch' }, {
    description:
      'Fetch a URL and return its content as clean text or markdown. ' +
      'No external API needed — uses built-in HTTP client. ' +
      'Faster than browser automation for reading static pages, docs, and APIs. ' +
      'Returns up to 50KB of text content.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to fetch'),
      format: z.enum(['text', 'markdown', 'html', 'json']).default('markdown').describe(
        'Output format: text (plain), markdown (HTML→MD), html (raw), json (parse as JSON)'
      ),
      maxBytes: z.number().default(50000).describe('Maximum bytes to return (default 50KB)'),
    }),
    execute: async ({ url, format, maxBytes }) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'OpenAgent/1.0 (compatible; AI assistant)',
            'Accept': format === 'markdown' ? 'text/markdown, text/html, */*' : '*/*',
          },
        });
        clearTimeout(timeout);

        if (!res.ok) {
          return toolError(
            `Fetch failed: ${res.status} ${res.statusText}`,
            `URL: ${url}`
          );
        }

        const contentType = res.headers.get('content-type') || '';
        const raw = await res.text();

        if (format === 'json' || contentType.includes('application/json')) {
          try {
            const data = JSON.parse(raw);
            return { json: data, url, contentType };
          } catch {
            return toolError('JSON parse failed', raw.slice(0, 500));
          }
        }

        if (format === 'html') {
          return { html: raw.slice(0, maxBytes), url, contentType };
        }

        if (format === 'text' || !contentType.includes('text/html')) {
          return { text: raw.slice(0, maxBytes), url, contentType };
        }

        // markdown format — convert HTML to markdown
        const md = htmlToText(raw);
        return { markdown: md.slice(0, maxBytes), url, contentType };
      } catch (e: any) {
        if (e.name === 'AbortError') {
          return toolError('Fetch timed out (30s)', url);
        }
        return toolError('Web fetch failed', e?.message || String(e));
      }
    },
  });
