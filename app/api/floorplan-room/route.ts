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
    return json({ code: 'not_configured', message: 'La creazione della stanza richiede l’IA attiva sul server.' }, headers, 503);
  }

  try {
    const incoming = await request.formData();
    const image = incoming.get('image');
    if (!(image instanceof File) || !image.type.startsWith('image/')) {
      return json({ message: 'Carica una planimetria in formato immagine.' }, headers, 400);
    }
    if (image.size > 20 * 1024 * 1024) return json({ message: 'La planimetria supera il limite di 20 MB.' }, headers, 413);

    const prompt = [
      'Convert this architectural floor plan into one photorealistic wide-angle interior photograph of the main room.',
      'Read the plan as an exact architectural constraint: preserve the room perimeter, proportions, wall positions, openings, doors and windows shown in the drawing.',
      'Choose a natural eye-level camera position from the main entrance or the widest useful corner so the room geometry is easy to understand.',
      'Create an empty, unfurnished room with plain warm-white walls, a neutral light floor, a simple ceiling and realistic daylight entering only through windows shown on the plan.',
      'Do not add furniture, decorations, text, labels, dimensions, people, extra doors, extra windows or architectural elements not present in the floor plan.',
      'Remove every line, symbol, annotation and measurement from the final output. Return only the finished realistic room photograph, not a split view and not a 3D diagram.',
      'Use a landscape composition suitable for placing real furniture and materials later.',
    ].join(' ');

    const result = await editImage(provider, {
      source: image,
      mask: null,
      prompt,
      maskExplanation: 'The source image is an architectural floor plan that constrains the generated room geometry.',
    });
    return json({ image: result, provider: provider.id }, headers);
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a creare la stanza dalla planimetria.',
    }, headers, 500);
  }
}
