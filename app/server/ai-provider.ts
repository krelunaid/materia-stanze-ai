import { validateRoomGeometry, GeometrySlot } from '../geometry/validate';

export type AiProviderId = 'grok' | 'openai';

export type AiProvider = {
  id: AiProviderId;
  label: 'Grok' | 'OpenAI';
  apiKey: string;
};

export type ProductCleaner = {
  id: 'bria' | 'grok';
  label: 'BRIA RMBG 2.0' | 'Grok Imagine 2.0';
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
  productImageUrl: string;
  textureImageUrl: string;
  roomImageUrls: string[];
  confidence: number;
  official: boolean;
  correction: string;
};

export type DetectedRoomSurface = {
  id?: string;
  name: string;
  kind: 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'other';
  points: Array<{ x: number; y: number }>;
  confidence: number;
  slot?: GeometrySlot;
  parentId?: string;
};

export type DetectedObjectRegion = {
  label: string;
  points: Array<{ x: number; y: number }>;
  confidence: number;
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

export type FurnitureRenderVerification = {
  visible: boolean;
  atRequestedAnchor: boolean;
  atRequestedOrientation: boolean;
  resemblesReference: boolean;
  physicallyGrounded: boolean;
  contactShadow: boolean;
  structurallyComplete: boolean;
  realisticLighting: boolean;
  confidence: number;
  reason: string;
  referenceLeft: number;
  referenceTop: number;
  referenceRight: number;
  referenceBottom: number;
};

export function acceptsFurnitureRender(verification: FurnitureRenderVerification, referenceRequired: boolean) {
  return verification.visible
    && verification.atRequestedAnchor
    && verification.atRequestedOrientation
    && (!referenceRequired || verification.resemblesReference)
    && verification.physicallyGrounded
    && verification.contactShadow
    && verification.structurallyComplete
    && verification.realisticLighting
    && verification.confidence >= .8;
}

const furnitureVerificationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    visible: { type: 'boolean' },
    atRequestedAnchor: { type: 'boolean' },
    atRequestedOrientation: { type: 'boolean' },
    resemblesReference: { type: 'boolean' },
    physicallyGrounded: { type: 'boolean' },
    contactShadow: { type: 'boolean' },
    structurallyComplete: { type: 'boolean' },
    realisticLighting: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' },
    referenceLeft: { type: 'number', minimum: 0, maximum: 1 },
    referenceTop: { type: 'number', minimum: 0, maximum: 1 },
    referenceRight: { type: 'number', minimum: 0, maximum: 1 },
    referenceBottom: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['visible', 'atRequestedAnchor', 'atRequestedOrientation', 'resemblesReference', 'physicallyGrounded', 'contactShadow', 'structurallyComplete', 'realisticLighting', 'confidence', 'reason', 'referenceLeft', 'referenceTop', 'referenceRight', 'referenceBottom'],
} as const;

const productBoundsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    left: { type: 'number', minimum: 0, maximum: 1 },
    top: { type: 'number', minimum: 0, maximum: 1 },
    right: { type: 'number', minimum: 0, maximum: 1 },
    bottom: { type: 'number', minimum: 0, maximum: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['left', 'top', 'right', 'bottom', 'confidence'],
} as const;

const objectRegionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean' },
    label: { type: 'string' },
    points: {
      type: 'array', minItems: 0, maxItems: 16,
      items: {
        type: 'object', additionalProperties: false,
        properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } },
        required: ['x', 'y'],
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['found', 'label', 'points', 'confidence'],
} as const;

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
          productImageUrl: { type: 'string' },
          textureImageUrl: { type: 'string' },
          roomImageUrls: { type: 'array', maxItems: 3, items: { type: 'string' } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          official: { type: 'boolean' },
          correction: { type: 'string' },
        },
        required: ['name', 'brand', 'collection', 'category', 'color', 'effect', 'format', 'finish', 'description', 'sourceUrl', 'productImageUrl', 'textureImageUrl', 'roomImageUrls', 'confidence', 'official', 'correction'],
      },
    },
  },
  required: ['products'],
} as const;

const roomGeometrySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    surfaces: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['wall', 'floor', 'ceiling', 'door', 'window', 'other'] },
          points: {
            type: 'array',
            minItems: 3,
            maxItems: 24,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                x: { type: 'number', minimum: 0, maximum: 1 },
                y: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['x', 'y'],
            },
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['name', 'kind', 'points', 'confidence'],
      },
    },
  },
  required: ['surfaces'],
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

export function getRenderProvider(environment: Record<string, string | undefined> = process.env): AiProvider | null {
  const requested = environment.RENDER_PROVIDER?.trim().toLowerCase();
  if (requested === 'openai') {
    return environment.OPENAI_API_KEY
      ? { id: 'openai', label: 'OpenAI', apiKey: environment.OPENAI_API_KEY }
      : getAiProvider(environment);
  }
  if (requested === 'grok' || requested === 'xai') {
    return environment.XAI_API_KEY ? { id: 'grok', label: 'Grok', apiKey: environment.XAI_API_KEY } : null;
  }
  if (environment.OPENAI_API_KEY) return { id: 'openai', label: 'OpenAI', apiKey: environment.OPENAI_API_KEY };
  return getAiProvider(environment);
}

export function getProductCleaner(environment: Record<string, string | undefined> = process.env): ProductCleaner | null {
  const requested = environment.PRODUCT_CLEANER?.trim().toLowerCase();
  if (requested === 'bria') {
    if (environment.BRIA_API_KEY) return { id: 'bria', label: 'BRIA RMBG 2.0', apiKey: environment.BRIA_API_KEY };
    return environment.XAI_API_KEY ? { id: 'grok', label: 'Grok Imagine 2.0', apiKey: environment.XAI_API_KEY } : null;
  }
  if (requested === 'grok' || requested === 'xai') {
    return environment.XAI_API_KEY ? { id: 'grok', label: 'Grok Imagine 2.0', apiKey: environment.XAI_API_KEY } : null;
  }
  if (environment.BRIA_API_KEY) return { id: 'bria', label: 'BRIA RMBG 2.0', apiKey: environment.BRIA_API_KEY };
  if (environment.XAI_API_KEY) return { id: 'grok', label: 'Grok Imagine 2.0', apiKey: environment.XAI_API_KEY };
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
    productImageUrl: validPublicUrl(item.productImageUrl)?.toString() ?? '',
    textureImageUrl: validPublicUrl(item.textureImageUrl)?.toString() ?? '',
    roomImageUrls: (Array.isArray(item.roomImageUrls) ? item.roomImageUrls : []).slice(0, 3)
      .map((url) => validPublicUrl(url)?.toString() ?? '')
      .filter(Boolean),
    confidence: Math.min(1, Math.max(0, item.confidence)),
  }));
}

function productType(value: unknown) {
  const types = Array.isArray(value) ? value : [value];
  return types.some((item) => String(item).toLowerCase() === 'product');
}

function findStructuredProduct(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructuredProduct(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (productType(record['@type'])) return record;
  return findStructuredProduct(record['@graph']);
}

function structuredText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function structuredImage(value: unknown) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return structuredImage(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return structuredImage(record.url ?? record.contentUrl);
  }
  return '';
}

function absolutePublicUrl(value: string, base: URL) {
  if (!value) return '';
  try {
    return validPublicUrl(new URL(value.replace(/&amp;/gi, '&'), base).toString())?.toString() ?? '';
  } catch {
    return '';
  }
}

function pageImage(html: string, base: URL) {
  const names = ['og:image:secure_url', 'og:image', 'twitter:image'];
  for (const name of names) {
    const escaped = name.replace(':', '\\:');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
    ];
    for (const pattern of patterns) {
      const candidate = absolutePublicUrl(html.match(pattern)?.[1] ?? '', base);
      if (candidate) return candidate;
    }
  }

  // Some furniture catalogues expose schema.org Product microdata without
  // JSON-LD or Open Graph tags. Accept only an element explicitly marked as
  // the product image; a generic page <img> could be a logo or room scene.
  const microdataTag = html.match(/<[^>]+itemprop=["']image["'][^>]*>/i)?.[0]
    ?? html.match(/<[^>]+itemprop=image(?:\s|>)[^>]*>/i)?.[0]
    ?? '';
  if (microdataTag) {
    const candidate = absolutePublicUrl(
      microdataTag.match(/(?:content|src|href)=["']([^"']+)["']/i)?.[1] ?? '',
      base,
    );
    if (candidate) return candidate;
  }
  return '';
}

export function knownRetailerProductImage(sourceUrl: string) {
  const source = validPublicUrl(sourceUrl);
  if (!source) return '';
  if (source.hostname === 'www.tikamoon.it' || source.hostname === 'tikamoon.it') {
    const match = source.pathname.match(/^\/art-(.+)-(\d+)\.htm$/i);
    if (!match) return '';
    const [, slug, productId] = match;
    return `https://media.tikamoon.com/images/t_product-picture-1200/website/product/${productId}_A_HD_010/${slug}-${productId}.jpg`;
  }
  return '';
}

async function fetchProductHtml(source: URL, signal = AbortSignal.timeout(8000)) {
  let current = source;
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount === 4) return null;
      const next = absolutePublicUrl(location, current);
      if (!next) return null;
      current = new URL(next);
      continue;
    }
    return { response, source: current };
  }
  return null;
}

async function readProductPageImage(sourceUrl: string, signal?: AbortSignal) {
  const initialSource = validPublicUrl(sourceUrl);
  if (!initialSource || !initialSource.hostname.includes('.') || initialSource.hostname.endsWith('.local') || initialSource.hostname.endsWith('.internal')) return '';
  try {
    const fetched = await fetchProductHtml(initialSource, signal ?? AbortSignal.timeout(8000));
    if (!fetched) return '';
    const { response, source } = fetched;
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) return '';
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > 3_000_000) return '';
    const html = (await response.text()).slice(0, 3_000_000);
    const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const script of scripts) {
      try {
        const product = findStructuredProduct(JSON.parse(script[1]));
        const image = product ? absolutePublicUrl(structuredImage(product.image), source) : '';
        if (image) return image;
      } catch { /* Ignore malformed structured data and use declared page metadata. */ }
    }
    return pageImage(html, source);
  } catch {
    return '';
  }
}

export async function readProductPage(
  sourceUrl: string,
  category: MaterialProduct['category'] = 'Arredi',
  signal?: AbortSignal,
) {
  const initialSource = validPublicUrl(sourceUrl);
  if (!initialSource || !initialSource.hostname.includes('.') || initialSource.hostname.endsWith('.local') || initialSource.hostname.endsWith('.internal')) return [];
  try {
    const fetched = await fetchProductHtml(initialSource, signal ?? AbortSignal.timeout(8000));
    if (!fetched) return [];
    const { response, source } = fetched;
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) return [];
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > 3_000_000) return [];
    const html = (await response.text()).slice(0, 3_000_000);
    const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    let product: Record<string, unknown> | null = null;
    for (const script of scripts) {
      try {
        product = findStructuredProduct(JSON.parse(script[1]));
        if (product) break;
      } catch { /* Ignore malformed structured data and fall back to Grok. */ }
    }
    if (!product) return [];
    const name = structuredText(product.name);
    if (!name) return [];
    const brandValue = product.brand;
    const brand = typeof brandValue === 'object' && brandValue ? structuredText((brandValue as Record<string, unknown>).name) : structuredText(brandValue);
    const properties = new Map<string, string>();
    const additionalProperties = Array.isArray(product.additionalProperty) ? product.additionalProperty : [];
    for (const item of additionalProperties) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const key = structuredText(record.name).toLocaleLowerCase('it');
      const unit = structuredText(record.unitCode);
      const value = structuredText(record.value) || (typeof record.value === 'number' ? String(record.value) : '');
      if (key && value) properties.set(key, `${value}${unit ? ` ${unit}` : ''}`);
    }
    const dimensions = [
      properties.get('larghezza') ? `L ${properties.get('larghezza')}` : '',
      properties.get('profondità') ? `P ${properties.get('profondità')}` : '',
      properties.get('altezza') ? `H ${properties.get('altezza')}` : '',
    ].filter(Boolean).join(' · ');
    const productImageUrl = absolutePublicUrl(structuredImage(product.image), source) || pageImage(html, source);
    return normalizeProducts([{
      name,
      brand: brand || source.hostname.replace(/^www\./, ''),
      collection: properties.get('collection') ?? '',
      category,
      color: structuredText(product.color),
      effect: properties.get('effetto') ?? '',
      format: dimensions || structuredText(product.size),
      finish: properties.get('finitura') ?? properties.get('finitura della struttura') ?? '',
      description: structuredText(product.description).replace(/\s+/g, ' ').slice(0, 700),
      sourceUrl: source.toString(),
      productImageUrl,
      textureImageUrl: '',
      roomImageUrls: [],
      confidence: .98,
      official: false,
      correction: 'Dati letti direttamente dalla pagina prodotto',
    }]);
  } catch {
    return [];
  }
}

export async function enrichFurnitureProductImages(
  products: MaterialProduct[],
  options: { concurrency?: number; maxLookups?: number; timeoutMs?: number } = {},
) {
  const enriched = products.map((product) => ({ ...product }));
  const maxLookups = Math.max(0, options.maxLookups ?? 4);
  const candidateIndexes = enriched
    .map((product, index) => product.category === 'Arredi' && !product.productImageUrl ? index : -1)
    .filter((index) => index >= 0)
    .slice(0, maxLookups);
  if (!candidateIndexes.length) return enriched;

  const signal = AbortSignal.timeout(Math.max(250, options.timeoutMs ?? 5000));
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, candidateIndexes.length));
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidateIndexes.length && !signal.aborted) {
      const index = candidateIndexes[cursor++];
      const product = enriched[index];
      const knownImage = knownRetailerProductImage(product.sourceUrl);
      if (knownImage) {
        enriched[index] = { ...product, productImageUrl: knownImage };
        continue;
      }
      const productImageUrl = await readProductPageImage(product.sourceUrl, signal);
      if (productImageUrl) enriched[index] = { ...product, productImageUrl };
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return enriched;
}

export async function searchMaterials(provider: AiProvider, query: string) {
  const isFurnitureSearch = /Tipo prodotto:\s*Arredi/i.test(query);
  const hasExactSourceUrl = /Pagina prodotto esatta:\s*https?:\/\//i.test(query);
  const prompt = [
    'You are the verification engine for a professional Italian architectural-material search application.',
    'Interpret spelling mistakes and informal color descriptions. Detect brand, collection, official product or color, effect, size and finish.',
    'Known starting manufacturers and aliases: Lea Ceramiche (Lea), Marazzi, EnergieKer (Energieker), Ceramica Senio (Senio), Ceramica Euro (Euro). Distinguish the Ceramica Euro manufacturer from retailers named Euro Ceramiche.',
    'When the query provides separate brand, model or collection, color and product type criteria, require the result to satisfy all non-empty criteria. Do not silently substitute another brand.',
    isFurnitureSearch
      ? 'This is a furniture search. A term such as Chesterfield, Scandinavian or modular can be a style rather than a brand or model. When no brand is supplied, find real matching products from identifiable manufacturers or established furniture retailers; do not reject the search merely because the user omitted a brand.'
      : 'This is an architectural material search. Search official manufacturer pages and official catalogs first.',
    isFurnitureSearch
      ? 'For furniture, prefer a manufacturer page; otherwise accept a reputable retailer product page, set official=false, and use the actual seller or manufacturer as brand. The source URL must show the exact furniture item. Return a direct product image only when it is clearly tied to that exact page.'
      : 'Use manufacturer-owned sources and images for materials.',
    hasExactSourceUrl
      ? 'The user supplied the exact product page. Open that URL directly, do not perform a general search, extract only the product shown there, and answer immediately.'
      : 'Keep this lookup fast: perform one focused web search, open at most two promising pages, then answer immediately.',
    'Never invent a collection, color, format, finish, URL or image.',
    'If the requested color is not official, use correction to explain the nearest verified official alternative in Italian.',
    'The product source URL must support the exact association.',
    'Classify images strictly: productImageUrl is a verified product sample or swatch; textureImageUrl is only a verified flat/front-facing texture suitable for surface rendering; roomImageUrls contains only room scenes or installed-product photos.',
    'Never use a room scene, catalog cover, logo or generic collection photo as a product image or texture. Never classify the same URL as more than one image type.',
    isFurnitureSearch
      ? 'For furniture, productImageUrl may come from the exact verified manufacturer or reputable retailer product page. textureImageUrl must always be empty. roomImageUrls may contain only room scenes showing the exact item.'
      : 'Use only manufacturer-owned image assets that are confidently associated with the exact product and color. When an image type is unavailable, return an empty string or empty array.',
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
      tools: [{ type: 'web_search' }],
      max_tool_calls: hasExactSourceUrl ? 1 : isFurnitureSearch ? 4 : 2,
      max_output_tokens: 1800,
      reasoning: { effort: 'low' },
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

type SupportedImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' | '2:1' | '1:2' | 'auto';

export function chooseSupportedImageAspectRatio(width: number, height: number): SupportedImageAspectRatio {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'auto';
  const ratio = width / height;
  const supported: Array<{ name: Exclude<SupportedImageAspectRatio, 'auto'>; ratio: number }> = [
    { name: '1:1', ratio: 1 },
    { name: '16:9', ratio: 16 / 9 },
    { name: '9:16', ratio: 9 / 16 },
    { name: '4:3', ratio: 4 / 3 },
    { name: '3:4', ratio: 3 / 4 },
    { name: '3:2', ratio: 3 / 2 },
    { name: '2:3', ratio: 2 / 3 },
    { name: '2:1', ratio: 2 },
    { name: '1:2', ratio: .5 },
  ];
  return [...supported].sort((left, right) => (
    Math.abs(Math.log(ratio / left.ratio)) - Math.abs(Math.log(ratio / right.ratio))
  ))[0].name;
}

function imageDimensions(bytes: Uint8Array) {
  const isPng = bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 1 >= bytes.length) break;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if (startOfFrame.has(marker) && segmentLength >= 7) {
        return {
          height: (bytes[offset + 3] << 8) | bytes[offset + 4],
          width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        };
      }
      offset += segmentLength;
    }
  }
  return null;
}

async function sourceImageAspectRatio(file: File) {
  const dimensions = imageDimensions(new Uint8Array(await file.arrayBuffer()));
  return dimensions ? chooseSupportedImageAspectRatio(dimensions.width, dimensions.height) : 'auto';
}

function polygonArea(points: Array<{ x: number; y: number }>) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

function isSimpleRoomPolygon(points: Array<{ x: number; y: number }>) {
  if (points.length < 3 || polygonArea(points) <= .001) return false;
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => (
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  );
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    if (Math.hypot(points[first].x - points[firstNext].x, points[first].y - points[firstNext].y) < .002) return false;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (firstNext === second || secondNext === first) continue;
      if (cross(points[first], points[firstNext], points[second]) * cross(points[first], points[firstNext], points[secondNext]) < -1e-10
        && cross(points[second], points[secondNext], points[first]) * cross(points[second], points[secondNext], points[firstNext]) < -1e-10) return false;
    }
  }
  return true;
}

function looksLikeFrontalWallStrip(surface: DetectedRoomSurface) {
  if (surface.kind !== 'wall' || surface.points.length !== 4) return false;
  const orderedByY = [...surface.points].sort((a, b) => a.y - b.y);
  const top = orderedByY.slice(0, 2);
  const bottom = orderedByY.slice(2);
  const topSpread = Math.abs(top[0].y - top[1].y);
  const bottomSpread = Math.abs(bottom[0].y - bottom[1].y);
  const height = Math.min(...bottom.map((point) => point.y)) - Math.max(...top.map((point) => point.y));
  return topSpread <= .04 && bottomSpread <= .08 && height >= .24;
}

function mergeFrontalWallStrips(surfaces: DetectedRoomSurface[]) {
  const strips = surfaces.filter(looksLikeFrontalWallStrip);
  if (strips.length < 2) return surfaces;

  const intervals = strips.map((surface) => {
    const xs = surface.points.map((point) => point.x);
    return { left: Math.min(...xs), right: Math.max(...xs) };
  }).sort((a, b) => a.left - b.left);
  const coveredLeft = intervals[0].left;
  const coveredRight = intervals.at(-1)?.right ?? coveredLeft;
  const hasLargeGap = intervals.slice(1).some((interval, index) => interval.left - intervals[index].right > .045);
  if (hasLargeGap || coveredRight - coveredLeft < .55) return surfaces;

  const floor = surfaces.find((surface) => surface.kind === 'floor');
  const floorBoundary = floor?.points
    .filter((point) => point.y < .92 && point.x >= coveredLeft - .03 && point.x <= coveredRight + .03)
    .sort((a, b) => a.x - b.x) ?? [];
  if (floorBoundary.length < 2) return surfaces;

  const leftFloor = floorBoundary[0];
  const rightFloor = floorBoundary[floorBoundary.length - 1];
  const lowerEdge = [
    ...(coveredRight - rightFloor.x > .01 ? [{ x: coveredRight, y: rightFloor.y }] : []),
    ...[...floorBoundary].reverse(),
    ...(leftFloor.x - coveredLeft > .01 ? [{ x: coveredLeft, y: leftFloor.y }] : []),
  ];
  const top = Math.min(...strips.flatMap((surface) => surface.points.map((point) => point.y)));
  const merged: DetectedRoomSurface = {
    name: 'Muro principale',
    kind: 'wall',
    confidence: Math.min(...strips.map((surface) => surface.confidence)),
    points: [{ x: coveredLeft, y: top }, { x: coveredRight, y: top }, ...lowerEdge].slice(0, 24),
  };
  const stripSet = new Set(strips);
  return [merged, ...surfaces.filter((surface) => !stripSet.has(surface))];
}

function extendSingleFrontalWallToImageTop(surfaces: DetectedRoomSurface[]) {
  if (surfaces.some((surface) => surface.kind === 'ceiling')) return surfaces;
  const walls = surfaces.filter((surface) => surface.kind === 'wall');
  if (walls.length !== 1) return surfaces;
  const wall = walls[0];
  const xs = wall.points.map((point) => point.x);
  const top = Math.min(...wall.points.map((point) => point.y));
  if (Math.max(...xs) - Math.min(...xs) < .9 || top < .025 || top > .2) return surfaces;
  return surfaces.map((surface) => surface === wall ? {
    ...surface,
    points: surface.points.map((point) => point.y <= top + .04 ? { ...point, y: 0 } : point),
  } : surface);
}

export function normalizeRoomSurfaces(surfaces: DetectedRoomSurface[]) {
  const validKinds = new Set<DetectedRoomSurface['kind']>(['wall', 'floor', 'ceiling', 'door', 'window', 'other']);
  const cleaned = surfaces.slice(0, 16).map((surface) => ({
    ...surface,
    name: String(surface.name ?? '').trim().slice(0, 80),
    confidence: Math.min(1, Math.max(0, Number(surface.confidence) || 0)),
    points: (surface.points ?? []).slice(0, 24).map((point) => ({
      x: Math.min(1, Math.max(0, Number(point.x))),
      y: Math.min(1, Math.max(0, Number(point.y))),
    })),
  })).filter((surface) => {
    const minimumConfidence = surface.kind === 'window' || surface.kind === 'door' ? .3 : .45;
    return validKinds.has(surface.kind) && surface.confidence >= minimumConfidence && isSimpleRoomPolygon(surface.points);
  });

  const withoutFalseCeiling = cleaned.filter((surface) => {
    if (surface.kind !== 'ceiling') return true;
    const ys = surface.points.map((point) => point.y);
    return Math.max(...ys) - Math.min(...ys) >= .08;
  });
  const merged = extendSingleFrontalWallToImageTop(mergeFrontalWallStrips(withoutFalseCeiling));
  const detectedFloor = merged.find((surface) => surface.kind === 'floor');
  const typed = merged.map((surface) => surface.kind === 'door' || surface.kind === 'window'
    ? normalizeOpeningKind(surface, detectedFloor)
    : surface);
  const validated = validateRoomGeometry(typed).surfaces;
  const kindOrder: Record<DetectedRoomSurface['kind'], number> = { wall: 0, floor: 1, ceiling: 2, door: 3, window: 4, other: 5 };
  validated.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]);
  const counters: Partial<Record<DetectedRoomSurface['kind'], number>> = {};
  return validated.map((surface) => {
    counters[surface.kind] = (counters[surface.kind] ?? 0) + 1;
    const count = counters[surface.kind] as number;
    const base = surface.kind === 'wall' ? 'Muro'
      : surface.kind === 'floor' ? 'Pavimento'
        : surface.kind === 'ceiling' ? 'Soffitto'
          : surface.kind === 'door' ? 'Porta'
            : surface.kind === 'window' ? 'Finestra'
              : 'Superficie';
    const repeatedKind = validated.filter((candidate) => candidate.kind === surface.kind).length > 1;
    return { ...surface, name: repeatedKind || surface.kind === 'wall' ? `${base} ${count}` : base };
  });
}

function surfaceBounds(surface: DetectedRoomSurface) {
  const xs = surface.points.map((point) => point.x);
  const ys = surface.points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

function floorBoundaryAtX(floor: DetectedRoomSurface | undefined, x: number) {
  if (!floor) return null;
  const intersections: number[] = [];
  floor.points.forEach((point, index) => {
    const next = floor.points[(index + 1) % floor.points.length];
    const minimum = Math.min(point.x, next.x) - .0001;
    const maximum = Math.max(point.x, next.x) + .0001;
    if (x < minimum || x > maximum) return;
    if (Math.abs(next.x - point.x) < .0001) {
      intersections.push(Math.min(point.y, next.y));
      return;
    }
    const ratio = (x - point.x) / (next.x - point.x);
    if (ratio >= 0 && ratio <= 1) intersections.push(point.y + (next.y - point.y) * ratio);
  });
  return intersections.length ? Math.min(...intersections) : null;
}

function openingOverlap(left: DetectedRoomSurface, right: DetectedRoomSurface) {
  const a = surfaceBounds(left);
  const b = surfaceBounds(right);
  const intersectionWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const intersectionHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const intersection = intersectionWidth * intersectionHeight;
  const areaA = Math.max(.0001, (a.right - a.left) * (a.bottom - a.top));
  const areaB = Math.max(.0001, (b.right - b.left) * (b.bottom - b.top));
  return intersection / (areaA + areaB - intersection);
}

function geometryScore(candidate: DetectedRoomSurface[]) {
  const floor = candidate.find((surface) => surface.kind === 'floor');
  const openings = candidate.filter((surface) => surface.kind === 'door' || surface.kind === 'window');
  const walls = candidate.filter((surface) => surface.kind === 'wall');
  const tinyWallFragments = walls.filter((wall) => {
    const bounds = surfaceBounds(wall);
    return (bounds.right - bounds.left) * (bounds.bottom - bounds.top) < .055;
  }).length;
  const nonWallConfidence = candidate.filter((surface) => surface.kind !== 'wall').reduce((total, surface) => total + surface.confidence, 0);
  const wallConfidence = walls.length ? walls.reduce((total, wall) => total + wall.confidence, 0) / walls.length : 0;
  return nonWallConfidence + wallConfidence
    + (walls.length ? 1.2 : 0)
    - Math.max(0, walls.length - 3) * .65
    - tinyWallFragments * .8
    + (floor ? 4 + Math.min(floor.points.length, 12) * .12 : 0)
    + openings.reduce((total, opening) => total + (opening.points.length === 4 ? 2 : 0), 0);
}

function floorQuality(surface: DetectedRoomSurface) {
  const bounds = surfaceBounds(surface);
  const touchesBottom = bounds.bottom >= .985;
  const touchesSide = bounds.left <= .015 || bounds.right >= .985;
  return surface.confidence + Math.min(surface.points.length, 12) * .08 + (touchesBottom ? 1 : 0) + (touchesSide ? .4 : 0);
}

function normalizeOpeningKind(surface: DetectedRoomSurface, floor: DetectedRoomSurface | undefined) {
  const bounds = surfaceBounds(surface);
  const centerX = (bounds.left + bounds.right) / 2;
  const floorY = floorBoundaryAtX(floor, centerX);
  if (floorY === null) return surface;
  if (bounds.bottom <= floorY - .045) return { ...surface, kind: 'window' as const };
  if (bounds.bottom >= floorY - .035) return { ...surface, kind: 'door' as const };
  return surface;
}

function openingQuality(surface: DetectedRoomSurface, floor: DetectedRoomSurface | undefined) {
  const bounds = surfaceBounds(surface);
  const centerX = (bounds.left + bounds.right) / 2;
  const floorY = floorBoundaryAtX(floor, centerX);
  let score = surface.confidence + (surface.points.length === 4 ? 1 : 0);
  if (floorY !== null) {
    const isAboveFloor = bounds.bottom <= floorY - .045;
    if (surface.kind === 'window') score += isAboveFloor ? 1 : -1.5;
    if (surface.kind === 'door') score += Math.abs(bounds.bottom - floorY) <= .08 ? 1 : -1;
  }
  return score;
}

export function orderQuadClockwise(points: Array<{ x: number; y: number }>) {
  if (points.length !== 4) return points;
  const centerX = points.reduce((total, point) => total + point.x, 0) / 4;
  const centerY = points.reduce((total, point) => total + point.y, 0) / 4;
  const ordered = [...points].sort((left, right) => (
    Math.atan2(left.y - centerY, left.x - centerX) - Math.atan2(right.y - centerY, right.x - centerX)
  ));
  let start = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    const current = ordered[start];
    const candidateScore = candidate.x + candidate.y;
    const currentScore = current.x + current.y;
    if (candidateScore < currentScore - 1e-9 || (Math.abs(candidateScore - currentScore) < 1e-9 && candidate.y < current.y)) {
      start = index;
    }
  }
  return [...ordered.slice(start), ...ordered.slice(0, start)];
}

function consensusOpening(group: DetectedRoomSurface[], floor: DetectedRoomSurface | undefined) {
  const ranked = [...group].sort((left, right) => openingQuality(right, floor) - openingQuality(left, floor));
  // Never average opening vertices: two slightly displaced quads can move a
  // real side window toward the centre. Keep the strongest edge-aligned
  // candidate and let the geometry validator reject impossible placement.
  const best = ranked[0];
  return normalizeOpeningKind({ ...best, points: orderQuadClockwise(best.points) }, floor);
}

export function reconcileRoomSurfaceCandidates(candidates: DetectedRoomSurface[][]) {
  const normalized = candidates.map(normalizeRoomSurfaces).filter((candidate) => candidate.length > 0);
  if (!normalized.length) return [];
  const ranked = [...normalized].sort((left, right) => geometryScore(right) - geometryScore(left));
  const base = [...ranked[0]];

  const floor = normalized.flatMap((candidate) => candidate.filter((surface) => surface.kind === 'floor'))
    .sort((left, right) => floorQuality(right) - floorQuality(left))[0];
  if (floor) {
    const index = base.findIndex((surface) => surface.kind === 'floor');
    if (index >= 0) base[index] = floor;
    else base.push(floor);
  }

  const openings = normalized.flatMap((candidate) => candidate.filter((surface) => surface.kind === 'door' || surface.kind === 'window'));
  const groups: DetectedRoomSurface[][] = [];
  openings.forEach((opening) => {
    // The two independent vision passes often return a tighter glass polygon
    // and a wider outer-frame polygon for the same physical opening. Their IoU
    // can be close to .25 even though they clearly overlap; merge those instead
    // of presenting "Finestra 1" and "Finestra 2" for one real window.
    const group = groups.find((items) => items.some((item) => openingOverlap(item, opening) >= .24));
    if (group) group.push(opening);
    else groups.push([opening]);
  });
  const bestOpenings = groups.map((group) => consensusOpening(group, floor));

  return normalizeRoomSurfaces([
    ...base.filter((surface) => surface.kind !== 'door' && surface.kind !== 'window'),
    ...bestOpenings,
  ]);
}

export async function detectRoomSurfaces(
  provider: AiProvider,
  image: File,
  options: { openingAudit?: boolean; source?: 'photo' | 'floorplan-render' } = {},
) {
  const prompt = [
    'Act as a precise architectural image-plane segmentation engine for an interior-design application.',
    'Trace every visible structural planar surface: the complete floor, each genuinely distinct wall plane, the ceiling only when its plane is actually visible, and visible doors or windows as separate surfaces.',
    'A wall is one continuous architectural plane. Never split the same wall at a door, window, picture, cabinet, chair, color change, wall covering, tile joint, shadow or furniture edge. Infer that wall continuously behind all openings and objects, then return each door or window separately on top of it.',
    'For a mostly frontal wall with several doors, return one wall polygon spanning behind all those doors; never return narrow vertical wall strips aligned to door jambs or furniture.',
    'Do not label the upper part of a wall as ceiling. If the photograph begins on the wall and no ceiling plane is visible, omit the ceiling entirely.',
    'When no ceiling plane is visible, every full-width frontal wall that reaches the top crop must use y=0 for its upper boundary; do not leave an unexplained horizontal gap above it.',
    'Before answering, inspect the entire image explicitly for every architectural opening. Do not omit low-contrast, overexposed or partially cropped windows and doors, including white frames on white walls.',
    'A black or dark metal frame on a white wall is an unmistakable opening candidate: inspect all four external frame edges before tracing other details.',
    'For every visible window or door, trace only the outside edge of the complete architectural frame as its own polygon, separate from the wall behind it. Use exactly four perspective-correct outer corners: top-left, top-right, bottom-right and bottom-left.',
    'Return one door surface per physical framed opening, including an open door seen from the side or at the image edge. Trace the fixed architectural opening between the outer jambs, lintel and threshold. Do not trace the moving door leaf or the corridor seen through it as separate surfaces. Never extend the opening beyond its jambs to a nearby wall edge, cabinet or furniture.',
    'A framed opening that reaches the floor and can be used for passage is a door, including glazed or frosted doors. Call an opening a window only when its complete sill is visibly above the floor.',
    'Never extend the vertical sides of a window down the wall to the floor. The visible horizontal lower frame or sill is the mandatory bottom edge, even when the wall below it is plain and the side jambs visually align with other edges.',
    'Never classify wall-hung pictures, grouped photo frames, mirrors, television screens, shelving units or tall cabinets as doors or windows.',
    'Treat a multi-pane window as one complete opening: include every upper and lower pane inside the outer frame, never return only one sash or one bright section.',
    'A window polygon must reach the outside edge of the head, both jambs and the complete sill. Never stop at an internal mullion, transom, glazing edge or only the bright glass area.',
    'When the frame is white on a white wall, use the frame shadow and sill boundary; include a small amount of outer trim rather than cutting off part of the opening.',
    'If any floor area is visible, a complete floor polygon is mandatory even when the floor is white, glossy or low contrast.',
    'For the floor, trace the wall-floor junction, skirting-board lower edge and every door threshold point by point. Add a vertex at every change of direction instead of replacing the boundary with one approximate straight line. Use up to 24 vertices when needed.',
    'Return polygon vertices as normalized image coordinates where x=0 is the left edge, x=1 the right edge, y=0 the top edge and y=1 the bottom edge.',
    'Follow the real wall-wall, wall-floor and wall-ceiling junctions. Do not use furniture edges, window frames, shadows, tile joints, rugs or decorations as room corners.',
    'Infer each architectural plane continuously behind furniture and other movable objects. A floor polygon must cover the entire floor plane all the way to the bottom and lateral image edges wherever the floor leaves the frame, not only a central trapezoid.',
    'Use the image-edge coordinate 0 or 1 when a surface continues outside the crop. Keep points in clockwise boundary order, with no self-intersections. Architectural accuracy is more important than minimizing the number of vertices.',
    'Do not invent a plane that is not visible. Confidence measures the geometric accuracy of each polygon, not object-recognition confidence.',
    'Names may be short Italian labels; they will be normalized by the application.',
  ].join('\n');
  const imageUrl = await fileToDataUri(image);
  const requestGeometry = async (
    instruction: string,
    effort: 'low' | 'medium' | 'high',
    maxOutputTokens: number,
    timeoutMs: number,
  ) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(provider.id === 'grok' ? 'https://api.x.ai/v1/responses' : 'https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: provider.id === 'grok' ? 'grok-4.6' : 'gpt-5.4-mini',
          input: [{
            role: 'user',
            content: [
              { type: 'input_image', image_url: imageUrl, detail: 'high' },
              { type: 'input_text', text: instruction },
            ],
          }],
          max_output_tokens: maxOutputTokens,
          reasoning: { effort },
          text: { format: { type: 'json_schema', name: 'room_surface_geometry', schema: roomGeometrySchema, strict: true } },
          store: false,
        }),
        signal: controller.signal,
      });
      const payload = await response.json() as ResponsesPayload;
      if (!response.ok) throw new Error(payload.error?.message ?? 'Riconoscimento della stanza non disponibile.');
      const parsed = JSON.parse(responseText(payload).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as { surfaces?: DetectedRoomSurface[] };
      return parsed.surfaces ?? [];
    } finally {
      clearTimeout(timeout);
    }
  };

  const auditPrompt = [
    'Perform an independent second architectural segmentation of the complete image. Work at pixel accuracy and return the full geometry.',
    'Reject false walls, doors and windows caused by furniture, wall pictures, cabinets, reflections or shadows. Include every real architectural opening.',
    'Check every floor-boundary vertex against the visible skirting-board lower edge, wall-floor junction and door thresholds. Add vertices wherever that boundary changes direction; do not simplify several planes into one diagonal line.',
    'For each door or window return exactly four tight outer-frame corners in clockwise order. A door must terminate at its real threshold and must not include adjacent wall, corridor or furniture. A window must terminate at its sill.',
    'Check the left and right image edges and every visible room corner at high zoom. Coordinates must be normalized to the complete source image, not a crop.',
    'Return the entire surface list and no comments.',
  ].join('\n');
  const openingAuditPrompt = [
    prompt,
    'This image is an empty room generated from an architectural floor plan. Treat every repeated framed rectangle as a separate physical opening, not as decoration.',
    'Opening-first verification pass: count every visible door and window before tracing the room planes. Inspect the left wall, frontal wall, right wall and both image edges independently.',
    'Return one separate four-corner polygon for every complete or partially cropped architectural frame. Keep several similar windows as several windows; never merge distant openings.',
    'After the opening count, return the complete floor and wall geometry as well so each opening can be attached to its real wall. Return the full surface list and no comments.',
  ].join('\n\n');
  const requests = [
    requestGeometry(prompt, 'low', 3000, 50000),
    requestGeometry(`${prompt}\n\n${auditPrompt}`, 'low', 3000, 50000),
  ];
  if (options.openingAudit || options.source === 'floorplan-render') {
    requests.push(requestGeometry(openingAuditPrompt, 'medium', 3400, 60000));
  }
  const attempts = await Promise.allSettled(requests);
  const candidates = attempts
    .filter((attempt): attempt is PromiseFulfilledResult<DetectedRoomSurface[]> => attempt.status === 'fulfilled' && attempt.value.length > 0)
    .map((attempt) => attempt.value);
  if (!candidates.length) {
    const recoveryPrompt = [
      prompt,
      'Recovery pass: respond quickly but inspect the complete image. Return the main wall planes, the complete floor, and every clearly framed door or window. A dark rectangular frame above the floor must end at its sill and is a window.',
    ].join('\n\n');
    try {
      const recovered = await requestGeometry(recoveryPrompt, 'low', 2600, 35000);
      if (recovered.length) candidates.push(recovered);
    } catch {
      const failure = attempts.find((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected');
      throw failure?.reason instanceof Error ? failure.reason : new Error('Riconoscimento della stanza non disponibile.');
    }
  }
  const surfaces = reconcileRoomSurfaceCandidates(candidates);
  if (!surfaces.length) throw new Error('Non ho riconosciuto superfici affidabili in questa foto.');
  return surfaces;
}

export async function detectObjectRegion(provider: AiProvider, image: File, point: { x: number; y: number }) {
  const x = Math.min(1, Math.max(0, Number(point.x)));
  const y = Math.min(1, Math.max(0, Number(point.y)));
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Punto di pulizia non valido.');
  const imageUrl = await fileToDataUri(image);
  const response = await fetch(provider.id === 'grok' ? 'https://api.x.ai/v1/responses' : 'https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.id === 'grok' ? 'grok-4.6' : 'gpt-5.4-mini',
      input: [{ role: 'user', content: [
        { type: 'input_image', image_url: imageUrl, detail: 'high' },
        { type: 'input_text', text: [
          `The user clicked normalized image coordinate x=${x.toFixed(4)}, y=${y.toFixed(4)} in an interior photograph after an empty-room edit.`,
          'Identify the single movable or decorative residual object whose visible pixels contain that point (furniture, lamp, rug, curtain, picture, loose decoration).',
          'Never select a wall, floor, ceiling, door, window, opening, radiator, skirting or other fixed architectural element.',
          'If a removable object is present, return a tight clockwise polygon around its complete visible silhouette, with 4 to 16 normalized points and a short Italian label.',
          'Include a small 1-2% repair margin around the silhouette, but do not include unrelated architecture. If the point is only on architecture or empty space, found must be false and points must be empty.',
          'Return only the structured result.',
        ].join('\n') },
      ] }],
      max_output_tokens: 650,
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'residual_object_region', schema: objectRegionSchema, strict: true } },
      store: false,
    }),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json() as ResponsesPayload;
  if (!response.ok) throw new Error(payload.error?.message ?? 'Riconoscimento dell’oggetto non disponibile.');
  const parsed = JSON.parse(responseText(payload).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as { found?: boolean; label?: string; points?: Array<{ x: number; y: number }>; confidence?: number };
  const points = (parsed.points ?? []).slice(0, 16).map((candidate) => ({
    x: Math.min(1, Math.max(0, Number(candidate.x))), y: Math.min(1, Math.max(0, Number(candidate.y))),
  }));
  if (!parsed.found || Number(parsed.confidence) < .45 || !isSimpleRoomPolygon(points)) return null;
  return { label: String(parsed.label || 'Oggetto residuo').trim().slice(0, 80), points, confidence: Math.min(1, Math.max(0, Number(parsed.confidence))) } satisfies DetectedObjectRegion;
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

async function removeFurnitureBackgroundWithBriaData(apiKey: string, inputImage: string) {
  const response = await fetch('https://engine.prod.bria-api.com/v2/image/edit/remove_background', {
    method: 'POST',
    headers: { api_token: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: inputImage, preserve_alpha: true, sync: true }),
    signal: AbortSignal.timeout(90000),
  });
  const payload = await response.json() as { result?: { image_url?: string }; error?: { message?: string }; message?: string };
  const resultUrl = payload.result?.image_url;
  if (!response.ok || !resultUrl) {
    throw new Error(payload.error?.message ?? payload.message ?? 'BRIA non ha scontornato il prodotto.');
  }
  return remoteImageToDataUri(resultUrl);
}

export async function removeFurnitureBackgroundWithBria(apiKey: string, imageUrl: string) {
  const reference = validPublicUrl(imageUrl);
  if (!reference) throw new Error('Foto prodotto non valida.');
  const headers: Record<string, string> = { Accept: 'image/jpeg,image/png,image/webp' };
  if (reference.hostname === 'media.tikamoon.com') headers.Referer = 'https://www.tikamoon.it/';
  const inputResponse = await fetch(reference, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers });
  const finalInputUrl = validPublicUrl(inputResponse.url || reference.toString());
  const inputType = inputResponse.headers.get('content-type')?.split(';')[0] ?? '';
  if (!inputResponse.ok || !finalInputUrl || !['image/jpeg', 'image/png', 'image/webp'].includes(inputType)) {
    throw new Error('La fotografia ufficiale del prodotto non è scaricabile.');
  }
  const inputBytes = new Uint8Array(await inputResponse.arrayBuffer());
  if (inputBytes.byteLength > 12 * 1024 * 1024) throw new Error('La fotografia del prodotto è troppo grande.');
  return removeFurnitureBackgroundWithBriaData(apiKey, `data:${inputType};base64,${bytesToBase64(inputBytes)}`);
}

export async function removeFurnitureFileBackgroundWithBria(apiKey: string, file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('La foto prodotto deve essere JPG, PNG o WEBP.');
  }
  if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('La foto prodotto supera il limite di 12 MB.');
  return removeFurnitureBackgroundWithBriaData(apiKey, await fileToDataUri(file));
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
  referenceImageFile?: File | null;
  prompt: string;
  maskExplanation?: string;
}) {
  if (provider.id === 'grok') {
    const aspectRatio = await sourceImageAspectRatio(input.source);
    const images: Array<{ type: 'image_url'; url: string }> = [
      { type: 'image_url', url: await fileToDataUri(input.source) },
    ];
    if (input.mask) images.push({ type: 'image_url', url: await fileToDataUri(input.mask) });
    if (input.referenceImageFile && images.length < 3) images.push({ type: 'image_url', url: await fileToDataUri(input.referenceImageFile) });
    const reference = input.referenceImageUrl ? validPublicUrl(input.referenceImageUrl) : null;
    if (reference && images.length < 3) images.push({ type: 'image_url', url: reference.toString() });
    const prompt = [
      input.prompt,
      input.mask && input.maskExplanation ? `The second image is a technical guide, not part of the room: ${input.maskExplanation}` : '',
      input.referenceImageFile ? 'One additional image is the exact furniture reference selected by the user.' : '',
      reference && images.some((image) => image.url === reference.toString()) ? 'One additional image is the exact material reference selected by the user.' : '',
    ].filter(Boolean).join(' ');
    const response = await fetch('https://api.x.ai/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-imagine-image-2.0',
        prompt,
        aspect_ratio: aspectRatio,
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
  if (input.referenceImageFile) form.append('image[]', input.referenceImageFile, input.referenceImageFile.name || 'furniture-reference.jpg');
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

export async function cleanFurnitureReference(provider: AiProvider, imageUrl: string, productName: string) {
  const reference = validPublicUrl(imageUrl);
  if (!reference) throw new Error('Foto prodotto non valida.');
  if (provider.id !== 'grok') throw new Error('La pulizia automatica del prodotto richiede Grok Imagine.');
  const response = await fetch('https://api.x.ai/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'grok-imagine-image-2.0',
      image: { type: 'image_url', url: reference.toString() },
      prompt: [
        `Create a clean e-commerce isolation of the exact furniture product “${productName}” shown in the source photograph.`,
        'Preserve the product identity, proportions, number and shape of doors, handles, legs, wood grain, color, finish and camera-facing orientation exactly.',
        'Remove every other object: books, lamps, artwork, decorations, walls, floor, rugs, foreground furniture, labels, arrows, dimension text and all original cast shadows.',
        'Show the complete furniture body and every leg, fully inside the frame with generous empty margin. Do not crop, redesign, repair, add or remove product parts.',
        'Place it alone on a perfectly uniform pure white (#FFFFFF) background with no horizon, no floor line, no reflection and no shadow. Photorealistic catalog cutout, no text.',
      ].join('\n'),
    }),
    signal: AbortSignal.timeout(90000),
  });
  const payload = await response.json() as ImagePayload;
  const result = payload.data?.[0];
  if (!response.ok || (!result?.url && !result?.b64_json)) {
    throw new Error(payload.error?.message ?? 'Grok non ha ripulito la foto del mobile.');
  }
  if (result.b64_json) return `data:${result.mime_type ?? 'image/jpeg'};base64,${result.b64_json}`;
  return remoteImageToDataUri(result.url as string);
}

export async function verifyFurniturePlacement(provider: AiProvider, input: {
  source: File;
  renderedImage: string;
  furniture: string;
  referenceImageUrl?: string | null;
  referenceImageFile?: File | null;
}) {
  const sourceImage = await fileToDataUri(input.source);
  const reference = input.referenceImageUrl ? validPublicUrl(input.referenceImageUrl) : null;
  const content: Array<Record<string, unknown>> = [
    { type: 'input_image', image_url: sourceImage, detail: 'high' },
    { type: 'input_image', image_url: input.renderedImage, detail: 'high' },
  ];
  if (input.referenceImageFile) content.push({ type: 'input_image', image_url: await fileToDataUri(input.referenceImageFile), detail: 'high' });
  else if (reference) content.push({ type: 'input_image', image_url: reference.toString(), detail: 'high' });
  content.push({
    type: 'input_text',
    text: [
      'You are a strict visual quality gate. Image 1 is the room before editing. Image 2 is the proposed render. Image 3, when present, is the exact product reference.',
      `Required furniture and placement: ${input.furniture}`,
      'Set visible=true only if every requested furniture item is clearly visible in image 2.',
      'Set atRequestedAnchor=true only if each floor-contact point is close to the requested x/y percentage and the visible size is close to the requested width.',
      'Set atRequestedOrientation=true only if each item uses the requested floor-plane yaw relative to the front, left or right wall. The furniture must remain upright: a rolled or tilted catalog image is false.',
      'Set resemblesReference=true only if the rendered item preserves the recognizable shape, proportions, material and color of the supplied product reference. If no reference is present, judge the requested description conservatively.',
      'Set physicallyGrounded=true only if every leg or base visibly meets the detected floor plane, without floating, sinking or wall-mounting, and the contact shadow follows the room light.',
      'Set contactShadow=true only when image 2 has a visible but natural soft contact shadow or ambient-occlusion darkening directly beneath every floor contact. A uniformly crisp pasted lower edge, a bright gap, or an object with no localized floor darkening must be false even if its outline touches the floor.',
      'Set structurallyComplete=true only if no leg, door, handle, edge or other visible product part from the reference was removed, merged, cropped or invented.',
      'Set realisticLighting=true only if perspective, illumination, color temperature, sharpness and directional shadows make the furniture look photographed inside image 1 rather than pasted on top.',
      'When image 3 is present, return the tight normalized bounding box of the furniture body only in referenceLeft/referenceTop/referenceRight/referenceBottom. Exclude wall, floor, artwork, lamps, books, labels, arrows, dimension text, shadows and foreground objects. If no reference exists, return 0,0,1,1.',
      'A room that looks unchanged or omits the item must fail. Return only the structured result.',
    ].join('\n'),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  try {
    const response = await fetch(provider.id === 'grok' ? 'https://api.x.ai/v1/responses' : 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.id === 'grok' ? 'grok-4.6' : 'gpt-5.4-mini',
        input: [{ role: 'user', content }],
        max_output_tokens: 500,
        reasoning: { effort: 'low' },
        text: { format: { type: 'json_schema', name: 'furniture_render_verification', schema: furnitureVerificationSchema, strict: true } },
        store: false,
      }),
      signal: controller.signal,
    });
    const payload = await response.json() as ResponsesPayload;
    if (!response.ok) throw new Error(payload.error?.message ?? 'Verifica del mobile non disponibile.');
    return JSON.parse(responseText(payload)) as FurnitureRenderVerification;
  } finally {
    clearTimeout(timeout);
  }
}

export async function locateProductReference(provider: AiProvider, imageUrl: string, productName: string) {
  const reference = validPublicUrl(imageUrl);
  if (!reference) throw new Error('Foto prodotto non valida.');
  const response = await fetch(provider.id === 'grok' ? 'https://api.x.ai/v1/responses' : 'https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.id === 'grok' ? 'grok-4.6' : 'gpt-5.4-mini',
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: reference.toString(), detail: 'high' },
          { type: 'input_text', text: `Locate only the physical body of “${productName}” in this catalog photograph. Return a tight normalized bounding box around the product itself. Exclude wall, floor, artwork, lamps, books, decorations, people, labels, arrows, dimension text, shadows and foreground objects.` },
        ],
      }],
      max_output_tokens: 300,
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'product_reference_bounds', schema: productBoundsSchema, strict: true } },
      store: false,
    }),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json() as ResponsesPayload;
  if (!response.ok) throw new Error(payload.error?.message ?? 'Ritaglio prodotto non disponibile.');
  return JSON.parse(responseText(payload)) as { left: number; top: number; right: number; bottom: number; confidence: number };
}
