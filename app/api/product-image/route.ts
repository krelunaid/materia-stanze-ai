function publicImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0' || host === '127.0.0.1' || host === '::1'
      || /^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const source = publicImageUrl(new URL(request.url).searchParams.get('url') ?? '');
  if (!source) return Response.json({ message: 'Immagine prodotto non valida.' }, { status: 400 });
  try {
    const response = await fetch(source, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    const finalUrl = publicImageUrl(response.url);
    const type = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!response.ok || !finalUrl || !type.startsWith('image/')) {
      return Response.json({ message: 'Immagine prodotto non disponibile.' }, { status: 404 });
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 12 * 1024 * 1024) return Response.json({ message: 'Immagine prodotto troppo grande.' }, { status: 413 });
    return new Response(bytes, {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ message: 'Immagine prodotto non raggiungibile.' }, { status: 502 });
  }
}
