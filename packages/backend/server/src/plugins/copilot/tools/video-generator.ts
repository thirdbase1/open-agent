import { z } from 'zod';

import { toolError } from './error';
import { createTool } from './utils';

// Video Generator — generate videos from text prompts via the AI Gateway.
// Uses video models from the Vercel AI Gateway (Kling, Wan, ByteDance, etc.).

export const createVideoGeneratorTool = () =>
  createTool(
    { toolName: 'video_generator' },
    {
      description:
        'Generate a short video from a text prompt using AI video models. ' +
        'Available models include Kling, Wan, and ByteDance video models. ' +
        'Returns a URL to the generated video. ' +
        'Keep prompts descriptive — include style, motion, scene, and mood.',
      inputSchema: z.object({
        prompt: z
          .string()
          .min(10)
          .describe('Detailed description of the video to generate'),
        model: z
          .string()
          .optional()
          .describe(
            'Video model ID (e.g. "klingai/kling-2.1"). Defaults to a fast model.'
          ),
        duration: z
          .number()
          .optional()
          .describe('Video duration in seconds (default: 5)'),
      }),
      execute: async ({ prompt, model, duration }) => {
        try {
          const modelId = model || 'klingai/kling-2.1';
          const gatewayUrl =
            'https://ai-gateway.vercel.sh/v1/video/generations';
          const authToken =
            process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;

          const body: Record<string, unknown> = {
            model: modelId,
            prompt,
            duration: duration || 5,
          };

          const res = await fetch(gatewayUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            return toolError(
              `Video generation failed (${res.status}): ${errText}`,
              `Model: ${modelId}`
            );
          }

          const data: any = await res.json();
          const videoUrl = data?.url || data?.data?.[0]?.url || data?.video_url;

          return {
            result: videoUrl
              ? `Video generated: ${videoUrl}`
              : 'Video generation completed',
            video_url: videoUrl,
            prompt,
            model: modelId,
          };
        } catch (e: any) {
          return toolError(
            `Video generation failed: ${e?.message || 'unknown error'}`,
            `Prompt: ${prompt.slice(0, 100)}`
          );
        }
      },
    }
  );
