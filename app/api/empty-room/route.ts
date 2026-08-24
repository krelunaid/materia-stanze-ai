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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({
      code: 'not_configured',
      message: 'Il motore IA non è ancora collegato. Inserisci la chiave OpenAI protetta sul server.',
    }, 503);
  }

  try {
    const incoming = await request.formData();
    const image = incoming.get('image');
    const protectedAreas = String(incoming.get('protectedAreas') ?? '').slice(0, 1000);
    if (!(image instanceof File) || !image.type.startsWith('image/')) {
      return json({ message: 'Carica una fotografia valida della stanza.' }, 400);
    }
    if (image.size > 20 * 1024 * 1024) {
      return json({ message: 'La fotografia supera il limite di 20 MB.' }, 413);
    }

    const prompt = [
      'Edit this exact interior photograph into the same room completely empty of movable furniture, lamps, rugs, decorations, curtains and loose objects.',
      'Preserve the camera position, lens perspective, crop, resolution, lighting direction, walls, ceiling, floor, windows, doors, structural openings, radiators and fixed architectural details exactly.',
      'Reconstruct only the surfaces hidden behind removed objects with realistic continuation of the visible material. Do not redesign, recolor, restyle or add anything.',
      protectedAreas ? `The user marked these surfaces as protected and they must not change: ${protectedAreas}.` : '',
    ].filter(Boolean).join(' ');

    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('image[]', image, image.name || 'room.jpg');
    form.append('prompt', prompt);

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const result = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (!response.ok || !result.data?.[0]?.b64_json) {
      return json({ message: result.error?.message ?? 'Il motore non ha restituito un’immagine.' }, response.ok ? 502 : response.status);
    }
    return json({ image: `data:image/png;base64,${result.data[0].b64_json}` });
  } catch {
    return json({ message: 'Non sono riuscito a preparare la stanza vuota. Riprova tra poco.' }, 500);
  }
}
