import { generateText } from 'ai';
import { z } from 'zod';

import { toolError } from './error';
import { createTool } from './utils';

// Data Analyzer — analyze CSV/JSON data with natural language questions.
// Provides statistical summaries, trends, correlations, and insights.

export const createDataAnalyzerTool = () =>
  createTool(
    { toolName: 'data_analyzer' },
    {
      description:
        'Analyze CSV or JSON data with natural language questions. ' +
        'Provides statistical summaries, trends, correlations, and insights. ' +
        'Supports datasets up to ~50KB. ' +
        'Example: "What is the average revenue by quarter?" or "Find outliers in the data"',
      inputSchema: z.object({
        data: z.string().min(1).describe('CSV or JSON data to analyze'),
        question: z
          .string()
          .min(1)
          .describe(
            'What you want to know about the data (e.g. "Show summary statistics", "What are the trends?")'
          ),
        format: z
          .enum(['csv', 'json'])
          .optional()
          .describe('Data format (auto-detected if omitted)'),
      }),
      execute: async ({ data, question, format }) => {
        try {
          const detectedFormat =
            format ||
            (data.trim().startsWith('{') || data.trim().startsWith('[')
              ? 'json'
              : 'csv');
          const dataSize = data.length;

          if (dataSize > 50000) {
            return toolError(
              'Data too large (max 50KB). Please summarize or sample the data first.',
              `Size: ${dataSize} bytes`
            );
          }

          const systemPrompt = `You are a data analyst. Analyze the following ${detectedFormat.toUpperCase()} data and answer the user's question.

Provide:
1. Direct answer to the question
2. Key statistics (mean, median, min, max, std dev where applicable)
3. Notable patterns or trends
4. Any anomalies or outliers
5. Brief recommendation based on findings

Format the response clearly with sections and numbers. Be precise with calculations.

Data:
${data.slice(0, 40000)}`;

          const { text: analysis } = await generateText({
            model: 'anthropic/claude-sonnet-4-5-20250514',
            system: systemPrompt,
            prompt: question,
            temperature: 0.1,
            maxOutputTokens: 4096,
          });

          return {
            result: analysis.trim(),
            format: detectedFormat,
            data_size: dataSize,
            question,
          };
        } catch (e: any) {
          return toolError(
            `Data analysis failed: ${e?.message || 'unknown error'}`,
            `Question: ${question}`
          );
        }
      },
    }
  );
