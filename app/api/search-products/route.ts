import { getAiProvider, searchMaterials } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

function json(body: unknown, headers: Headers, status = 200) {
  return Response.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'search-products');
  if (!access.ok) return access.response;
  const { headers } = access;
  const provider = getAiProvider();
  if (!provider) {
    return json({
      code: 'not_configured',
      message: 'Il servizio IA del server non è momentaneamente disponibile.',
    }, headers, 503);
  }

  try {
    const body = await request.json() as { query?: string };
    const query = String(body.query ?? '').trim().slice(0, 300);
    if (query.length < 3) return json({ message: 'Scrivi almeno tre caratteri.' }, headers, 400);
    const products = await searchMaterials(provider, query);
    return json({ products, provider: provider.id }, headers);
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a cercare i prodotti. Riprova tra poco.',
    }, headers, 500);
  }
}
