export type AiProviderId = 'grok' | 'openai';

export type AiProvider = {
  id: AiProviderId;
  label: 'Grok' | 'OpenAI';
  apiKey: string;
};

export type MaterialProduct = {
  name: string;
  brand: string;
  collection: string;
  category: 'Pavimenti' | 'Rivestimenti' | 'Colori' | 'Arredi';
  color: string;
  effect: string;
  format: string;
  finish: string;
  description: string;
  sourceUrl: string;
  imageUrl: string;
  confidence: number;
  official: boolean;
  correction: string;
};

type ResponsesPayload = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

type ImagePayload = {
  data?: Array<{ url?: string; b64_json?: string; mime_type?: string }>;
  error?: { message?: string };
};

const productSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    products: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          brand: { type: 'string' },
          collection: { type: 'string' },
          category: { type: 'string', enum: ['Pavimenti', 'Rivestimenti', 'Colori', 'Arredi'] },
          color: { type: 'string' },
          effect: { type: 'string' },
          format: { type: 'string' },
          finish: { type: 'string' },
          description: { type: 'string' },
          sourceUrl: { type: 'string' },
          imageUrl: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          official: { type: 'boolean' },
          correction: { type: 'string' },
        },
        required: ['name', 'brand', 'collection', 'category', 'color', 'effect', 'format', 'finish', 'description', 'sourceUrl', 'imageUrl', 'confidence', 'official', 'correction'],
      },
    },
  },
  required: ['products'],
} as const;

export function getAiProvider(environment: Record<string, string | undefined> = process.env): AiProvider | null {
  const requested = environment.AI_PROVIDER?.trim().toLowerCase();
  if (requested === 'grok' || requested === 'xai') {
    return environment.XAI_API_KEY ? { id: 'grok', label: 'Grok', apiKey: environment.XAI_API_KEY } : null;
  }
  if (requested === 'openai') {
    return environment.OPENAI_API_KEY ? { id: 'openai', label: 'OpenAI', apiKey: environment.OPENAI_API_KEY } : null;
  }
  if (environment.XAI_API_KEY) return { id: 'grok', label: 'Grok', apiKey: environment.XAI_API_KEY };
  if (environment.OPENAI_API_KEY) return { id: 'openai', label: 'OpenAI', apiKey: environment.OPENAI_API_KEY };
  return null;
}

function responseText(payload: ResponsesPayload) {
  if (payload.output_text) return payload.output_text;
  return payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text ?? '';
}

function parseProducts(value: string) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned) as { products?: MaterialProduct[] };
}

function validPublicUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0' || host === '127.0.0.1' || host === '::1' || /^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}

function normalizeProducts(products: MaterialProduct[]) {
  return products.slice(0, 6).filter((item) => {
    const source = validPublicUrl(item.sourceUrl);
    return Boolean(item.name && item.brand && source && item.confidence >= .55);
  }).map((item) => ({
    ...item,
    imageUrl: validPublicUrl(item.imageUrl)?.toString() ?? '',
    confidence: Math.min(1, Math.max(0, item.confidence)),
  }));
}

export async function searchMaterials(provider: AiProvider, query: string) {
  const prompt = [
    'You are the verification engine for a professional Italian architectural-material search application.',
    'Interpret spelling mistakes and informal color descriptions. Detect brand, collection, official product or color, effect, size and finish.',
    'Known starting manufacturers and aliases: Lea Ceramiche (Lea), Marazzi, Energieker.',
    'Search official manufacturer pages and official catalogs first. Never invent a collection, color, format, finish, URL or image.',
    'If the requested color is not official, use correction to explain the nearest verified official alternative in Italian.',
    'The product source URL must support the exact association. Use an image URL only when it can be associated confidently with that same product; otherwise use an empty string.',
    'Set official=true only for a manufacturer-owned source and confidence from 0 to 1. Return at most six results and an empty array when no reliable match exists.',
    `User query: ${query}`,
  ].join('\n');

  const isGrok = provider.id === 'grok';
  const response = await fetch(isGrok ? 'https://api.x.ai/v1/responses' : 'https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(isGrok ? {
      model: 'grok-4.6',
      input: prompt,
      tools: [{ type: 'web_search', enable_image_search: true, enable_image_understanding: true }],
      text: { format: { type: 'json_schema', name: 'verified_material_products', schema: productSchema, strict: true } },
      include: ['no_inline_citations'],
      store: false,
    } : {
      model: 'gpt-5.4-mini',
      tools: [{ type: 'web_search_preview' }],
      input: `${prompt}\nReturn JSON only matching this shape: ${JSON.stringify(productSchema)}`,
    }),
  });
  const payload = await response.json() as ResponsesPayload;
  if (!response.ok) throw new Error(payload.error?.message ?? 'Ricerca non disponibile.');
  return normalizeProducts(parseProducts(responseText(payload)).products ?? []);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function fileToDataUri(file: File) {
  return `data:${file.type || 'image/png'};base64,${bytesToBase64(new Uint8Array(await file.arrayBuffer()))}`;
}

async function remoteImageToDataUri(value: string) {
  const url = validPublicUrl(value);
  if (!url) throw new Error('Il motore ha restituito un indirizzo immagine non valido.');
  const response = await fetch(url, { redirect: 'follow' });
  const finalUrl = validPublicUrl(response.url);
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !finalUrl || !type.startsWith('image/')) throw new Error('Il risultato fotografico non è disponibile.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Il risultato fotografico è troppo grande.');
  return `data:${type.split(';')[0]};base64,${bytesToBase64(bytes)}`;
}

async function referenceBlob(value: string) {
  const url = validPublicUrl(value);
  if (!url) return null;
  const response = await fetch(url, { redirect: 'follow' });
  const finalUrl = validPublicUrl(response.url);
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !finalUrl || !type.startsWith('image/')) return null;
  const blob = await response.blob();
  return blob.size <= 12 * 1024 * 1024 ? blob : null;
}

export async function editImage(provider: AiProvider, input: {
  source: File;
  mask?: File | null;
  referenceImageUrl?: string | null;
  prompt: string;
  maskExplanation?: string;
}) {
  if (provider.id === 'grok') {
    const images: Array<{ type: 'image_url'; url: string }> = [
      { type: 'image_url', url: await fileToDataUri(input.source) },
    ];
    if (input.mask) images.push({ type: 'image_url', url: await fileToDataUri(input.mask) });
    const reference = input.referenceImageUrl ? validPublicUrl(input.referenceImageUrl) : null;
    if (reference && images.length < 3) images.push({ type: 'image_url', url: reference.toString() });
    const prompt = [
      input.prompt,
      input.mask && input.maskExplanation ? `The second image is a technical guide, not part of the room: ${input.maskExplanation}` : '',
      reference ? `The ${input.mask ? 'third' : 'second'} image is the exact product reference.` : '',
    ].filter(Boolean).join(' ');
    const response = await fetch('https://api.x.ai/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-imagine-image-2.0',
        prompt,
        ...(images.length === 1 ? { image: images[0] } : { images }),
      }),
    });
    const payload = await response.json() as ImagePayload;
    const result = payload.data?.[0];
    if (!response.ok || (!result?.url && !result?.b64_json)) {
      throw new Error(payload.error?.message ?? 'Grok non ha restituito un’immagine.');
    }
    if (result.b64_json) return `data:${result.mime_type ?? 'image/jpeg'};base64,${result.b64_json}`;
    return remoteImageToDataUri(result.url as string);
  }

  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('image[]', input.source, input.source.name || 'room.png');
  if (input.referenceImageUrl) {
    const reference = await referenceBlob(input.referenceImageUrl);
    if (reference) form.append('image[]', reference, 'product-reference.jpg');
  }
  if (input.mask?.type === 'image/png') form.append('mask', input.mask, 'edit-mask.png');
  form.append('prompt', input.prompt);
  form.append('input_fidelity', 'high');
  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    body: form,
  });
  const payload = await response.json() as ImagePayload;
  if (!response.ok || !payload.data?.[0]?.b64_json) {
    throw new Error(payload.error?.message ?? 'Il motore non ha restituito un’immagine.');
  }
  return `data:image/png;base64,${payload.data[0].b64_json}`;
}
