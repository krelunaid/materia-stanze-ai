import { editImage, getRenderProvider } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

function json(body: unknown, headers: Headers, status = 200) {
  return Response.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'empty-room');
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
    const protectedAreas = String(incoming.get('protectedAreas') ?? '').slice(0, 1000);
    const targetAreasInput = String(incoming.get('targetAreas') ?? '').slice(0, 12000);
    const strictRetry = incoming.get('strictRetry') === 'true';
    if (!(image instanceof File) || !image.type.startsWith('image/')) {
      return json({ message: 'Carica una fotografia valida della stanza.' }, headers, 400);
    }
    if (image.size > 20 * 1024 * 1024) return json({ message: 'La fotografia supera il limite di 20 MB.' }, headers, 413);
    let targetAreas = '';
    try {
      const parsed = JSON.parse(targetAreasInput) as Array<{ label?: unknown; points?: Array<{ x?: unknown; y?: unknown }> }>;
      const safe = Array.isArray(parsed) ? parsed.slice(0, 12).map((region) => ({
        label: String(region.label ?? 'oggetto').replace(/[^\p{L}\p{N} .,'’-]/gu, '').slice(0, 80),
        points: Array.isArray(region.points) ? region.points.slice(0, 16).map((point) => ({
          x: Math.min(1, Math.max(0, Number(point.x))), y: Math.min(1, Math.max(0, Number(point.y))),
        })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) : [],
      })).filter((region) => region.points.length >= 4) : [];
      if (safe.length) targetAreas = JSON.stringify(safe);
    } catch {
      targetAreas = '';
    }
    if (!(mask instanceof File) || mask.type !== 'image/png' || !targetAreas) {
      return json({ message: 'Aggiorna Materia: la pulizia sicura richiede i contorni automatici dei mobili.' }, headers, 409);
    }

    const prompt = [
      'This is strictly local photographic inpainting, not a new room generation. Return the complete source photograph and edit only the transparent areas of the technical mask.',
      `Remove every non-architectural target inside these real-estate-emptying regions: ${targetAreas}.`,
      'Each listed target is explicitly authorized for removal even when fitted, built-in, attached, wired or plumbed: this includes kitchen base, wall and tall cabinets, worktops, islands, integrated ovens, hobs, hoods, fitted wardrobes, bathroom vanities, cabinets, mirrors and storage.',
      'The output must be a pixel-aligned edit of the input with the identical width-to-height ratio, field of view and framing. Every unchanged architectural landmark must remain at the same normalized image coordinates.',
      'The same four source-image corners and the complete top, bottom, left and right borders must all remain visible. Never zoom, crop, pan, rotate, extend or recompose the photograph.',
      'Preserve the wall-to-floor boundary at exactly the same height and perspective. Never replace a wall, ceiling, door or window with floor texture and never let the floor expand upward.',
      'Inside each transparent mask region, remove the complete indicated loose object, installed furnishing, fixed appliance or bathroom furnishing and reconstruct only the simplest continuation of the surrounding architecture.',
      'Treat only genuine building architecture as protected: camera and room geometry, walls, floor, ceiling, structural columns and beams, stairs, doors, windows, openings, skirting and visible finish boundaries.',
      'Do not preserve cabinetry, appliances or bathroom furniture merely because they are attached to a wall or connected to services. Never recreate a removed unit inside its mask.',
      'Never create a new window, door, opening, column, beam, stair, trim or architectural feature that is not visibly present in the source photograph.',
      'Where a removed installation hid the room, reconstruct the simplest continuous extension of the nearest visible wall, wall covering, skirting and floor. Do not invent niches, service holes, replacement cabinetry or fixtures.',
      'Keep unchanged pixels visually identical outside the authorized masks. Do not redesign, recolor, restyle, enlarge, straighten or add anything.',
      strictRetry ? 'STRICT RETRY AFTER A REJECTED RESULT: the previous attempt changed the composition. Copy every unobstructed architectural pixel from the source, preserve every border exactly, and inpaint only inside removed-object silhouettes. A floor-only, zoomed, cropped or newly composed result is invalid.' : '',
      protectedAreas ? `These user-protected surfaces must remain unchanged: ${protectedAreas}.` : '',
    ].filter(Boolean).join(' ');

    const result = await editImage(provider, {
      source: image,
      mask,
      prompt,
      maskExplanation: 'transparent polygons are the only editable furniture-removal areas; every solid white pixel is protected and must stay visually identical',
    });
    return json({ image: result, provider: provider.id }, headers);
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a preparare la stanza vuota. Riprova tra poco.',
    }, headers, 500);
  }
}
