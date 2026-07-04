import { generateText } from 'ai';
import { z } from 'zod';

import { toolError } from './error';
import { createTool } from './utils';

// Code Reviewer — analyze code for bugs, security issues, best practices.
// Returns a structured report with severity levels and suggested fixes.

export const createCodeReviewerTool = () =>
  createTool(
    { toolName: 'code_reviewer' },
    {
      description:
        'Review code for bugs, security vulnerabilities, performance issues, ' +
        'and best practices. Supports 20+ languages. ' +
        'Returns a structured report with severity levels, line references, ' +
        'and suggested fixes. Use this before deploying code or when debugging.',
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
      }),
      execute: async ({ code, language, focus }) => {
        try {
          const focusArea = focus || 'all';
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
            model: 'anthropic/claude-sonnet-4-5-20250514',
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
