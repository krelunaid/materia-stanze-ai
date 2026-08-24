import { getAiProvider } from '../../server/ai-provider';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function GET() {
  const provider = getAiProvider();
  return Response.json({
    aiReady: Boolean(provider),
    provider: provider?.id ?? null,
    providerLabel: provider?.label ?? null,
  }, { headers: corsHeaders });
}
