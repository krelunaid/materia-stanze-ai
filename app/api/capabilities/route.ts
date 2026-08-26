import { getAiProvider } from '../../server/ai-provider';
import { aiCorsHeaders, handleAiOptions } from '../../server/ai-api-guard';

export function OPTIONS(request: Request) {
  return handleAiOptions(request, 'GET, OPTIONS');
}

export function GET(request: Request) {
  const provider = getAiProvider();
  return Response.json({
    aiReady: Boolean(provider),
    provider: provider?.id ?? null,
    providerLabel: provider?.label ?? null,
  }, { headers: aiCorsHeaders(request, 'GET, OPTIONS') });
}
