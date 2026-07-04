import { generateText } from 'ai';
import { z } from 'zod';

import { toolError } from './error';
import { createTool } from './utils';

// Content Writer — generate marketing, blog, social media, and email content.

const CONTENT_TYPES = [
  'blog_post',
  'social_media',
  'email',
  'newsletter',
  'press_release',
  'product_description',
  'ad_copy',
  'landing_page',
  'video_script',
  'podcast_script',
  'whitepaper',
  'case_study',
] as const;

export const createContentWriterTool = () =>
  createTool(
    { toolName: 'content_writer' },
    {
      description:
        'Generate professional content for marketing, blogs, social media, ' +
        'emails, and more. ' +
        `Content types: ${CONTENT_TYPES.join(', ')}. ` +
        'Specify tone, target audience, and key points for best results.',
      inputSchema: z.object({
        content_type: z
          .enum(CONTENT_TYPES)
          .describe('Type of content to generate'),
        topic: z.string().min(1).describe('Main topic or subject'),
        tone: z
          .string()
          .optional()
          .describe(
            'Tone (e.g. "professional", "casual", "persuasive", "informative")'
          ),
        audience: z
          .string()
          .optional()
          .describe(
            'Target audience (e.g. "developers", "marketers", "general public")'
          ),
        key_points: z
          .array(z.string())
          .optional()
          .describe('Key points to include'),
        length: z
          .enum(['short', 'medium', 'long'])
          .optional()
          .describe('Content length (default: medium)'),
      }),
      execute: async ({
        content_type,
        topic,
        tone,
        audience,
        key_points,
        length,
      }) => {
        try {
          const lenMap = {
            short: '200-400 words',
            medium: '500-800 words',
            long: '1000-2000 words',
          };
          const targetLength = lenMap[length || 'medium'];

          const systemPrompt = `You are an expert content writer specializing in ${content_type.replace(/_/g, ' ')}.
Write ${targetLength} of content about "${topic}".
Tone: ${tone || 'professional'}
Audience: ${audience || 'general audience'}
${key_points?.length ? `Key points to cover: ${key_points.join(', ')}` : ''}

Format the content with proper headings, paragraphs, and structure.
Make it engaging, original, and ready to publish.`;

          const { text: content } = await generateText({
            model: 'anthropic/claude-sonnet-4-5-20250514',
            system: systemPrompt,
            prompt: `Write a ${content_type.replace(/_/g, ' ')} about: ${topic}`,
            temperature: 0.7,
            maxOutputTokens: 4096,
          });

          return {
            result: content.trim(),
            content_type,
            topic,
            tone: tone || 'professional',
            word_count: content.trim().split(/\s+/).length,
          };
        } catch (e: any) {
          return toolError(
            `Content generation failed: ${e?.message || 'unknown error'}`,
            `Type: ${content_type}, Topic: ${topic}`
          );
        }
      },
    }
  );
