import { editImage, getRenderProvider } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

function json(body: unknown, headers: Headers, status = 200) {
  return Response.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'clean-room-region');
  if (!access.ok) return access.response;
  const { headers } = access;
  const provider = getRenderProvider();
  if (!provider) return json({ code: 'not_configured', message: 'La pulizia locale non è momentaneamente disponibile.' }, headers, 503);
  try {
    const incoming = await request.formData();
    const image = incoming.get('image'); const mask = incoming.get('mask');
    const targetLabel = String(incoming.get('targetLabel') ?? 'oggetto residuo').slice(0, 120);
    const targetArea = String(incoming.get('targetArea') ?? '').slice(0, 2000);
    if (!(image instanceof File) || !image.type.startsWith('image/') || image.size > 20 * 1024 * 1024) return json({ message: 'La fotografia non è valida.' }, headers, 400);
    if (!(mask instanceof File) || mask.type !== 'image/png' || mask.size > 8 * 1024 * 1024) return json({ message: 'La maschera locale non è valida.' }, headers, 400);
    const prompt = [
      'Perform a strictly local photographic inpainting on this exact interior photograph.',
      `Remove only the movable residual object identified as “${targetLabel}” inside the user-selected polygon ${targetArea}.`,
      'Reconstruct the simplest continuous extension of the immediately surrounding wall, floor, skirting or architectural background that the object hides.',
      'Do not remove, add, move or redesign anything outside that polygon. Preserve camera, crop, perspective, lighting, walls, floor, ceiling, doors, windows, radiators and fixed details.',
      'The second image is a technical mask: transparent pixels are the only editable area and every white pixel is protected. Return the complete photograph.',
    ].join('\n');
    const result = await editImage(provider, {
      source: image, mask,
      prompt,
      maskExplanation: 'transparent pixels are the only local object-removal area; every solid white pixel is protected and must stay unchanged',
    });
    return json({ image: result, provider: provider.id }, headers);
  } catch (caught) {
    return json({ message: caught instanceof Error ? caught.message : 'Non sono riuscito a pulire la zona selezionata.' }, headers, 500);
  }
}
