import { editImage, getAiProvider, verifyFurniturePlacement } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

function json(body: unknown, headers: Headers, status = 200) {
  return Response.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'render-room');
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
    const furnitureReference = incoming.get('furnitureReference');
    const furnitureReferenceName = String(incoming.get('furnitureReferenceName') ?? '').slice(0, 200);
    const furnitureReferenceUrl = String(incoming.get('furnitureReferenceUrl') ?? '').slice(0, 2000);
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
      return json({ message: 'La fotografia da renderizzare non è valida.' }, headers, 400);
    }
    if (image.size > 20 * 1024 * 1024) return json({ message: 'La fotografia supera il limite di 20 MB.' }, headers, 413);
    if (!(mask instanceof File) || mask.type !== 'image/png') return json({ message: 'La maschera del render controllato non è valida.' }, headers, 400);
    if (furnitureReference instanceof File && (!furnitureReference.type.startsWith('image/') || furnitureReference.size > 20 * 1024 * 1024)) {
      return json({ message: 'La fotografia del mobile non è valida.' }, headers, 400);
    }

    const prompt = [
      'Create the final photorealistic interior render by editing this exact room photograph.',
      'Preserve the camera position, lens, crop, room geometry, walls, ceiling, floor, windows, doors, structural openings and lighting direction.',
      materials ? `Apply these user-selected products to their named surfaces, respecting real scale, joints, laying direction, perspective and finish:\n${materials}` : 'Keep every existing architectural material unchanged.',
      imageUrl && referenceType === 'verified-texture' ? 'Use the supplied verified flat texture as the exact material reference.' : '',
      imageUrl && referenceType === 'official-product-image' ? 'Use the supplied official product image as a color and finish reference; reconstruct scale and repetition conservatively.' : '',
      imageUrl && referenceType === 'uploaded-sample' ? 'Use the supplied user sample as the material reference.' : '',
      materials && referenceType === 'metadata-only' ? 'No verified texture is supplied. Keep any product visualization restrained and approximate; do not invent distinctive graphics or claim exact visual fidelity.' : '',
      furniture ? `Insert these furniture elements at the exact user-selected image anchors, approximate sizes and rotations below. Treat x/y as percentages of the full source photograph; keep each item's floor contact point at its anchor and preserve the user's composition:\n${furniture}` : '',
      furniture ? 'MANDATORY: every listed furniture item must be clearly visible in the final photograph, entirely inside its transparent mask window. A clean room with the furniture omitted is an invalid result. Put the furniture floor-contact point exactly at the requested anchor and keep its real product proportions.' : '',
      furnitureReference instanceof File ? `Use the supplied furniture reference image to preserve the exact appearance of “${furnitureReferenceName || 'the selected furniture'}”. It may already be a transparent cutout: never recreate its former catalog background. Integrate only the physical object with correct floor contact, perspective, scale, room lighting and a natural contact shadow.` : '',
      furnitureReferenceUrl && !(furnitureReference instanceof File) ? `Use the supplied online product photograph to preserve the appearance and proportions of “${furnitureReferenceName || 'the selected furniture'}”; remove its original photo background before integrating it.` : '',
      requests ? `Also follow these user requests: ${requests}.` : '',
      protectedAreas ? `These Freeze areas must remain unchanged: ${protectedAreas}.` : '',
      'The transparent parts of the technical mask show the complete and only editable regions and placement windows. Never modify a solid white pixel.',
      'Do not add unrelated objects, text, logos, extra doors or extra windows. Do not change the room dimensions or perspective. The result must look like a professional photograph of the same room.',
    ].filter(Boolean).join('\n');

    const editInput = {
      source: image,
      mask: mask instanceof File ? mask : null,
      referenceImageUrl: (furnitureReferenceUrl && !(furnitureReference instanceof File) ? furnitureReferenceUrl : imageUrl) || null,
      referenceImageFile: furnitureReference instanceof File ? furnitureReference : null,
      prompt,
      maskExplanation: 'transparent pixels are the complete and only editable product/furniture regions; every solid white pixel is protected and must remain unchanged.',
    };
    let result = await editImage(provider, editInput);
    let verification = null;
    if (furniture) {
      const verify = (renderedImage: string) => verifyFurniturePlacement(provider, {
        source: image,
        renderedImage,
        furniture,
        referenceImageUrl: furnitureReferenceUrl || null,
        referenceImageFile: furnitureReference instanceof File ? furnitureReference : null,
      });
      verification = await verify(result);
      const referenceRequired = Boolean(furnitureReferenceUrl || furnitureReference instanceof File);
      const accepted = verification.visible && verification.atRequestedAnchor
        && (!referenceRequired || verification.resemblesReference)
        && verification.confidence >= .65;
      if (!accepted) {
        result = await editImage(provider, {
          ...editInput,
          prompt: `${prompt}\nQUALITY-CONTROL RETRY: the previous attempt omitted, misplaced or distorted the requested furniture. Make the referenced furniture unmistakably visible inside the requested transparent placement window. Do not return an empty room.`,
        });
        verification = await verify(result);
        const retryAccepted = verification.visible && verification.atRequestedAnchor
          && (!referenceRequired || verification.resemblesReference)
          && verification.confidence >= .65;
        if (!retryAccepted) return json({ image: result, provider: provider.id, verification, needsExactOverlay: true }, headers);
      }
    }
    return json({ image: result, provider: provider.id, verification }, headers);
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a creare il render finale. Riprova tra poco.',
    }, headers, 500);
  }
}
