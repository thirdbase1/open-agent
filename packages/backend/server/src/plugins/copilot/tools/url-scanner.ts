import { z } from 'zod';
import { createTool } from './utils';
import { toolError } from './error';

// URL Scanner — extract metadata, links, images, and structured data from a URL
// without launching a browser. Useful for SEO analysis, content auditing,
// and link checking.

interface LinkInfo {
  url: string;
  text: string;
  rel?: string;
}

interface ImageInfo {
  src: string;
  alt: string;
  width?: string;
  height?: string;
}

interface MetaInfo {
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;
  ogType?: string;
  twitterCard?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  canonical?: string;
  robots?: string;
  author?: string;
  keywords?: string;
  lang?: string;
  favicon?: string;
}

export const createUrlScannerTool = () =>
  createTool({ toolName: 'url_scanner' }, {
    description:
      'Scan a URL and extract metadata, links, images, and structured data. ' +
      'No browser needed — parses the HTML directly. ' +
      'Useful for SEO audits, content analysis, and link checking.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to scan'),
      extract: z.array(z.enum(['meta', 'links', 'images', 'headings', 'scripts', 'styles', 'jsonld'])).default(['meta', 'links', 'images', 'headings']).describe('What to extract'),
    }),
    execute: async ({ url, extract }) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'OpenAgent/1.0' },
        });
        clearTimeout(timeout);

        if (!res.ok) {
          return toolError(`Scan failed: ${res.status}`, url);
        }

        const html = await res.text();
        const result: Record<string, unknown> = { url, status: res.status };

        if (extract.includes('meta')) {
          const meta: MetaInfo = {
            title: html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim() || '',
            description: html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/is)?.[1] || '',
            ogTitle: html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/is)?.[1],
            ogDescription: html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/is)?.[1],
            ogImage: html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']*)["']/is)?.[1],
            ogUrl: html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']*)["']/is)?.[1],
            ogType: html.match(/<meta\s+property=["']og:type["']\s+content=["']([^"']*)["']/is)?.[1],
            twitterCard: html.match(/<meta\s+name=["']twitter:card["']\s+content=["']([^"']*)["']/is)?.[1],
            twitterTitle: html.match(/<meta\s+name=["']twitter:title["']\s+content=["']([^"']*)["']/is)?.[1],
            twitterDescription: html.match(/<meta\s+name=["']twitter:description["']\s+content=["']([^"']*)["']/is)?.[1],
            twitterImage: html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']*)["']/is)?.[1],
            canonical: html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/is)?.[1],
            robots: html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/is)?.[1],
            author: html.match(/<meta\s+name=["']author["']\s+content=["']([^"']*)["']/is)?.[1],
            keywords: html.match(/<meta\s+name=["']keywords["']\s+content=["']([^"']*)["']/is)?.[1],
            lang: html.match(/<html[^>]*lang=["']([^"']*)["']/is)?.[1],
            favicon: html.match(/<link\s+rel=["'](?:icon|shortcut icon|apple-touch-icon)["']\s+href=["']([^"']*)["']/is)?.[1],
          };
          result.meta = meta;
        }

        if (extract.includes('links')) {
          const linkRegex = /<a\s+[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gis;
          const links: LinkInfo[] = [];
          let match;
          while ((match = linkRegex.exec(html)) !== null && links.length < 200) {
            const rel = match[0].match(/rel=["']([^"']*)["']/i)?.[1];
            links.push({
              url: match[1],
              text: match[2].replace(/<[^>]+>/g, '').trim().slice(0, 100),
              rel,
            });
          }
          result.links = links;
          result.linkCount = links.length;
        }

        if (extract.includes('images')) {
          const imgRegex = /<img\s+[^>]*src=["']([^"']*)["'][^>]*>/gis;
          const images: ImageInfo[] = [];
          let match;
          while ((match = imgRegex.exec(html)) !== null && images.length < 100) {
            images.push({
              src: match[1],
              alt: match[0].match(/alt=["']([^"']*)["']/i)?.[1] || '',
              width: match[0].match(/width=["']([^"']*)["']/i)?.[1],
              height: match[0].match(/height=["']([^"']*)["']/i)?.[1],
            });
          }
          result.images = images;
          result.imageCount = images.length;
        }

        if (extract.includes('headings')) {
          const headings: { level: string; text: string }[] = [];
          for (let i = 1; i <= 6; i++) {
            const regex = new RegExp(`<h${i}[^>]*>(.*?)</h${i}>`, 'gis');
            let m;
            while ((m = regex.exec(html)) !== null) {
              headings.push({ level: `h${i}`, text: m[1].replace(/<[^>]+>/g, '').trim().slice(0, 200) });
            }
          }
          result.headings = headings;
        }

        if (extract.includes('scripts')) {
          const scripts = html.match(/<script\s+[^>]*src=["']([^"']*)["'][^>]*>/gi)?.map(s =>
            s.match(/src=["']([^"']*)["']/i)?.[1] || ''
          ).filter(Boolean) || [];
          result.scripts = scripts;
        }

        if (extract.includes('styles')) {
          const styles = html.match(/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']*)["'][^>]*>/gi)?.map(s =>
            s.match(/href=["']([^"']*)["']/i)?.[1] || ''
          ).filter(Boolean) || [];
          result.stylesheets = styles;
        }

        if (extract.includes('jsonld')) {
          const jsonLdMatches = html.match(/<script\s+type=["']application\/ld\+json["']>(.*?)<\/script>/gis);
          if (jsonLdMatches) {
            const jsonLd = jsonLdMatches.map(m => {
              try {
                return JSON.parse(m.replace(/<\/?script[^>]*>/gi, '').trim());
              } catch {
                return null;
              }
            }).filter(Boolean);
            result.jsonLd = jsonLd;
          }
        }

        result.contentSize = html.length;
        return result;
      } catch (e: any) {
        if (e.name === 'AbortError') return toolError('Scan timed out (20s)', url);
        return toolError('URL scan failed', e?.message || String(e));
      }
    },
  });
