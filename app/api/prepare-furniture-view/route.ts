import { acceptsFurnitureView, editImage, getRenderProvider, verifyFurnitureView } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

type FurnitureFacing = 'front-wall' | 'left-wall' | 'right-wall';

const viewInstructions: Record<FurnitureFacing, string> = {
  'front-wall': 'Show a geometrically straight, centered front elevation. The back edge is parallel to the image plane and the front face is not diagonal.',
  'left-wall': 'Show the product turned to sit flush against the left wall of a room, as seen from the room center. Preserve a realistic three-quarter view and show the product right side.',
  'right-wall': 'Show the product turned to sit flush against the right wall of a room, as seen from the room center. Preserve a realistic three-quarter view and show the product left side.',
};

function perspectivePrompt(facing: FurnitureFacing, productName: string, productDescription: string, retryReason = '') {
  return [
    `Create a perspective-correct isolated catalog view of the exact furniture product “${productName}” in the source image.`,
    productDescription ? `Product description: ${productDescription}.` : '',
    viewInstructions[facing],
    'Preserve the exact identity, proportions, construction, number and position of legs, drawers, doors, shelves and handles, plus the original color, material and finish.',
    'Do not redesign, widen, shorten, mirror, repair, simplify, add or remove any product part. Keep all feet and the complete silhouette visible.',
    'Remove the old viewpoint, all surroundings, shadows, text and logos. Put only the product on a uniform pure white (#FFFFFF) background, with generous margin, no floor line, no horizon and no cast shadow.',
    'This is a technical product-view conversion, not a room render. Return one photorealistic product image and nothing else.',
    retryReason ? `QUALITY-CONTROL RETRY: the previous proposal failed because ${retryReason}. Correct only those failures while keeping the source product exact.` : '',
  ].filter(Boolean).join('\n');
}

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'prepare-furniture-view');
  if (!access.ok) return access.response;
  const provider = getRenderProvider();
  if (!provider) return Response.json({ message: 'Il servizio di prospettiva non è disponibile.' }, { status: 503, headers: access.headers });

  try {
    const form = await request.formData();
    const image = form.get('image');
    const facing = String(form.get('facing') ?? '') as FurnitureFacing;
    const productName = String(form.get('productName') ?? 'Mobile').trim().slice(0, 180);
    const productDescription = String(form.get('productDescription') ?? '').trim().slice(0, 500);
    if (!(image instanceof File) || !image.type.startsWith('image/') || image.size > 12 * 1024 * 1024) {
      return Response.json({ message: 'La foto del mobile non è valida.' }, { status: 400, headers: access.headers });
    }
    if (!(facing in viewInstructions)) {
      return Response.json({ message: 'Scegli una parete valida per il mobile.' }, { status: 400, headers: access.headers });
    }

    let result = await editImage(provider, {
      source: image,
      prompt: perspectivePrompt(facing, productName, productDescription),
    });
    let verification = await verifyFurnitureView(provider, { source: image, renderedImage: result, facing, productName });
    if (!acceptsFurnitureView(verification)) {
      result = await editImage(provider, {
        source: image,
        prompt: perspectivePrompt(facing, productName, productDescription, verification.reason),
      });
      verification = await verifyFurnitureView(provider, { source: image, renderedImage: result, facing, productName });
      if (!acceptsFurnitureView(verification)) {
        return Response.json({
          code: 'identity_check_failed',
          message: 'La nuova prospettiva cambierebbe forma o dettagli del mobile. Non mostro una ricostruzione infedele: prova una foto più frontale o meglio illuminata.',
          verification,
        }, { status: 422, headers: access.headers });
      }
    }
    return Response.json({ image: result, facing, provider: provider.id, verification }, { headers: access.headers });
  } catch (caught) {
    return Response.json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a ricostruire la prospettiva del mobile.',
    }, { status: 500, headers: access.headers });
  }
}
