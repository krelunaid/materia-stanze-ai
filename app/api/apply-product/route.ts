const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function safePublicImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0' || host === '127.0.0.1' || host === '::1' || /^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url;
  } catch { return null; }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({
      code: 'not_configured',
      message: 'L’applicazione automatica è pronta ma manca la chiave OpenAI protetta sul server.',
    }, 503);
  }

  try {
    const incoming = await request.formData();
    const image = incoming.get('image');
    const mask = incoming.get('mask');
    const productName = String(incoming.get('productName') ?? '').slice(0, 300);
    const productDescription = String(incoming.get('productDescription') ?? '').slice(0, 1000);
    const targetName = String(incoming.get('targetName') ?? '').slice(0, 150);
    const protectedAreas = String(incoming.get('protectedAreas') ?? '').slice(0, 1000);
    const imageUrl = safePublicImageUrl(String(incoming.get('imageUrl') ?? '').slice(0, 2000));
    if (!(image instanceof File) || !(mask instanceof File)) return json({ message: 'Foto o maschera della superficie non valida.' }, 400);

    const prompt = [
      `Edit only the transparent masked area corresponding to ${targetName}.`,
      `Apply the exact real product described as “${productName}”: ${productDescription}.`,
      imageUrl ? 'Use the second input image as the exact visual reference for color, grain, pattern and finish.' : '',
      'Respect the surface perspective, scale, joints, laying direction, room lighting, shadows and occlusions so the result looks like a real photograph.',
      'Do not move, replace, redesign or regenerate any object or architectural element outside the mask. Preserve camera, crop and resolution exactly.',
      protectedAreas ? `These protected surfaces must remain pixel-consistent with the input: ${protectedAreas}.` : '',
    ].filter(Boolean).join(' ');

    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('image[]', image, image.name || 'room.png');
    if (imageUrl) {
      const referenceResponse = await fetch(imageUrl, { redirect: 'follow' });
      const finalUrl = safePublicImageUrl(referenceResponse.url);
      const contentType = referenceResponse.headers.get('content-type') ?? '';
      const contentLength = Number(referenceResponse.headers.get('content-length') ?? '0');
      if (finalUrl && referenceResponse.ok && contentType.startsWith('image/') && contentLength <= 12 * 1024 * 1024) {
        const reference = await referenceResponse.blob();
        if (reference.size <= 12 * 1024 * 1024) form.append('image[]', reference, 'product-reference.jpg');
      }
    }
    form.append('mask', mask, 'surface-mask.png');
    form.append('prompt', prompt);
    form.append('input_fidelity', 'high');

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const result = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (!response.ok || !result.data?.[0]?.b64_json) {
      return json({ message: result.error?.message ?? 'Il motore non ha restituito il render.' }, response.ok ? 502 : response.status);
    }
    return json({ image: `data:image/png;base64,${result.data[0].b64_json}` });
  } catch {
    return json({ message: 'Non sono riuscito ad applicare il prodotto. Riprova tra poco.' }, 500);
  }
}
