import { editImage, getAiProvider } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

function json(body: unknown, headers: Headers, status = 200) {
  return Response.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'apply-product');
  if (!access.ok) return access.response;
  const { headers } = access;
  const provider = getAiProvider();
  if (!provider) {
    return json({ code: 'not_configured', message: 'Il servizio IA del server non è momentaneamente disponibile.' }, headers, 503);
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
    const incomingReferenceType = String(incoming.get('referenceType') ?? 'metadata-only');
    const referenceType = ['verified-texture', 'official-product-image', 'uploaded-sample'].includes(incomingReferenceType)
      ? incomingReferenceType
      : 'metadata-only';
    if (!(image instanceof File) || !(mask instanceof File) || mask.type !== 'image/png') {
      return json({ message: 'Foto o maschera della superficie non valida.' }, headers, 400);
    }

    const referenceInstruction = referenceType === 'verified-texture'
      ? 'Use the supplied verified flat texture as the exact visual reference for color, grain, pattern and finish.'
      : referenceType === 'official-product-image'
        ? 'Use the supplied official product sample as the color and finish reference. Reconstruct repetition and scale conservatively; do not invent distinctive veins or graphics that are not visible in the sample.'
        : referenceType === 'uploaded-sample'
          ? 'Use the user-supplied material sample as the visual reference for color, grain, pattern and finish.'
          : 'No verified visual sample is available. Create only a clearly approximate visualization from the verified metadata; keep the appearance restrained and do not invent distinctive product graphics.';

    const prompt = [
      `Edit only the area identified for ${targetName}.`,
      referenceType === 'metadata-only'
        ? `Create an indicative visualization inspired by “${productName}”: ${productDescription}.`
        : `Apply the referenced product “${productName}”: ${productDescription}.`,
      referenceInstruction,
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
    return json({ image: result, provider: provider.id }, headers);
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito ad applicare il prodotto. Riprova tra poco.',
    }, headers, 500);
  }
}
