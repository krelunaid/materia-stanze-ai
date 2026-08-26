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
    const strictRetry = incoming.get('strictRetry') === 'true';
    if (!(image instanceof File) || !image.type.startsWith('image/')) {
      return json({ message: 'Carica una fotografia valida della stanza.' }, headers, 400);
    }
    if (image.size > 20 * 1024 * 1024) return json({ message: 'La fotografia supera il limite di 20 MB.' }, headers, 413);

    const prompt = [
      'This is a constrained photographic inpainting task, not a new room generation. Return the complete source photograph and erase only the precise silhouettes of movable objects.',
      'Edit this exact interior photograph into the same room completely empty of movable furniture, lamps, rugs, decorations, curtains and loose objects.',
      'The output must be a pixel-aligned edit of the input with the identical width-to-height ratio, field of view and framing. Every unchanged architectural landmark must remain at the same normalized image coordinates.',
      'The same four source-image corners and the complete top, bottom, left and right borders must all remain visible. Never zoom, crop, pan, rotate, extend or recompose the photograph.',
      'Preserve the wall-to-floor boundary at exactly the same height and perspective. Never replace a wall, ceiling, door or window with floor texture and never let the floor expand upward.',
      'Remove wall-hung pictures, photo frames, posters, mirrors, clocks and every decorative object too; the final room must contain no movable or decorative item.',
      'Treat the source photograph as a strict architectural record: preserve the exact camera position, lens perspective, crop, room dimensions, wall edges, ceiling, floor, doors, windows, openings, skirting, radiators and every fixed detail already visible.',
      'Never create a new window, door, opening, radiator, column, cabinet, fixture, trim or architectural feature that is not visibly present in the source photograph.',
      'Where removed furniture hides part of the room, reconstruct only the simplest continuous extension of the nearest visible wall, wall covering, skirting and floor. When uncertain, continue the existing wall or floor; never invent a feature.',
      'Keep unchanged pixels visually identical wherever no movable object has to be removed. Do not redesign, recolor, restyle, enlarge, straighten or add anything.',
      strictRetry ? 'STRICT RETRY AFTER A REJECTED RESULT: the previous attempt changed the composition. Copy every unobstructed architectural pixel from the source, preserve every border exactly, and inpaint only inside removed-object silhouettes. A floor-only, zoomed, cropped or newly composed result is invalid.' : '',
      protectedAreas ? `These user-protected surfaces must remain unchanged: ${protectedAreas}.` : '',
    ].filter(Boolean).join(' ');

    const result = await editImage(provider, {
      source: image,
      // Grok preserves the source aspect ratio for a single-image edit. Freeze
      // pixels are restored client-side, so its technical mask must not turn
      // this into a multi-image composition that can change the framing.
      mask: provider.id === 'grok' ? null : mask instanceof File && mask.type === 'image/png' ? mask : null,
      prompt,
      maskExplanation: 'solid white polygons identify protected Freeze areas that must remain visually unchanged; transparent areas may be reconstructed.',
    });
    return json({ image: result, provider: provider.id }, headers);
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a preparare la stanza vuota. Riprova tra poco.',
    }, headers, 500);
  }
}
