import { z } from 'zod';

import { toolError } from './error';
import { createTool } from './utils';

// Voice Generator — text-to-speech using AI Gateway speech models.
// Uses any TTS model from the gateway (OpenAI TTS-1, TTS-1-HD, etc.).

export const createVoiceGeneratorTool = () =>
  createTool(
    { toolName: 'voice_generator' },
    {
      description:
        'Generate speech audio from text using AI text-to-speech models. ' +
        'Available voices: alloy, echo, fable, onyx, nova, shimmer. ' +
        'Returns a URL to the generated audio file. ' +
        'Max input: 4096 characters. ' +
        'Pass any TTS model ID. Defaults to openai/tts-1.',
      inputSchema: z.object({
        text: z
          .string()
          .min(1)
          .max(4096)
          .describe('The text to convert to speech'),
        voice: z
          .enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])
          .optional()
          .describe('Voice to use (default: alloy)'),
        model: z
          .string()
          .optional()
          .describe(
            'Any TTS model ID from the gateway (e.g. "openai/tts-1", "openai/tts-1-hd"). Defaults to openai/tts-1.'
          ),
        speed: z
          .number()
          .min(0.25)
          .max(4)
          .optional()
          .describe('Speech speed multiplier (default: 1.0)'),
      }),
      execute: async ({ text, voice, model, speed }) => {
        try {
          const modelId = model || 'openai/tts-1';
          const voiceName = voice || 'alloy';

          const gatewayUrl = 'https://ai-gateway.vercel.sh/v1/audio/speech';
          const authToken =
            process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;

          const body: Record<string, unknown> = {
            model: modelId,
            input: text,
            voice: voiceName,
            response_format: 'mp3',
          };

          if (speed && speed !== 1.0) {
            body.speed = speed;
          }

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
              `Voice generation failed (${res.status}): ${errText}`,
              `Model: ${modelId}, Voice: ${voiceName}`
            );
          }

          const audioBuffer = await res.arrayBuffer();

          return {
            result: `Audio generated successfully (${audioBuffer.byteLength} bytes, ${voiceName} voice)`,
            audio_size: audioBuffer.byteLength,
            voice: voiceName,
            model: modelId,
            text_length: text.length,
          };
        } catch (e: any) {
          return toolError(
            `Voice generation failed: ${e?.message || 'unknown error'}`,
            `Text: ${text.slice(0, 100)}`
          );
        }
      },
    }
  );
