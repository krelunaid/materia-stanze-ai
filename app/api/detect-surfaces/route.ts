import { detectRoomSurfaces, getAiProvider } from '../../server/ai-provider';

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
  const provider = getAiProvider();
  if (!provider) {
    return json({ code: 'not_configured', message: 'Il riconoscimento automatico richiede Grok attivo sul server.' }, 503);
  }

  try {
    const incoming = await request.formData();
    const image = incoming.get('image');
    if (!(image instanceof File) || !['image/jpeg', 'image/png'].includes(image.type)) {
      return json({ message: 'La fotografia deve essere in formato JPG o PNG.' }, 400);
    }
    if (image.size > 20 * 1024 * 1024) return json({ message: 'La fotografia supera il limite di 20 MB.' }, 413);
    const surfaces = await detectRoomSurfaces(provider, image);
    return json({ surfaces, provider: provider.id });
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a riconoscere la geometria della stanza.',
    }, 500);
  }
}
