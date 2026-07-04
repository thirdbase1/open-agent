import { generateText } from 'ai';
import { z } from 'zod';

import { toolError } from './error';
import { createTool } from './utils';

// Image Vision — analyze images using AI vision models via the Vercel AI Gateway.
// Supports: OCR (text extraction), object detection, scene description,
// chart/diagram reading, code screenshot analysis, and more.

export const createImageVisionTool = () =>
  createTool(
    { toolName: 'image_vision' },
    {
      description:
        'Analyze an image using AI vision. Provide an image URL and a question ' +
        'or instruction about what to extract or describe. ' +
        'Supports: OCR (text extraction), object detection, scene description, ' +
        'chart/diagram reading, code screenshot analysis. ' +
        'The image must be publicly accessible via URL.',
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
      }),
      execute: async ({ image_url, instruction }) => {
        try {
          const model = 'anthropic/claude-sonnet-4-5-20250514';

          const { text } = await generateText({
            model,
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

          return { result: text, image_url, instruction };
        } catch (e: any) {
          return toolError(
            `Image vision failed: ${e?.message || 'unknown error'}`,
            `URL: ${image_url}`
          );
        }
      },
    }
  );
