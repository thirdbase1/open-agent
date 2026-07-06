import { FalProvider } from './fal';
import { GatewayProvider } from './gateway';
import { MorphProvider } from './morph';
import { OracleProvider } from './oracle';

/**
 * Phase 3 (Vercel-native migration): GatewayProvider now handles OpenAI, Anthropic, Gemini,
 * Perplexity, and xAI routing through Vercel AI Gateway - replacing the old
 * OpenAIProvider / AnthropicOfficialProvider / AnthropicVertexProvider / GeminiGenerativeProvider
 * / GeminiVertexProvider / PerplexityProvider entries that used to be registered here.
 *
 * FalProvider, MorphProvider, and OracleProvider remain unchanged and still registered
 * separately - see gateway.ts's file header for why those three are not Gateway-routable.
 */
export const CopilotProviders = [
  GatewayProvider,
  FalProvider,
  MorphProvider,
  OracleProvider,
];

export { FalProvider } from './fal';
export { CopilotProviderFactory } from './factory';
export { GatewayProvider } from './gateway';
export { MorphProvider } from './morph';
export { OracleProvider } from './oracle';
export type { CopilotProvider } from './provider';
export * from './types';
