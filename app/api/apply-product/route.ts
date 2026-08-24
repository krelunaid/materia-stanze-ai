import { editImage, getAiProvider } from '../../server/ai-provider';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
    return json({ code: 'not_configured', message: 'Il render Grok è pronto, ma manca la chiave xAI protetta sul server.' }, 503);
  }

  try {
    const incoming = await request.formData();
    const image = incoming.get('image');
    const mask = incoming.get('mask');
    const productName = String(incoming.get('productName') ?? '').slice(0, 300);
    const productDescription = String(incoming.get('productDescription') ?? '').slice(0, 1000);
    const targetName = String(incoming.get('targetName') ?? '').slice(0, 150);
    const protectedAreas = String(incoming.get('protectedAreas') ?? '').slice(0, 1000);
    const imageUrl = String(incoming.get('imageUrl') ?? '').slice(0, 2000);
    if (!(image instanceof File) || !(mask instanceof File) || mask.type !== 'image/png') {
      return json({ message: 'Foto o maschera della superficie non valida.' }, 400);
    }

    const prompt = [
      `Edit only the area identified for ${targetName}.`,
      `Apply the exact real product “${productName}”: ${productDescription}.`,
      imageUrl ? 'Use the supplied product image as the exact visual reference for color, grain, pattern and finish.' : '',
      'Respect surface perspective, scale, joints, laying direction, room lighting, shadows and occlusions so the result looks like a real photograph.',
      'Do not move, replace, redesign or regenerate any object or architectural element outside the target. Preserve camera, crop and resolution.',
      protectedAreas ? `These Freeze surfaces must remain unchanged: ${protectedAreas}.` : '',
    ].filter(Boolean).join(' ');

    const result = await editImage(provider, {
      source: image,
      mask,
      referenceImageUrl: imageUrl || null,
      prompt,
      maskExplanation: 'the transparent polygon is the only editable target; every solid white pixel is protected and must not be changed.',
    });
    return json({ image: result, provider: provider.id });
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito ad applicare il prodotto. Riprova tra poco.',
    }, 500);
  }
}
