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
    const image = incoming.get('image'); const mask = incoming.get('mask'); const maskReference = incoming.get('maskReference'); const contextImage = incoming.get('contextImage');
    const localCrop = incoming.get('localCrop') === 'true';
    const targetLabel = String(incoming.get('targetLabel') ?? 'oggetto residuo')
      .replace(/[^\p{L}\p{N} .,'’-]/gu, '')
      .slice(0, 80) || 'oggetto residuo';
    let targetArea = '';
    try {
      const parsed = JSON.parse(String(incoming.get('targetArea') ?? '').slice(0, 2000)) as Array<{ x?: unknown; y?: unknown }>;
      const points = Array.isArray(parsed) ? parsed.slice(0, 16).map((point) => ({
        x: Math.min(1, Math.max(0, Number(point.x))),
        y: Math.min(1, Math.max(0, Number(point.y))),
      })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) : [];
      if (points.length >= 3) targetArea = JSON.stringify(points);
    } catch {
      targetArea = '';
    }
    if (!(image instanceof File) || !image.type.startsWith('image/') || image.size > 20 * 1024 * 1024) return json({ message: 'La fotografia non è valida.' }, headers, 400);
    if (!(mask instanceof File) || mask.type !== 'image/png' || mask.size > 8 * 1024 * 1024) return json({ message: 'La maschera locale non è valida.' }, headers, 400);
    if (maskReference != null && (!(maskReference instanceof File) || maskReference.type !== 'image/png' || maskReference.size > 8 * 1024 * 1024)) return json({ message: 'La guida visiva della maschera non è valida.' }, headers, 400);
    if (contextImage != null && (!(contextImage instanceof File) || !contextImage.type.startsWith('image/') || contextImage.size > 12 * 1024 * 1024)) return json({ message: 'Il riferimento globale della stanza non è valido.' }, headers, 400);
    if (!targetArea) return json({ message: 'La selezione da pulire non è valida. Disegnala di nuovo sulla fotografia.' }, headers, 409);
    const prompt = [
      'Perform a strictly local photographic inpainting on this exact interior photograph.',
      localCrop ? 'The source is an exact crop from a larger room photograph. Preserve its four borders pixel-aligned so it can be pasted back without a seam; never zoom, pan, crop or recompose it.' : '',
      contextImage instanceof File ? 'The additional reference image is the complete original room. Use it only to keep global perspective, illumination and continuous wall/floor texture coherent. Never copy the removed target back into the crop.' : '',
      `Remove the complete non-architectural target identified as “${targetLabel}” inside the user-selected polygon ${targetArea}.`,
      'This polygon is an explicit removal request even when the target is fitted, built-in, attached, wired or plumbed, including kitchen cabinetry or appliances and bathroom furniture.',
      'Reconstruct the simplest continuous extension of the wall, floor, skirting or finish hidden by that target. Never recreate the removed unit or replace it with another object.',
      'Do not remove, add, move or redesign anything outside that polygon. Preserve true architecture: camera, crop, perspective, lighting, room geometry, walls, floor, ceiling, structural columns and beams, stairs, doors, windows and openings.',
      'The second image is a technical mask: magenta pixels are the only editable area and black pixels are protected. Return the complete photograph.',
    ].join('\n');
    const result = await editImage(provider, {
      source: image, mask, maskReferenceFile: maskReference instanceof File ? maskReference : null,
      referenceImageFile: contextImage instanceof File ? contextImage : null,
      referenceImageRole: 'room-context',
      prompt,
      maskExplanation: 'transparent pixels are the only local object-removal area; every solid white pixel is protected and must stay unchanged',
    });
    return json({ image: result, provider: provider.id }, headers);
  } catch (caught) {
    return json({ message: caught instanceof Error ? caught.message : 'Non sono riuscito a pulire la zona selezionata.' }, headers, 500);
  }
}
