import { getAiProvider, getProductCleaner, getRenderProvider } from '../../server/ai-provider';
import { aiCorsHeaders, handleAiOptions } from '../../server/ai-api-guard';

export function OPTIONS(request: Request) {
  return handleAiOptions(request, 'GET, OPTIONS');
}

export function GET(request: Request) {
  const provider = getAiProvider();
  const cleaner = getProductCleaner();
  const renderer = getRenderProvider();
  return Response.json({
    aiReady: Boolean(provider),
    provider: provider?.id ?? null,
    providerLabel: provider?.label ?? null,
    cleanerReady: Boolean(cleaner),
    cleaner: cleaner?.id ?? null,
    cleanerLabel: cleaner?.label ?? null,
    rendererReady: Boolean(renderer),
    renderer: renderer?.id ?? null,
    rendererLabel: renderer?.label ?? null,
  }, { headers: aiCorsHeaders(request, 'GET, OPTIONS') });
}
