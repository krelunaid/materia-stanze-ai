import { editImage, getAiProvider } from '../../server/ai-provider';

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
    return json({ code: 'not_configured', message: 'Il servizio IA del server non è momentaneamente disponibile.' }, 503);
  }

  try {
    const incoming = await request.formData();
    const image = incoming.get('image');
    const mask = incoming.get('mask');
    const materials = String(incoming.get('materials') ?? '').slice(0, 4000);
    const furniture = String(incoming.get('furniture') ?? '').slice(0, 2000);
    const requests = String(incoming.get('requests') ?? '').slice(0, 2000);
    const protectedAreas = String(incoming.get('protectedAreas') ?? '').slice(0, 1000);
    const imageUrl = String(incoming.get('imageUrl') ?? '').slice(0, 2000);
    const incomingReferenceType = String(incoming.get('referenceType') ?? 'metadata-only');
    const referenceType = ['verified-texture', 'official-product-image', 'uploaded-sample'].includes(incomingReferenceType)
      ? incomingReferenceType
      : 'metadata-only';
    if (!(image instanceof File) || !image.type.startsWith('image/')) {
      return json({ message: 'La fotografia da renderizzare non è valida.' }, 400);
    }
    if (image.size > 20 * 1024 * 1024) return json({ message: 'La fotografia supera il limite di 20 MB.' }, 413);
    if (mask instanceof File && mask.type !== 'image/png') return json({ message: 'La protezione Freeze non è valida.' }, 400);

    const prompt = [
      'Create the final photorealistic interior render by editing this exact room photograph.',
      'Preserve the camera position, lens, crop, room geometry, walls, ceiling, floor, windows, doors, structural openings and lighting direction.',
      materials ? `Apply these user-selected products to their named surfaces, respecting real scale, joints, laying direction, perspective and finish:\n${materials}` : 'Keep every existing architectural material unchanged.',
      imageUrl && referenceType === 'verified-texture' ? 'Use the supplied verified flat texture as the exact material reference.' : '',
      imageUrl && referenceType === 'official-product-image' ? 'Use the supplied official product image as a color and finish reference; reconstruct scale and repetition conservatively.' : '',
      imageUrl && referenceType === 'uploaded-sample' ? 'Use the supplied user sample as the material reference.' : '',
      materials && referenceType === 'metadata-only' ? 'No verified texture is supplied. Keep any product visualization restrained and approximate; do not invent distinctive graphics or claim exact visual fidelity.' : '',
      furniture ? `Insert these furniture elements naturally and at realistic scale: ${furniture}.` : '',
      requests ? `Also follow these user requests: ${requests}.` : '',
      protectedAreas ? `These Freeze areas must remain unchanged: ${protectedAreas}.` : '',
      'Do not add unrelated objects, text, logos, extra doors or extra windows. The result must look like a professional photograph of the same room.',
    ].filter(Boolean).join('\n');

    const result = await editImage(provider, {
      source: image,
      mask: mask instanceof File ? mask : null,
      referenceImageUrl: imageUrl || null,
      prompt,
      maskExplanation: 'solid white polygons identify Freeze areas that must remain unchanged; transparent areas may be edited for the final render.',
    });
    return json({ image: result, provider: provider.id });
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a creare il render finale. Riprova tra poco.',
    }, 500);
  }
}
