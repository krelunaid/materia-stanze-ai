import { getAiProvider, searchMaterials } from '../../server/ai-provider';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, OAI-Sites-Authorization',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const provider = getAiProvider();
  if (!provider) {
    return json({
      code: 'not_configured',
      message: 'Il servizio IA del server non è momentaneamente disponibile.',
    }, 503);
  }

  try {
    const body = await request.json() as { query?: string };
    const query = String(body.query ?? '').trim().slice(0, 300);
    if (query.length < 3) return json({ message: 'Scrivi almeno tre caratteri.' }, 400);
    const products = await searchMaterials(provider, query);
    return json({ products, provider: provider.id });
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a cercare i prodotti. Riprova tra poco.',
    }, 500);
  }
}
