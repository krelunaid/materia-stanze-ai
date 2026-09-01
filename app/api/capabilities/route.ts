import { getAiProvider, getProductCleaner, getRenderProvider, getVisionAuditor } from '../../server/ai-provider';
import { aiCorsHeaders, handleAiOptions } from '../../server/ai-api-guard';

export function OPTIONS(request: Request) {
  return handleAiOptions(request, 'GET, OPTIONS');
}

export function GET(request: Request) {
  const provider = getAiProvider();
  const cleaner = getProductCleaner();
  const renderer = getRenderProvider();
  const auditor = getVisionAuditor(process.env, provider);
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
    auditorReady: Boolean(auditor),
    auditor: auditor?.id ?? null,
    auditorLabel: auditor ? `OpenAI · ${auditor.model}` : null,
  }, { headers: aiCorsHeaders(request, 'GET, OPTIONS') });
}
