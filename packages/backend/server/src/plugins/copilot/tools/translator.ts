import { generateText } from 'ai';
import { z } from 'zod';

import { toolError } from './error';
import { createTool } from './utils';

// Translator — translate text between 30+ languages using AI Gateway models.

const LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Russian',
  'Chinese',
  'Japanese',
  'Korean',
  'Arabic',
  'Hindi',
  'Turkish',
  'Polish',
  'Swedish',
  'Norwegian',
  'Danish',
  'Finnish',
  'Czech',
  'Greek',
  'Hebrew',
  'Thai',
  'Vietnamese',
  'Indonesian',
  'Malay',
  'Filipino',
  'Ukrainian',
  'Romanian',
  'Bengali',
] as const;

export const createTranslatorTool = () =>
  createTool(
    { toolName: 'translator' },
    {
      description:
        'Translate text between any of 30+ supported languages. ' +
        'Automatically detects the source language if not specified. ' +
        'Preserves formatting, tone, and context. ' +
        `Supported languages: ${LANGUAGES.join(', ')}`,
      inputSchema: z.object({
        text: z.string().min(1).describe('The text to translate'),
        target_language: z
          .string()
          .describe('Target language (e.g. "Spanish", "Japanese", "French")'),
        source_language: z
          .string()
          .optional()
          .describe('Source language (auto-detected if omitted)'),
        context: z
          .string()
          .optional()
          .describe('Additional context to improve translation accuracy'),
      }),
      execute: async ({ text, target_language, source_language, context }) => {
        try {
          const systemPrompt = `You are a professional translator. Translate the given text to ${target_language}${
            source_language ? ` from ${source_language}` : ''
          }. Preserve formatting, tone, and meaning. Only output the translated text, nothing else.${
            context ? ` Context: ${context}` : ''
          }`;

          const { text: translated } = await generateText({
            model: 'google/gemini-2.5-flash',
            system: systemPrompt,
            prompt: text,
            temperature: 0.1,
          });

          return {
            result: translated.trim(),
            source_language: source_language || 'auto-detected',
            target_language,
            original_length: text.length,
            translated_length: translated.length,
          };
        } catch (e: any) {
          return toolError(
            `Translation failed: ${e?.message || 'unknown error'}`,
            `Target: ${target_language}`
          );
        }
      },
    }
  );
