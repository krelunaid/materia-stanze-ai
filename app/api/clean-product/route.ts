import { cleanFurnitureReference, getProductCleaner, removeFurnitureBackgroundWithBria } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'clean-product');
  if (!access.ok) return access.response;
  const cleaner = getProductCleaner();
  if (!cleaner) return Response.json({ message: 'Il servizio di scontorno non è disponibile.' }, { status: 503, headers: access.headers });
  try {
    const body = await request.json() as { imageUrl?: string; productName?: string };
    const imageUrl = String(body.imageUrl ?? '').slice(0, 2000);
    const productName = String(body.productName ?? '').slice(0, 300);
    const image = cleaner.id === 'bria'
      ? await removeFurnitureBackgroundWithBria(cleaner.apiKey, imageUrl)
      : await cleanFurnitureReference({ id: 'grok', label: 'Grok', apiKey: cleaner.apiKey }, imageUrl, productName);
    return Response.json({ image, provider: cleaner.id, providerLabel: cleaner.label }, { headers: access.headers });
  } catch (caught) {
    return Response.json({ message: caught instanceof Error ? caught.message : 'Pulizia prodotto non disponibile.' }, { status: 500, headers: access.headers });
  }
}
