import { generateText } from 'ai';
import { z } from 'zod';

import { toolError } from './error';
import { createTool } from './utils';

// Document Summarizer — summarize long documents, articles, transcripts.
// Supports executive, bullet points, detailed, ELI5, and key takeaways styles.

export const createDocSummarizerTool = () =>
  createTool(
    { toolName: 'doc_summarizer' },
    {
      description:
        'Summarize long documents, articles, or text content. ' +
        'Provides executive summary, key points, and action items. ' +
        'Supports text up to ~100K characters. ' +
        'Use this for research papers, meeting transcripts, reports, etc.',
      inputSchema: z.object({
        content: z.string().min(100).describe('The document text to summarize'),
        style: z
          .enum([
            'executive',
            'bullet_points',
            'detailed',
            'eli5',
            'key_takeaways',
          ])
          .optional()
          .describe('Summary style (default: executive)'),
        max_length: z
          .number()
          .optional()
          .describe('Maximum summary length in words (default: 300)'),
      }),
      execute: async ({ content, style, max_length }) => {
        try {
          const summaryStyle = style || 'executive';
          const targetLength = max_length || 300;

          const stylePrompts: Record<string, string> = {
            executive: 'Write a concise executive summary in 1-2 paragraphs.',
            bullet_points:
              'Summarize as a list of key bullet points (8-15 points).',
            detailed:
              'Provide a detailed summary with sections and sub-points.',
            eli5: 'Explain the content as if talking to a 5-year-old. Simple words only.',
            key_takeaways:
              'List the top 5-10 key takeaways with brief explanations.',
          };

          const systemPrompt = `You are an expert document summarizer. ${stylePrompts[summaryStyle]}
Keep the summary under ${targetLength} words.
Focus on the most important information, key findings, and actionable insights.
Do not include filler or obvious statements.

Document to summarize:
${content.slice(0, 80000)}`;

          const { text: summary } = await generateText({
            model: 'google/gemini-2.5-flash',
            system: systemPrompt,
            prompt: `Summarize this document in "${summaryStyle}" style, max ${targetLength} words.`,
            temperature: 0.3,
            maxOutputTokens: 2048,
          });

          return {
            result: summary.trim(),
            style: summaryStyle,
            original_length: content.length,
            summary_length: summary.trim().split(/\s+/).length,
            compression_ratio:
              ((1 - summary.length / content.length) * 100).toFixed(1) + '%',
          };
        } catch (e: any) {
          return toolError(
            `Document summarization failed: ${e?.message || 'unknown error'}`,
            `Content length: ${content.length}`
          );
        }
      },
    }
  );
