import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptsFurnitureRender, chooseSupportedImageAspectRatio, detectObjectRegion, detectRoomSurfaces, editImage, enrichFurnitureProductImages, getAiProvider, getProductCleaner, getRenderProvider, knownRetailerProductImage, normalizeRoomSurfaces, orderQuadClockwise, readProductPage, reconcileRoomSurfaceCandidates, removeFurnitureBackgroundWithBria, searchMaterials } from './ai-provider';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAiProvider', () => {
  it('prefers Grok when an xAI key is available', () => {
    expect(getAiProvider({ XAI_API_KEY: 'xai-test' })).toEqual({
      id: 'grok',
      label: 'Grok',
      apiKey: 'xai-test',
    });
  });

  it('respects an explicit OpenAI fallback', () => {
    expect(getAiProvider({ AI_PROVIDER: 'openai', XAI_API_KEY: 'xai-test', OPENAI_API_KEY: 'openai-test' })).toEqual({
      id: 'openai',
      label: 'OpenAI',
      apiKey: 'openai-test',
    });
  });

  it('does not silently use another provider when Grok was explicitly selected', () => {
    expect(getAiProvider({ AI_PROVIDER: 'grok', OPENAI_API_KEY: 'openai-test' })).toBeNull();
  });

  it('keeps Grok for analysis but prefers OpenAI for masked rendering', () => {
    const environment = { XAI_API_KEY: 'xai-test', OPENAI_API_KEY: 'openai-test' };
    expect(getAiProvider(environment)?.id).toBe('grok');
    expect(getRenderProvider(environment)).toEqual({ id: 'openai', label: 'OpenAI', apiKey: 'openai-test' });
  });

  it('respects an explicitly selected render provider', () => {
    expect(getRenderProvider({ RENDER_PROVIDER: 'grok', XAI_API_KEY: 'xai-test', OPENAI_API_KEY: 'openai-test' })).toEqual({
      id: 'grok', label: 'Grok', apiKey: 'xai-test',
    });
    expect(getRenderProvider({ RENDER_PROVIDER: 'openai', XAI_API_KEY: 'xai-test' })).toEqual({
      id: 'grok', label: 'Grok', apiKey: 'xai-test',
    });
  });

  it('prefers BRIA for product cleanup and falls back to Grok Imagine', () => {
    expect(getProductCleaner({ BRIA_API_KEY: 'bria-test', XAI_API_KEY: 'xai-test' })).toEqual({
      id: 'bria', label: 'BRIA RMBG 2.0', apiKey: 'bria-test',
    });
    expect(getProductCleaner({ XAI_API_KEY: 'xai-test' })).toEqual({
      id: 'grok', label: 'Grok Imagine 2.0', apiKey: 'xai-test',
    });
    expect(getProductCleaner({ PRODUCT_CLEANER: 'bria', XAI_API_KEY: 'xai-test' })).toEqual({
      id: 'grok', label: 'Grok Imagine 2.0', apiKey: 'xai-test',
    });
  });

  it('calls the BRIA RMBG endpoint and returns its transparent image', async () => {
    const inputResponse = new Response(new Uint8Array([255, 216, 255, 224]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    Object.defineProperty(inputResponse, 'url', { value: 'https://shop.example/product.jpg' });
    const resultResponse = new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
    Object.defineProperty(resultResponse, 'url', { value: 'https://cdn.bria.ai/result.png' });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(inputResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { image_url: 'https://cdn.bria.ai/result.png' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(resultResponse);

    await expect(removeFurnitureBackgroundWithBria('bria-test', 'https://shop.example/product.jpg'))
      .resolves.toMatch(/^data:image\/png;base64,/);

    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://engine.prod.bria-api.com/v2/image/edit/remove_background');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: { api_token: 'bria-test', 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      image: expect.stringMatching(/^data:image\/jpeg;base64,/), preserve_alpha: true, sync: true,
    });
  });

  it('derives the official Tikamoon packshot URL from an exact product page', () => {
    expect(knownRetailerProductImage('https://www.tikamoon.it/art-mobile-per-il-bagno-in-legno-di-mango-164-cm-6539.htm?utm_source=test'))
      .toBe('https://media.tikamoon.com/images/t_product-picture-1200/website/product/6539_A_HD_010/mobile-per-il-bagno-in-legno-di-mango-164-cm-6539.jpg');
  });

  it('keeps Grok product lookup bounded for a responsive UI', async () => {
    const product = {
      name: 'Intense Clair',
      brand: 'Lea Ceramiche',
      collection: 'Intense',
      category: 'Pavimenti' as const,
      color: 'Clair',
      effect: 'Pietra',
      format: '60 × 120 cm',
      finish: 'Naturale',
      description: 'Gres porcellanato chiaro',
      sourceUrl: 'https://www.leaceramiche.com/products/collection/intense',
      productImageUrl: 'https://www.leaceramiche.com/images/intense-clair-sample.jpg',
      textureImageUrl: '',
      roomImageUrls: ['https://www.leaceramiche.com/images/intense-clair-room.jpg'],
      confidence: 0.95,
      official: true,
      correction: '',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ products: [product] }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(searchMaterials({ id: 'grok', label: 'Grok', apiKey: 'xai-test' }, 'Intense Lea')).resolves.toEqual([product]);

    const request = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body));
    expect(payload).toMatchObject({
      model: 'grok-4.6',
      max_tool_calls: 2,
      max_output_tokens: 1800,
      reasoning: { effort: 'low' },
      tools: [{ type: 'web_search' }],
      text: { format: { schema: { properties: { products: { items: { required: expect.arrayContaining(['productImageUrl', 'textureImageUrl', 'roomImageUrls']) } } } } } },
    });
  });

  it('drops unsafe material image URLs without discarding verified metadata', async () => {
    const product = {
      name: 'Intense Perle', brand: 'Lea Ceramiche', collection: 'Intense', category: 'Pavimenti' as const,
      color: 'Perle', effect: 'Pietra', format: '', finish: '', description: 'Gres porcellanato',
      sourceUrl: 'https://www.leaceramiche.com/products/collection/intense',
      productImageUrl: 'http://127.0.0.1/private.jpg', textureImageUrl: 'not-a-url',
      roomImageUrls: ['https://www.leaceramiche.com/images/perle-room.jpg', 'http://localhost/private.jpg'],
      confidence: .8, official: true, correction: '',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ products: [product] }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(searchMaterials({ id: 'grok', label: 'Grok', apiKey: 'xai-test' }, 'Intense Perle')).resolves.toEqual([{
      ...product,
      productImageUrl: '',
      textureImageUrl: '',
      roomImageUrls: ['https://www.leaceramiche.com/images/perle-room.jpg'],
    }]);
  });

  it('allows generic furniture styles and gives Grok more search calls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ products: [] }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await searchMaterials(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      'Modello o collezione: Chesterfield\nTipo prodotto: Arredi\nAltri dettagli: divano',
    );

    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.max_tool_calls).toBe(4);
    expect(payload.input).toContain('can be a style rather than a brand or model');
    expect(payload.input).toContain('established furniture retailers');
  });

  it('opens an exact product link with one Grok tool call', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ products: [] }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await searchMaterials(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      'Tipo prodotto: Arredi\nPagina prodotto esatta: https://www.sklum.com/it/prodotto-miller',
    );

    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.max_tool_calls).toBe(1);
    expect(payload.input).toContain('Open that URL directly, do not perform a general search');
  });

  it('reads schema.org Product data directly from an exact page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`<!doctype html><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product', name: 'Mobile TV Miller', brand: { '@type': 'Brand', name: 'SKLUM' },
      image: 'https://cdn.sklum.com/miller.jpg', description: 'Mobile TV in legno di mango.',
      additionalProperty: [
        { '@type': 'PropertyValue', name: 'Collection', value: 'Miller' },
        { '@type': 'PropertyValue', name: 'Finitura', value: 'Lacca acrilica' },
        { '@type': 'QuantitativeValue', name: 'Larghezza', value: 215, unitCode: 'cm' },
      ],
    })}</script>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));

    await expect(readProductPage('https://www.sklum.com/prodotto-miller', 'Arredi')).resolves.toEqual([
      expect.objectContaining({ name: 'Mobile TV Miller', brand: 'SKLUM', collection: 'Miller', format: 'L 215 cm', productImageUrl: 'https://cdn.sklum.com/miller.jpg', confidence: .98 }),
    ]);
  });

  it('follows a public product redirect and falls back to the official Open Graph image', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: '/art-mobile-per-il-bagno-in-legno-di-mango-164-cm-6539.htm' },
      }))
      .mockResolvedValueOnce(new Response(`<!doctype html>
        <meta property="og:image" content="https://media.tikamoon.com/images/mobile-bagno-milo.jpg?width=1200&amp;quality=90">
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org', '@type': 'Product', name: 'Milo - Mobile per il bagno in legno di mango 164 cm',
          brand: { '@type': 'Brand', name: 'Tikamoon' }, description: 'Mobile bagno in mango con quattro ante.',
          additionalProperty: [
            { '@type': 'PropertyValue', name: 'Larghezza', value: 164, unitCode: 'cm' },
            { '@type': 'PropertyValue', name: 'Profondità', value: 48, unitCode: 'cm' },
            { '@type': 'PropertyValue', name: 'Altezza', value: 78.5, unitCode: 'cm' },
          ],
        })}</script>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));

    await expect(readProductPage('https://www.tikamoon.it/prodotto-milo?utm_source=test', 'Arredi')).resolves.toEqual([
      expect.objectContaining({
        name: 'Milo - Mobile per il bagno in legno di mango 164 cm',
        brand: 'Tikamoon',
        format: 'L 164 cm · P 48 cm · H 78.5 cm',
        sourceUrl: 'https://www.tikamoon.it/art-mobile-per-il-bagno-in-legno-di-mango-164-cm-6539.htm',
        productImageUrl: 'https://media.tikamoon.com/images/mobile-bagno-milo.jpg?width=1200&quality=90',
      }),
    ]);
  });

  it('enriches furniture returned by Grok when the verified page contains the missing product image', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`<!doctype html><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product', name: 'Dorian', brand: { '@type': 'Brand', name: 'divani.store' },
      image: 'https://divani.store/cdn/shop/files/dorian.jpg', description: 'Divano beige.',
    })}</script>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    const product = {
      name: 'Dorian', brand: 'divani.store', collection: '', category: 'Arredi' as const, color: 'Beige', effect: '', format: '', finish: '',
      description: 'Divano beige', sourceUrl: 'https://divani.store/products/dorian', productImageUrl: '', textureImageUrl: '', roomImageUrls: [],
      confidence: .7, official: false, correction: '',
    };

    await expect(enrichFurnitureProductImages([product])).resolves.toEqual([
      { ...product, productImageUrl: 'https://divani.store/cdn/shop/files/dorian.jpg' },
    ]);
  });

  it('enriches furniture from schema.org microdata when Grok omits the image', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`<!doctype html>
      <div itemscope itemtype="http://schema.org/Product">
        <div itemprop="name">Divano moderno Modena</div>
        <div itemprop="image" src="/modules/catalogue/images/53_0.jpg?divano_moderno_modena_viola_1.jpg">
          Divano moderno Modena
        </div>
      </div>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    const product = {
      name: 'Divano moderno Modena', brand: 'Santambrogio', collection: '', category: 'Arredi' as const, color: '', effect: '', format: '', finish: '',
      description: 'Divano moderno', sourceUrl: 'https://www.divanisantambrogio.it/divani_moderni/divano_moderno_modena-60.html', productImageUrl: '', textureImageUrl: '', roomImageUrls: [],
      confidence: .75, official: true, correction: '',
    };

    await expect(enrichFurnitureProductImages([product])).resolves.toEqual([{
      ...product,
      productImageUrl: 'https://www.divanisantambrogio.it/modules/catalogue/images/53_0.jpg?divano_moderno_modena_viola_1.jpg',
    }]);
  });

  it('does not fetch or alter furniture that already has a verified image', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const product = {
      name: 'Dorian', brand: 'divani.store', collection: '', category: 'Arredi' as const, color: 'Beige', effect: '', format: '', finish: '',
      description: 'Divano beige', sourceUrl: 'https://divani.store/products/dorian', productImageUrl: 'https://divani.store/dorian.jpg', textureImageUrl: '', roomImageUrls: [],
      confidence: .7, official: false, correction: '',
    };

    await expect(enrichFurnitureProductImages([product])).resolves.toEqual([product]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks Grok vision for normalized architectural polygons', async () => {
    const geometry = {
      surfaces: [
        { name: 'back', kind: 'wall', confidence: .94, points: [{ x: .24, y: .18 }, { x: .76, y: .18 }, { x: .76, y: .62 }, { x: .24, y: .62 }] },
        { name: 'left', kind: 'wall', confidence: .89, points: [{ x: 0, y: 0 }, { x: .24, y: .18 }, { x: .24, y: .62 }, { x: 0, y: 1 }] },
        { name: 'floor', kind: 'floor', confidence: .97, points: [{ x: .24, y: .62 }, { x: .76, y: .62 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
        { name: 'bright opening', kind: 'window', confidence: .35, points: [{ x: .43, y: .25 }, { x: .57, y: .25 }, { x: .57, y: .52 }, { x: .43, y: .52 }] },
      ],
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(geometry) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await detectRoomSurfaces(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      new File(['room'], 'room.jpg', { type: 'image/jpeg' }),
    );

    expect(result.map((surface) => surface.name)).toEqual(['Muro 1', 'Muro 2', 'Pavimento', 'Finestra']);
    expect(result.find((surface) => surface.kind === 'floor')?.points).toEqual(expect.arrayContaining([{ x: 1, y: 1 }, { x: 0, y: 1 }]));
    expect(result.find((surface) => surface.kind === 'window')?.confidence).toBe(.35);
    const request = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body));
    expect(payload).toMatchObject({
      model: 'grok-4.6',
      max_output_tokens: 3000,
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'room_surface_geometry', strict: true } },
    });
    expect(payload.input[0].content[0]).toMatchObject({ type: 'input_image', detail: 'high' });
    expect(payload.text.format.schema.properties.surfaces.items.properties.points.maxItems).toBe(24);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const auditPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(auditPayload).toMatchObject({ max_output_tokens: 3000, reasoning: { effort: 'low' } });
    expect(auditPayload.input[0].content[1].text).toContain('independent second architectural segmentation');
  });

  it('merges false wall strips and drops a ceiling sliver from a furnished frontal room', () => {
    const result = normalizeRoomSurfaces([
      { name: 'strip 1', kind: 'wall', confidence: .9, points: [{ x: 0, y: 0 }, { x: 0, y: .59 }, { x: .3, y: .55 }, { x: .3, y: 0 }] },
      { name: 'strip 2', kind: 'wall', confidence: .9, points: [{ x: .3, y: 0 }, { x: .3, y: .55 }, { x: .54, y: .53 }, { x: .54, y: 0 }] },
      { name: 'strip 3', kind: 'wall', confidence: .88, points: [{ x: .54, y: 0 }, { x: .54, y: .53 }, { x: 1, y: .52 }, { x: 1, y: 0 }] },
      { name: 'floor', kind: 'floor', confidence: .92, points: [{ x: 0, y: 1 }, { x: 0, y: .59 }, { x: .3, y: .55 }, { x: .54, y: .53 }, { x: 1, y: .52 }, { x: 1, y: 1 }] },
      { name: 'false ceiling', kind: 'ceiling', confidence: .85, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .055 }, { x: 0, y: .055 }] },
      { name: 'door', kind: 'door', confidence: .91, points: [{ x: .7, y: .07 }, { x: .7, y: .52 }, { x: .88, y: .52 }, { x: .88, y: .07 }] },
    ]);

    expect(result.filter((surface) => surface.kind === 'wall')).toHaveLength(1);
    expect(result.some((surface) => surface.kind === 'ceiling')).toBe(false);
    expect(result.find((surface) => surface.kind === 'wall')?.points).toEqual(expect.arrayContaining([
      { x: 0, y: .59 },
      { x: 1, y: .52 },
    ]));
    expect(result.find((surface) => surface.kind === 'door')).toBeTruthy();
  });

  it('rejects self-intersecting and microscopic detected polygons', () => {
    const result = normalizeRoomSurfaces([
      { name: 'bow tie', kind: 'wall', confidence: .99, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      { name: 'tiny edge', kind: 'wall', confidence: .99, points: [{ x: 0, y: 0 }, { x: .001, y: 0 }, { x: 1, y: .7 }, { x: 0, y: .7 }] },
      { name: 'floor', kind: 'floor', confidence: .95, points: [{ x: 0, y: .7 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ]);
    expect(result.map((surface) => surface.kind)).toEqual(['floor']);
  });

  it('does not prefer fragmented wall candidates merely because they contain more walls', () => {
    const floor = { name: 'floor', kind: 'floor' as const, confidence: .95, points: [{ x: 0, y: .7 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
    const accurate = { name: 'wall', kind: 'wall' as const, confidence: .94, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .7 }, { x: 0, y: .7 }] };
    const fragments = Array.from({ length: 4 }, (_, index) => ({
      name: `strip ${index}`, kind: 'wall' as const, confidence: .9,
      points: [{ x: index / 4, y: 0 }, { x: (index + 1) / 4, y: 0 }, { x: (index + 1) / 4, y: .7 }, { x: index / 4, y: .7 }],
    }));
    const result = reconcileRoomSurfaceCandidates([[accurate, floor], [...fragments, floor]]);
    expect(result.filter((surface) => surface.kind === 'wall')).toHaveLength(1);
    expect(result.find((surface) => surface.kind === 'wall')?.points).toEqual(accurate.points);
  });

  it('extends a single full-width frontal wall to the top when no ceiling is visible', () => {
    const result = normalizeRoomSurfaces([
      { name: 'back wall', kind: 'wall', confidence: .92, points: [{ x: 0, y: .08 }, { x: 1, y: .08 }, { x: 1, y: .53 }, { x: 0, y: .56 }] },
      { name: 'floor', kind: 'floor', confidence: .95, points: [{ x: 0, y: .56 }, { x: 1, y: .53 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ]);

    expect(result.find((surface) => surface.kind === 'wall')?.points.slice(0, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it('keeps a window found by either analysis and stops it at the sill', () => {
    const wallAndFloor = [
      { name: 'wall', kind: 'wall' as const, confidence: .96, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
      { name: 'floor', kind: 'floor' as const, confidence: .97, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    const independentOpening = [
      ...wallAndFloor,
      { name: 'black frame', kind: 'window' as const, confidence: .94, points: [{ x: .32, y: .2 }, { x: .68, y: .2 }, { x: .68, y: .6 }, { x: .32, y: .6 }] },
    ];

    const result = reconcileRoomSurfaceCandidates([wallAndFloor, independentOpening]);

    expect(result.find((surface) => surface.kind === 'window')?.points).toEqual([
      { x: .32, y: .2 }, { x: .68, y: .2 }, { x: .68, y: .6 }, { x: .32, y: .6 },
    ]);
  });

  it('detects a removable object around the user-selected point', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [{
      type: 'output_text', text: JSON.stringify({ found: true, label: 'Sedia', confidence: .91, points: [
        { x: .3, y: .4 }, { x: .5, y: .4 }, { x: .5, y: .8 }, { x: .3, y: .8 },
      ] }),
    }] }] }), { status: 200 }));
    const result = await detectObjectRegion(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      new File(['room'], 'room.jpg', { type: 'image/jpeg' }),
      { x: .4, y: .6 },
    );
    expect(result).toMatchObject({ label: 'Sedia', confidence: .91 });
    expect(result?.points).toHaveLength(4);
  });

  it('merges two partially overlapping traces of the same window', () => {
    const room = [
      { name: 'wall', kind: 'wall' as const, confidence: .96, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .56 }, { x: 0, y: .56 }] },
      { name: 'floor', kind: 'floor' as const, confidence: .97, points: [{ x: 0, y: .56 }, { x: 1, y: .56 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    const result = reconcileRoomSurfaceCandidates([
      [...room, { name: 'outer frame', kind: 'window', confidence: .92, points: [{ x: .6, y: .07 }, { x: .885, y: .08 }, { x: .885, y: .4 }, { x: .6, y: .41 }] }],
      [...room, { name: 'glass and frame', kind: 'window', confidence: .9, points: [{ x: .695, y: .015 }, { x: .855, y: .01 }, { x: .855, y: .265 }, { x: .695, y: .268 }] }],
    ]);

    const windows = result.filter((surface) => surface.kind === 'window');
    expect(windows).toHaveLength(1);
    expect(windows[0].points[0].x).toBeCloseTo(.647, 2);
    expect(windows[0].points[1].x).toBeCloseTo(.87, 2);
  });

  it('aligns window vertices before averaging even when the traces start at different corners', () => {
    const room = [
      { name: 'wall', kind: 'wall' as const, confidence: .96, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
      { name: 'floor', kind: 'floor' as const, confidence: .97, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    const clockwise = [{ x: .32, y: .2 }, { x: .68, y: .2 }, { x: .68, y: .58 }, { x: .32, y: .58 }];
    const reversed = [...clockwise].reverse();
    const rotated = [clockwise[2], clockwise[3], clockwise[0], clockwise[1]];

    expect(orderQuadClockwise(reversed)).toEqual(clockwise);
    expect(orderQuadClockwise(rotated)).toEqual(clockwise);

    const result = reconcileRoomSurfaceCandidates([
      [...room, { name: 'window a', kind: 'window', confidence: .9, points: reversed }],
      [...room, { name: 'window b', kind: 'window', confidence: .9, points: rotated }],
    ]);
    const window = result.find((surface) => surface.kind === 'window');
    expect(window?.points).toHaveLength(4);
    expect(window?.points[0].x).toBeCloseTo(.32, 2);
    expect(window?.points[0].y).toBeCloseTo(.2, 2);
    expect(window?.points[2].x).toBeCloseTo(.68, 2);
    expect(window?.points[2].y).toBeCloseTo(.58, 2);
    expect(result.filter((surface) => surface.kind === 'window')).toHaveLength(1);
  });

  it('corrects an opening type using the floor boundary', () => {
    const result = reconcileRoomSurfaceCandidates([[
      { name: 'wall', kind: 'wall', confidence: .95, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
      { name: 'floor', kind: 'floor', confidence: .96, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      { name: 'opening', kind: 'door', confidence: .91, points: [{ x: .35, y: .2 }, { x: .65, y: .2 }, { x: .65, y: .58 }, { x: .35, y: .58 }] },
    ]]);

    expect(result.find((surface) => surface.kind === 'window')).toBeTruthy();
    expect(result.some((surface) => surface.kind === 'door')).toBe(false);
  });

  it('retries once when both parallel geometry analyses fail', async () => {
    const geometry = { surfaces: [
      { name: 'wall', kind: 'wall', confidence: .95, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .7 }, { x: 0, y: .7 }] },
      { name: 'floor', kind: 'floor', confidence: .95, points: [{ x: 0, y: .7 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ] };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'temporary' } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'temporary' } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(geometry) }] }] }), { status: 200 }));

    await expect(detectRoomSurfaces(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      new File(['room'], 'room.jpg', { type: 'image/jpeg' }),
    )).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'floor' })]));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('preserves the source aspect ratio for every Grok image edit', async () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    new DataView(png.buffer).setUint32(16, 600);
    new DataView(png.buffer).setUint32(20, 400);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'dGVzdA==', mime_type: 'image/jpeg' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await editImage(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      { source: new File([png], 'room.png', { type: 'image/png' }), prompt: 'Empty the room' },
    );

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({ model: 'grok-imagine-image-2.0', aspect_ratio: '3:2' });
    expect(chooseSupportedImageAspectRatio(1080, 1920)).toBe('9:16');
  });
});

describe('acceptsFurnitureRender', () => {
  const good = {
    visible: true, atRequestedAnchor: true, atRequestedOrientation: true, resemblesReference: true,
    physicallyGrounded: true, contactShadow: true, structurallyComplete: true, realisticLighting: true,
    confidence: .9, reason: 'ok', referenceLeft: 0, referenceTop: 0, referenceRight: 1, referenceBottom: 1,
  };

  it('accepts only a complete, grounded and realistically integrated product', () => {
    expect(acceptsFurnitureRender(good, true)).toBe(true);
    expect(acceptsFurnitureRender({ ...good, physicallyGrounded: false }, true)).toBe(false);
    expect(acceptsFurnitureRender({ ...good, contactShadow: false }, true)).toBe(false);
    expect(acceptsFurnitureRender({ ...good, structurallyComplete: false }, true)).toBe(false);
    expect(acceptsFurnitureRender({ ...good, realisticLighting: false }, true)).toBe(false);
    expect(acceptsFurnitureRender({ ...good, atRequestedOrientation: false }, true)).toBe(false);
    expect(acceptsFurnitureRender({ ...good, confidence: .79 }, true)).toBe(false);
  });
});
