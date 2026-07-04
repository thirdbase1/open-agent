import { generateText } from 'ai';
import { z } from 'zod';

import { toolError } from './error';
import { createTool } from './utils';

// Image Vision — analyze images using AI vision models.
// Works with ANY vision-capable model the user passes in.
// If no model specified, defaults to a gateway model.

export const createImageVisionTool = () =>
  createTool(
    { toolName: 'image_vision' },
    {
      description:
        'Analyze an image using AI vision. Provide an image URL and a question ' +
        'or instruction about what to extract or describe. ' +
        'Supports: OCR (text extraction), object detection, scene description, ' +
        'chart/diagram reading, code screenshot analysis. ' +
        'Pass any vision-capable model ID (e.g. "anthropic/claude-sonnet-4-5-20250514", ' +
        '"openai/gpt-4o", "google/gemini-2.5-flash"). Defaults to a capable gateway model.',
      inputSchema: z.object({
        image_url: z
          .string()
          .url()
          .describe('Public URL of the image to analyze'),
        instruction: z
          .string()
          .describe(
            'What to do with the image (e.g. "Extract all text", "Describe the scene", "What code is shown?")'
          ),
        model: z
          .string()
          .optional()
          .describe(
            'Any vision-capable model ID from the gateway (e.g. "anthropic/claude-sonnet-4-5-20250514", "openai/gpt-4o"). If omitted, uses default.'
          ),
      }),
      execute: async ({ image_url, instruction, model }) => {
        try {
          const modelId = model || 'anthropic/claude-sonnet-4-5-20250514';

          const { text } = await generateText({
            model: modelId,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image', image: image_url },
                  { type: 'text', text: instruction },
                ],
              },
            ],
            maxOutputTokens: 2048,
          });

          return { result: text, image_url, instruction, model_used: modelId };
        } catch (e: any) {
          return toolError(
            `Image vision failed: ${e?.message || 'unknown error'}`,
            `URL: ${image_url}`
          );
        }
      },
    }
  );
