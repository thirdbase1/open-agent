import { WebIcon } from '@blocksuite/icons/rc';
import { useMemo } from 'react';

import { GenericToolResult } from './generic-tool-result';
import { toolResult } from './tool.css';

interface WebSearchResultProps {
  /** The search results from web_search_parallel / web_extract_parallel / web_crawl_firecrawl tool */
  results: any[];
  /** Query that was searched */
  query?: string;
}

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  favicon?: string;
  content?: string;
}

export const useWebResult = (results: any[]) => {
  const searchResults: SearchResult[] = useMemo(() => {
    if (!Array.isArray(results)) return [];
    return results.map(result => ({
      title: result.title || result.name || 'Untitled',
      url: result.url || result.link || '#',
      snippet: result.snippet || result.description || result.text || '',
      content: result.content || result.body || result.fullText || '',
      favicon:
        result.favicon ||
        (() => {
          try {
            const domain = new URL(result.url || 'https://example.com')
              .hostname;
            return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
          } catch {
            return undefined;
          }
        })(),
    }));
  }, [results]);

  const resultCount = searchResults.length;

  const content =
    searchResults.length > 0 ? (
      <div className="py-3 px-4.5 max-h-150 overflow-y-auto">
        {searchResults.map((result, index) => (
          <div key={index} className="flex items-start gap-3 rounded">
            {/* Favicon */}
            <div className="flex-shrink-0 mt-0.5 h-4 flex items-center">
              {result.favicon ? (
                <img
                  src={result.favicon}
                  alt=""
                  className="w-4 h-4"
                  onError={e => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              ) : (
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  <path d="M2 12h20" />
                </svg>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate mb-2">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-blue-600 transition-colors"
                >
                  {result.title}
                </a>
              </div>
              {result.snippet && (
                <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                  {result.snippet}
                </p>
              )}
              {result.content && (
                <div className="p-2 bg-gray-50 rounded text-xs text-gray-700 max-h-32 overflow-y-auto">
                  <div className="whitespace-pre-wrap line-clamp-6">
                    {result.content.length > 500
                      ? result.content.substring(0, 500) + '...'
                      : result.content}
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1 truncate">
                {result.url}
              </p>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="p-3 text-sm text-gray-500 text-center">
        No search results found.
      </div>
    );

  return {
    resultCount,
    content,
  };
};

/**
 * Specialized UI component for displaying web_search_parallel / web_extract_parallel / web_crawl_firecrawl tool results.
 * Shows a collapsible card with search completion status and expandable results list.
 */
export function WebSearchResult({ results }: WebSearchResultProps) {
  // Parse results to extract relevant information (memoized to avoid re-computation on unrelated re-renders)
  const { resultCount, content } = useWebResult(results);

  return (
    <GenericToolResult
      icon={<WebIcon />}
      title={'The search is complete, and these webpages have been searched'}
      count={resultCount}
      className={toolResult}
    >
      {content}
    </GenericToolResult>
  );
}
