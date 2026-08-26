import { getAiProvider, locateProductReference } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'search-products');
  if (!access.ok) return access.response;
  const provider = getAiProvider();
  if (!provider) return Response.json({ message: 'Il servizio IA non è disponibile.' }, { status: 503, headers: access.headers });
  try {
    const body = await request.json() as { imageUrl?: string; productName?: string };
    const bounds = await locateProductReference(provider, String(body.imageUrl ?? '').slice(0, 2000), String(body.productName ?? '').slice(0, 300));
    return Response.json({ bounds }, { headers: access.headers });
  } catch (caught) {
    return Response.json({ message: caught instanceof Error ? caught.message : 'Ritaglio prodotto non disponibile.' }, { status: 500, headers: access.headers });
  }
}
