import { classifyProductPhoto, getAiProvider } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'classify-product');
  if (!access.ok) return access.response;
  const provider = getAiProvider();
  if (!provider) return Response.json({ message: 'Il riconoscimento delle foto prodotto non è disponibile.' }, { status: 503, headers: access.headers });
  try {
    const form = await request.formData();
    const file = form.get('image');
    if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return Response.json({ message: 'Carica una foto prodotto JPG, PNG o WEBP.' }, { status: 400, headers: access.headers });
    }
    if (!file.size || file.size > 12 * 1024 * 1024) {
      return Response.json({ message: 'La foto prodotto supera il limite di 12 MB.' }, { status: 413, headers: access.headers });
    }
    const requestedTarget = String(form.get('intendedTarget') ?? '');
    const intendedTarget = requestedTarget === 'floor' || requestedTarget === 'wall' ? requestedTarget : undefined;
    const classification = await classifyProductPhoto(provider, file, intendedTarget);
    return Response.json({ ...classification, provider: provider.id, providerLabel: provider.label }, { headers: access.headers });
  } catch (caught) {
    return Response.json({ message: caught instanceof Error ? caught.message : 'Riconoscimento della foto prodotto non disponibile.' }, { status: 500, headers: access.headers });
  }
}
