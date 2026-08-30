import { editImage, getRenderProvider } from '../../server/ai-provider';
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
  const provider = getRenderProvider();
  if (!provider) {
    return json({ code: 'not_configured', message: 'Il servizio IA del server non è momentaneamente disponibile.' }, headers, 503);
  }

  try {
    const incoming = await request.formData();
    const image = incoming.get('image');
    const mask = incoming.get('mask');
    const materialReference = incoming.get('materialReference');
    const productName = String(incoming.get('productName') ?? '').slice(0, 300);
    const productDescription = String(incoming.get('productDescription') ?? '').slice(0, 1000);
    const targetName = String(incoming.get('targetName') ?? '').slice(0, 150);
    const roomMeasurements = String(incoming.get('roomMeasurements') ?? '').slice(0, 500);
    const protectedAreas = String(incoming.get('protectedAreas') ?? '').slice(0, 1000);
    const imageUrl = String(incoming.get('imageUrl') ?? '').slice(0, 2000);
    const incomingReferenceType = String(incoming.get('referenceType') ?? 'metadata-only');
    const referenceType = ['verified-texture', 'uploaded-sample'].includes(incomingReferenceType)
      ? incomingReferenceType
      : 'metadata-only';
    if (!(image instanceof File) || !(mask instanceof File) || mask.type !== 'image/png') {
      return json({ message: 'Foto o maschera della superficie non valida.' }, headers, 400);
    }
    if (materialReference instanceof File && (!materialReference.type.startsWith('image/') || materialReference.size > 12 * 1024 * 1024)) {
      return json({ message: 'Il campione materiale non è valido.' }, headers, 400);
    }
    if (referenceType === 'uploaded-sample' && !(materialReference instanceof File)) {
      return json({ message: 'Il campione materiale non è arrivato al server. Ricaricalo e riprova.' }, headers, 400);
    }
    if (referenceType === 'verified-texture' && !imageUrl) {
      return json({ message: 'La texture verificata non è disponibile.' }, headers, 400);
    }

    const referenceInstruction = referenceType === 'verified-texture'
      ? 'Use the supplied verified flat texture as the exact visual reference for color, grain, pattern and finish.'
      : referenceType === 'uploaded-sample'
          ? 'Use the user-supplied material sample as the visual reference for color, grain, pattern and finish.'
          : 'No verified flat texture is available. Use only the written metadata to construct a clean, continuous material pattern. Never copy or repeat furniture, people, props, room scenes, catalog backgrounds, labels or shadows from a product photograph.';

    const prompt = [
      `Edit only the area identified for ${targetName}.`,
      referenceType === 'metadata-only'
        ? `Create an indicative visualization inspired by “${productName}”: ${productDescription}.`
        : `Apply the referenced product “${productName}”: ${productDescription}.`,
      referenceInstruction,
      roomMeasurements ? `Use this room-scale calibration for physical pattern size and perspective: ${roomMeasurements}. Treat lower-confidence values as approximate, never as permission to alter the room geometry.` : '',
      'Respect surface perspective, scale, joints, laying direction, room lighting, shadows and occlusions so the result looks like a real photograph.',
      'Do not move, replace, redesign or regenerate any object or architectural element outside the target. Preserve camera, crop and resolution.',
      protectedAreas ? `These Freeze surfaces must remain unchanged: ${protectedAreas}.` : '',
    ].filter(Boolean).join(' ');

    const result = await editImage(provider, {
      source: image,
      mask,
      referenceImageUrl: referenceType === 'metadata-only' ? null : imageUrl || null,
      referenceImageFile: materialReference instanceof File ? materialReference : null,
      referenceImageRole: 'material',
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
