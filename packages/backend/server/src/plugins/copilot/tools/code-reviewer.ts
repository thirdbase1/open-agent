import { generateText } from 'ai';
import { z } from 'zod';

import { toolError } from './error';
import { createTool } from './utils';

// Code Reviewer — analyze code for bugs, security issues, best practices.
// Works with ANY capable text model from the gateway.

export const createCodeReviewerTool = () =>
  createTool(
    { toolName: 'code_reviewer' },
    {
      description:
        'Review code for bugs, security vulnerabilities, performance issues, ' +
        'and best practices. Supports 20+ languages. ' +
        'Returns a structured report with severity levels, line references, ' +
        'and suggested fixes. Pass any capable model ID. Defaults to a strong gateway model.',
      inputSchema: z.object({
        code: z.string().min(1).describe('The code to review'),
        language: z
          .string()
          .optional()
          .describe(
            'Programming language (e.g. "typescript", "python", "rust")'
          ),
        focus: z
          .enum(['security', 'performance', 'bugs', 'style', 'all'])
          .optional()
          .describe('Review focus area (default: all)'),
        model: z
          .string()
          .optional()
          .describe(
            'Any capable model ID from the gateway. If omitted, uses default.'
          ),
      }),
      execute: async ({ code, language, focus, model }) => {
        try {
          const focusArea = focus || 'all';
          const modelId = model || 'anthropic/claude-sonnet-4-5-20250514';

          const systemPrompt = `You are an expert code reviewer. Analyze the following ${language || ''} code for ${
            focusArea === 'all'
              ? 'bugs, security issues, performance problems, and style violations'
              : focusArea + ' issues'
          }.

Provide a structured review:
1. Summary: Brief overview of code quality
2. Issues Found: Each issue with severity [CRITICAL/HIGH/MEDIUM/LOW], line number, description, and fix
3. Positive Aspects: What's done well
4. Overall Score: X/10 with brief justification

Be thorough but concise. Only report real issues.`;

          const { text: review } = await generateText({
            model: modelId,
            system: systemPrompt,
            prompt: `\`\`\`${language || ''}
${code}
\`\`\``,
            temperature: 0.2,
            maxOutputTokens: 4096,
          });

          return {
            result: review.trim(),
            language: language || 'unknown',
            focus: focusArea,
            code_length: code.length,
            model_used: modelId,
          };
        } catch (e: any) {
          return toolError(
            `Code review failed: ${e?.message || 'unknown error'}`,
            `Language: ${language || 'unknown'}`
          );
        }
      },
    }
  );
