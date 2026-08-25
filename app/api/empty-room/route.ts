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
    const protectedAreas = String(incoming.get('protectedAreas') ?? '').slice(0, 1000);
    if (!(image instanceof File) || !image.type.startsWith('image/')) {
      return json({ message: 'Carica una fotografia valida della stanza.' }, 400);
    }
    if (image.size > 20 * 1024 * 1024) return json({ message: 'La fotografia supera il limite di 20 MB.' }, 413);

    const prompt = [
      'Edit this exact interior photograph into the same room completely empty of movable furniture, lamps, rugs, decorations, curtains and loose objects.',
      'Remove wall-hung pictures, photo frames, posters, mirrors, clocks and every decorative object too; the final room must contain no movable or decorative item.',
      'Treat the source photograph as a strict architectural record: preserve the exact camera position, lens perspective, crop, room dimensions, wall edges, ceiling, floor, doors, windows, openings, skirting, radiators and every fixed detail already visible.',
      'Never create a new window, door, opening, radiator, column, cabinet, fixture, trim or architectural feature that is not visibly present in the source photograph.',
      'Where removed furniture hides part of the room, reconstruct only the simplest continuous extension of the nearest visible wall, wall covering, skirting and floor. When uncertain, continue the existing wall or floor; never invent a feature.',
      'Keep unchanged pixels visually identical wherever no movable object has to be removed. Do not redesign, recolor, restyle, enlarge, straighten or add anything.',
      protectedAreas ? `These user-protected surfaces must remain unchanged: ${protectedAreas}.` : '',
    ].filter(Boolean).join(' ');

    const result = await editImage(provider, {
      source: image,
      mask: mask instanceof File && mask.type === 'image/png' ? mask : null,
      prompt,
      maskExplanation: 'solid white polygons identify protected Freeze areas that must remain visually unchanged; transparent areas may be reconstructed.',
    });
    return json({ image: result, provider: provider.id });
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a preparare la stanza vuota. Riprova tra poco.',
    }, 500);
  }
}
