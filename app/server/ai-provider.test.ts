import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptsFurnitureRender, acceptsRoomCleanup, auditRoomEmptyingNeed, chooseSupportedImageAspectRatio, classifyProductPhoto, detectArchitecturalOpenings, detectMovableObjectRegions, detectObjectRegion, detectRoomSurfaces, editImage, enrichFurnitureProductImages, getAiProvider, getProductCleaner, getRenderProvider, getVisionAuditor, knownRetailerProductImage, mergeArchitecturalOpeningAudit, normalizeCleanupRegions, normalizeMaterialProductCategory, normalizeProductPhotoClassification, normalizeRoomSurfaces, orderQuadClockwise, readProductPage, reconcileRoomSurfaceCandidates, removeFurnitureBackgroundWithBria, searchMaterials } from './ai-provider';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('catalog category safeguards', () => {
  it('always routes wallpaper to a wall surface, never to furniture placement', () => {
    expect(normalizeMaterialProductCategory({
      name: 'Carta da Parati Vintage Rose',
      collection: 'Dekornik',
      category: 'Arredi',
      effect: 'wallpaper floreale',
      description: 'Rivestimento murale decorativo',
    })).toBe('Rivestimenti');
  });
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

  it('configures Terra as an independent opening auditor only beside Grok', () => {
    const environment = { XAI_API_KEY: 'xai-test', OPENAI_API_KEY: 'openai-test' };
    expect(getVisionAuditor(environment, getAiProvider(environment))).toEqual({
      id: 'openai', label: 'OpenAI', apiKey: 'openai-test', model: 'gpt-5.6-terra',
    });
    expect(getVisionAuditor({ ...environment, OPENAI_VISION_MODEL: 'gpt-5.6-sol' }, getAiProvider(environment))?.model)
      .toBe('gpt-5.6-sol');
    expect(getVisionAuditor({ ...environment, VISION_AUDITOR_PROVIDER: 'off' }, getAiProvider(environment))).toBeNull();
    expect(getVisionAuditor(environment, { id: 'openai', label: 'OpenAI', apiKey: 'openai-test' })).toBeNull();
  });

  it('asks the independent auditor for original-detail outer opening contours', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        openings: [{
          type: 'window', confidence: .93, evidence: 'Telaio e davanzale visibili',
          architecturalFrame: true,
          wallRevealSillOrThreshold: true,
          showsOpeningInteriorOrGlazing: true,
          furniturePanelMirrorOrAppliance: false,
          points: [{ x: .2, y: .2 }, { x: .4, y: .2 }, { x: .4, y: .55 }, { x: .2, y: .55 }],
        }],
      }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(detectArchitecturalOpenings(
      { id: 'openai', label: 'OpenAI', apiKey: 'openai-test', model: 'gpt-5.6-terra' },
      new File([new Uint8Array([1, 2, 3])], 'room.jpg', { type: 'image/jpeg' }),
    )).resolves.toEqual([expect.objectContaining({ kind: 'window', confidence: .93 })]);

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/responses');
    expect(payload.model).toBe('gpt-5.6-terra');
    expect(payload.input[0].content[0]).toMatchObject({ type: 'input_image', detail: 'original' });
    expect(payload.text.format.schema.properties.openings.items.properties.points).toMatchObject({ minItems: 4, maxItems: 16 });
    expect(payload.input[0].content[1].text).toContain('full brick or stone arch');
    expect(payload.input[0].content[1].text).toContain('Never trace only the inner door leaf');
    expect(payload.store).toBe(false);
  });

  it('keeps the full audited masonry arch instead of the inner rectangular door leaf', async () => {
    const arch = [
      { x: .82, y: .09 }, { x: .9, y: .12 }, { x: .96, y: .2 },
      { x: .96, y: .72 }, { x: .7, y: .72 }, { x: .7, y: .2 }, { x: .74, y: .13 },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        openings: [{
          type: 'door', confidence: .95, evidence: 'Arco in mattoni con stipiti e soglia',
          architecturalFrame: true,
          wallRevealSillOrThreshold: true,
          showsOpeningInteriorOrGlazing: true,
          furniturePanelMirrorOrAppliance: false,
          points: arch,
        }],
      }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await detectArchitecturalOpenings(
      { id: 'openai', label: 'OpenAI', apiKey: 'openai-test', model: 'gpt-5.6-terra' },
      new File([new Uint8Array([1, 2, 3])], 'arched-kitchen.jpg', { type: 'image/jpeg' }),
    );

    expect(result).toEqual([expect.objectContaining({ kind: 'door', points: arch })]);
  });

  it('uses tentative inner rectangles only as seeds for targeted outer-opening recovery', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ openings: [] }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const seed = {
      name: 'Anta interna', kind: 'door' as const, confidence: .9,
      points: [{ x: .78, y: .3 }, { x: .88, y: .3 }, { x: .88, y: .7 }, { x: .78, y: .7 }],
    };

    await detectArchitecturalOpenings(
      { id: 'openai', label: 'OpenAI', apiKey: 'openai-test', model: 'gpt-5.6-terra' },
      new File([new Uint8Array([1, 2, 3])], 'seeded-door.jpg', { type: 'image/jpeg' }),
      [seed],
    );

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.reasoning).toEqual({ effort: 'low' });
    expect(payload.max_output_tokens).toBe(1800);
    expect(payload.input[0].content[1].text).toContain('Targeted recovery');
    expect(payload.input[0].content[1].text).toContain('Do not return the seed unchanged');
  });

  it('keeps a closed solid architectural door without requiring visible interior', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        openings: [{
          type: 'door', confidence: .94, evidence: 'Anta con maniglia dentro stipiti e soglia',
          architecturalFrame: true,
          wallRevealSillOrThreshold: true,
          showsOpeningInteriorOrGlazing: false,
          furniturePanelMirrorOrAppliance: false,
          points: [{ x: .7, y: .2 }, { x: .9, y: .2 }, { x: .9, y: .72 }, { x: .7, y: .72 }],
        }],
      }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(detectArchitecturalOpenings(
      { id: 'openai', label: 'OpenAI', apiKey: 'openai-test', model: 'gpt-5.6-terra' },
      new File([new Uint8Array([1, 2, 3])], 'closed-door.jpg', { type: 'image/jpeg' }),
    )).resolves.toEqual([expect.objectContaining({ kind: 'door', confidence: .94 })]);
  });

  it('unions an auditor-only opening with the primary room geometry', () => {
    const merged = mergeArchitecturalOpeningAudit([
      { name: 'Muro', kind: 'wall', confidence: .9, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .7 }, { x: 0, y: .7 }] },
      { name: 'Pavimento', kind: 'floor', confidence: .9, points: [{ x: 0, y: .7 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ], [
      { name: 'Finestra verificata', kind: 'window', confidence: .91, points: [{ x: .2, y: .2 }, { x: .45, y: .2 }, { x: .45, y: .55 }, { x: .2, y: .55 }] },
    ]);
    expect(merged.some((surface) => surface.kind === 'window')).toBe(true);
  });

  it('preserves an audited edge opening when the primary detector missed its wall plane', () => {
    const merged = mergeArchitecturalOpeningAudit([
      { name: 'Muro destro', kind: 'wall', confidence: .9, points: [{ x: .3, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: .3, y: .66 }] },
      { name: 'Pavimento', kind: 'floor', confidence: .9, points: [{ x: 0, y: .76 }, { x: .3, y: .66 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ], [{
      name: 'Vetrata laterale verificata', kind: 'window', confidence: .94, audited: true,
      points: [{ x: .01, y: .08 }, { x: .22, y: .08 }, { x: .22, y: .58 }, { x: .01, y: .58 }],
    }]);
    expect(merged).toContainEqual(expect.objectContaining({ kind: 'window', audited: true }));
  });

  it('drops a primary-only cabinet rectangle when the independent opening audit does not confirm it', () => {
    const merged = mergeArchitecturalOpeningAudit([
      { name: 'Muro', kind: 'wall', confidence: .9, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
      { name: 'Pavimento', kind: 'floor', confidence: .9, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      { name: 'Falsa finestra sul pensile', kind: 'window', confidence: .91, points: [{ x: .02, y: .08 }, { x: .12, y: .08 }, { x: .12, y: .42 }, { x: .02, y: .42 }] },
    ], [{
      name: 'Porta verificata', kind: 'door', confidence: .94,
      points: [{ x: .75, y: .2 }, { x: .94, y: .2 }, { x: .94, y: .72 }, { x: .75, y: .72 }],
    }]);

    expect(merged.some((surface) => surface.name.includes('Falsa finestra'))).toBe(false);
    expect(merged.some((surface) => surface.kind === 'door')).toBe(true);
  });

  it('prefers an audited outer arch over a primary rectangle around its door leaf', () => {
    const outerArch = [
      { x: .82, y: .09 }, { x: .9, y: .12 }, { x: .96, y: .2 },
      { x: .96, y: .72 }, { x: .7, y: .72 }, { x: .7, y: .2 }, { x: .74, y: .13 },
    ];
    const merged = mergeArchitecturalOpeningAudit([
      { name: 'Muro', kind: 'wall', confidence: .9, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
      { name: 'Pavimento', kind: 'floor', confidence: .9, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      { name: 'Anta interna', kind: 'door', confidence: .98, points: [{ x: .77, y: .22 }, { x: .91, y: .22 }, { x: .91, y: .72 }, { x: .77, y: .72 }] },
    ], [{ name: 'Arco esterno verificato', kind: 'door', confidence: .93, points: outerArch }]);

    const door = merged.find((surface) => surface.kind === 'door');
    expect(door?.points).toEqual(outerArch);
    expect(door?.audited).toBe(true);
  });

  it('rejects an audited cabinet panel even when it is a bright four-corner rectangle', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        openings: [{
          type: 'window', confidence: .96, evidence: 'Rettangolo luminoso accanto alla cucina',
          architecturalFrame: false,
          wallRevealSillOrThreshold: false,
          showsOpeningInteriorOrGlazing: false,
          furniturePanelMirrorOrAppliance: true,
          points: [{ x: .01, y: .08 }, { x: .12, y: .08 }, { x: .12, y: .42 }, { x: .01, y: .42 }],
        }],
      }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(detectArchitecturalOpenings(
      { id: 'openai', label: 'OpenAI', apiKey: 'openai-test', model: 'gpt-5.6-terra' },
      new File([new Uint8Array([1, 2, 3])], 'kitchen.jpg', { type: 'image/jpeg' }),
    )).resolves.toEqual([]);
  });

  it('asks Terra whether the complete room really needs emptying', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        needsEmptying: true,
        removableObjectCount: 8,
        majorCategories: ['letto', 'scrivania', 'armadio', 'disordine'],
        confidence: .96,
        reason: 'Sono presenti arredi e oggetti removibili.',
      }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(auditRoomEmptyingNeed(
      { id: 'openai', label: 'OpenAI', apiKey: 'openai-test', model: 'gpt-5.6-terra' },
      new File([new Uint8Array([1, 2, 3])], 'camera.jpg', { type: 'image/jpeg' }),
    )).resolves.toMatchObject({ needsEmptying: true, removableObjectCount: 8, confidence: .96 });

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.model).toBe('gpt-5.6-terra');
    expect(payload.input[0].content[0]).toMatchObject({ type: 'input_image', detail: 'original' });
    expect(payload.text.format).toMatchObject({ type: 'json_schema', name: 'room_emptying_audit', strict: true });
    expect(payload.text.format.schema.required).toEqual(expect.arrayContaining(['needsEmptying', 'majorCategories', 'confidence']));
    expect(payload.store).toBe(false);
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

    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://engine.prod.bria-api.com/v2/image/edit/product/cutout');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: { api_token: 'bria-test', 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      image: expect.stringMatching(/^data:image\/jpeg;base64,/),
      preserve_alpha: true,
      force_background_detection: true,
      output_type: 'png',
      sync: true,
    });
  });

  it('classifies a showroom slab as a usable floor material instead of furniture', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        kind: 'surface-material', category: 'Pavimenti', confidence: .94, usableSample: true,
        sampleBounds: { left: .15, top: .12, right: .58, bottom: .82 },
        label: 'Lastra effetto marmo', reason: 'La lastra è il prodotto e la persona è contesto.',
      }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(classifyProductPhoto(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      new File([new Uint8Array([1, 2, 3])], 'lastra.jpg', { type: 'image/jpeg' }),
      'floor',
    )).resolves.toMatchObject({ kind: 'surface-material', category: 'Pavimenti', usableSample: true });

    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    const prompt = payload.input[0].content[1].text as string;
    expect(prompt).toContain('showroom/display rack');
    expect(prompt).toContain('A standing rectangular slab is not furniture');
    expect(prompt).toContain('People, hands, shoes, racks');
    expect(payload.text.format.schema.properties.kind.enum).toEqual(['furniture', 'surface-material', 'unknown']);
  });

  it('normalizes furniture so it can never be used as a surface sample', () => {
    expect(normalizeProductPhotoClassification({
      kind: 'furniture', category: 'Pavimenti', confidence: .91, usableSample: true,
      sampleBounds: { left: .1, top: .1, right: .9, bottom: .9 }, label: 'Divano', reason: '',
    })).toMatchObject({
      kind: 'furniture', category: 'Arredi', usableSample: false,
      sampleBounds: { left: 0, top: 0, right: 0, bottom: 0 },
    });
  });

  it('rejects an invalid or tiny material crop', () => {
    expect(normalizeProductPhotoClassification({
      kind: 'surface-material', category: 'Pavimenti', confidence: .9, usableSample: true,
      sampleBounds: { left: .6, top: .6, right: .55, bottom: .63 }, label: 'Pietra', reason: '',
    })).toMatchObject({ usableSample: false, sampleBounds: { left: 0, top: 0, right: 0, bottom: 0 } });
  });

  it('downgrades uncertain product photos to unknown', () => {
    expect(normalizeProductPhotoClassification({
      kind: 'surface-material', category: 'Pavimenti', confidence: .61, usableSample: true,
      sampleBounds: { left: .1, top: .1, right: .9, bottom: .9 }, label: 'Forse pietra', reason: '',
    }).kind).toBe('unknown');
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

    expect(result.map((surface) => surface.name)).toEqual(['Muro 1', 'Muro 2', 'Pavimento']);
    expect(result.find((surface) => surface.kind === 'floor')?.points).toEqual(expect.arrayContaining([{ x: 1, y: 1 }, { x: 0, y: 1 }]));
    expect(result.find((surface) => surface.kind === 'window')).toBeUndefined();
    const request = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body));
    expect(payload).toMatchObject({
      model: 'grok-4.6',
      max_output_tokens: 3200,
      reasoning: { effort: 'medium' },
      text: { format: { type: 'json_schema', name: 'room_surface_geometry', strict: true } },
    });
    expect(payload.input[0].content[0]).toMatchObject({ type: 'input_image', detail: 'high' });
    expect(payload.input[0].content[1].text).toContain('structural-only pass');
    expect(payload.text.format.schema.properties.surfaces.items.properties.points.maxItems).toBe(24);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const auditPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(auditPayload).toMatchObject({ max_output_tokens: 3600, reasoning: { effort: 'medium' } });
    expect(auditPayload.input[0].content[1].text).toContain('independent second architectural segmentation');
    expect(auditPayload.input[0].content[1].text).toContain('sunlit patch, reflection, shadow');
    expect(auditPayload.input[0].content[1].text).toContain('shared junction vertices');
    expect(auditPayload.input[0].content[1].text).toContain('full receding plane');
    expect(auditPayload.input[0].content[1].text).toContain('curved or arched opening');
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

  it('preserves a clearly detected far wall when the strongest pass omits it', () => {
    const floor = { name: 'floor', kind: 'floor' as const, confidence: .98, points: [{ x: 0, y: .76 }, { x: .22, y: .64 }, { x: .78, y: .64 }, { x: 1, y: .76 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
    const left = { name: 'left', kind: 'wall' as const, confidence: .97, points: [{ x: 0, y: 0 }, { x: .22, y: .18 }, { x: .22, y: .64 }, { x: 0, y: .76 }] };
    const right = { name: 'right', kind: 'wall' as const, confidence: .97, points: [{ x: .78, y: .18 }, { x: 1, y: 0 }, { x: 1, y: .76 }, { x: .78, y: .64 }] };
    const backA = { name: 'far wall', kind: 'wall' as const, confidence: .9, points: [{ x: .22, y: .18 }, { x: .78, y: .18 }, { x: .78, y: .64 }, { x: .22, y: .64 }] };
    const backB = { ...backA, confidence: .88, points: [{ x: .21, y: .17 }, { x: .79, y: .17 }, { x: .79, y: .65 }, { x: .21, y: .65 }] };
    const ceiling = { name: 'ceiling', kind: 'ceiling' as const, confidence: .99, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .78, y: .18 }, { x: .22, y: .18 }] };

    const result = reconcileRoomSurfaceCandidates([
      [left, right, floor, ceiling],
      [left, right, backA, floor],
      [left, right, backB, floor],
    ]);

    expect(result.filter((surface) => surface.kind === 'wall')).toHaveLength(3);
    expect(result.some((surface) => surface.kind === 'wall'
      && Math.min(...surface.points.map((point) => point.x)) > .15
      && Math.max(...surface.points.map((point) => point.x)) < .85)).toBe(true);
  });

  it('preserves a confident side return from one pass when it shares the physical floor junction', () => {
    const mergedFront = { name: 'front merged with return', kind: 'wall' as const, confidence: .94, points: [{ x: .2, y: .08 }, { x: 1, y: .05 }, { x: 1, y: .55 }, { x: .2, y: .58 }] };
    const left = { name: 'left', kind: 'wall' as const, confidence: .92, points: [{ x: 0, y: 0 }, { x: .2, y: .08 }, { x: .2, y: .58 }, { x: 0, y: .72 }] };
    const floor = { name: 'floor', kind: 'floor' as const, confidence: .94, points: [{ x: 0, y: .72 }, { x: .2, y: .58 }, { x: .93, y: .62 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
    const front = { name: 'front', kind: 'wall' as const, confidence: .88, points: [{ x: .2, y: .08 }, { x: .93, y: .08 }, { x: .93, y: .62 }, { x: .2, y: .58 }] };
    const rightReturn = { name: 'right return', kind: 'wall' as const, confidence: .84, points: [{ x: .93, y: .08 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: .93, y: .62 }] };

    const result = reconcileRoomSurfaceCandidates([
      [left, mergedFront, floor],
      [left, front, rightReturn, floor],
    ]);

    expect(result.some((surface) => surface.kind === 'wall'
      && Math.min(...surface.points.map((point) => point.x)) >= .92
      && Math.max(...surface.points.map((point) => point.x)) === 1)).toBe(true);
  });

  it('prefers the floor that shares the real wall junction over mutually agreeing reflection lines', () => {
    const wall = { name: 'back wall', kind: 'wall' as const, confidence: .94, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .62 }, { x: 0, y: .62 }] };
    const physicalFloor = { name: 'physical floor', kind: 'floor' as const, confidence: .86, points: [{ x: 0, y: .62 }, { x: 1, y: .62 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
    const reflectedFloorA = { name: 'sun patch a', kind: 'floor' as const, confidence: .97, points: [{ x: 0, y: .82 }, { x: 1, y: .82 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
    const reflectedFloorB = { ...reflectedFloorA, name: 'sun patch b', confidence: .96 };

    const result = reconcileRoomSurfaceCandidates([
      [wall, physicalFloor],
      [wall, reflectedFloorA],
      [wall, reflectedFloorB],
    ]);

    expect(result.find((surface) => surface.kind === 'floor')?.points).toEqual(physicalFloor.points);
  });

  it('keeps every floor junction shared and prefers a nearby lower contact edge', () => {
    const left = { name: 'left', kind: 'wall' as const, confidence: .95, points: [{ x: 0, y: 0 }, { x: .25, y: .12 }, { x: .25, y: .62 }, { x: .12, y: .72 }, { x: 0, y: .78 }] };
    const back = { name: 'back', kind: 'wall' as const, confidence: .96, points: [{ x: .25, y: .12 }, { x: .78, y: .13 }, { x: .78, y: .6 }, { x: .25, y: .62 }] };
    const right = { name: 'right', kind: 'wall' as const, confidence: .95, points: [{ x: .78, y: .13 }, { x: 1, y: 0 }, { x: 1, y: .76 }, { x: .78, y: .6 }] };
    const mismatchedFloor = { name: 'floor', kind: 'floor' as const, confidence: .99, points: [{ x: 0, y: .68 }, { x: .25, y: .66 }, { x: .78, y: .65 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };

    const result = reconcileRoomSurfaceCandidates([[left, back, right, mismatchedFloor]]);
    const floor = result.find((surface) => surface.kind === 'floor');

    expect(floor?.points).toEqual(expect.arrayContaining([
      { x: 0, y: .78 }, { x: .12, y: .72 }, { x: .25, y: .66 }, { x: .78, y: .65 }, { x: 1, y: .76 },
    ]));
    const wallPoints = result.filter((surface) => surface.kind === 'wall').flatMap((surface) => surface.points);
    expect(wallPoints).toEqual(expect.arrayContaining([{ x: .25, y: .66 }, { x: .78, y: .65 }]));
  });

  it('does not snap a floor from the lower skirting contact back to the upper trim edge', () => {
    const backWall = { name: 'back wall', kind: 'wall' as const, confidence: .97, points: [{ x: .2, y: .12 }, { x: .8, y: .12 }, { x: .8, y: .695 }, { x: .2, y: .695 }] };
    const floorAtLowerContact = { name: 'floor', kind: 'floor' as const, confidence: .96, points: [{ x: .2, y: .718 }, { x: .8, y: .718 }, { x: 1, y: .89 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: .89 }] };

    const result = reconcileRoomSurfaceCandidates([[backWall, floorAtLowerContact]]);
    const floor = result.find((surface) => surface.kind === 'floor');
    const wall = result.find((surface) => surface.kind === 'wall');

    expect(floor?.points).toEqual(expect.arrayContaining([{ x: .2, y: .718 }, { x: .8, y: .718 }]));
    expect(wall?.points).toEqual(expect.arrayContaining([{ x: .2, y: .718 }, { x: .8, y: .718 }]));
  });

  it('prefers complete side-wall planes over narrow image-edge bands', () => {
    const floor = { name: 'floor', kind: 'floor' as const, confidence: .94, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
    const back = { name: 'back', kind: 'wall' as const, confidence: .9, points: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .72 }, { x: .2, y: .72 }] };
    const fullLeft = { name: 'left', kind: 'wall' as const, confidence: .84, points: [{ x: 0, y: 0 }, { x: .2, y: .2 }, { x: .2, y: .72 }, { x: 0, y: .82 }] };
    const fullRight = { name: 'right', kind: 'wall' as const, confidence: .84, points: [{ x: .8, y: .2 }, { x: 1, y: 0 }, { x: 1, y: .82 }, { x: .8, y: .72 }] };
    const narrowLeft = { name: 'left strip', kind: 'wall' as const, confidence: .98, points: [{ x: 0, y: 0 }, { x: .06, y: .08 }, { x: .06, y: .76 }, { x: 0, y: .82 }] };
    const narrowRight = { name: 'right strip', kind: 'wall' as const, confidence: .98, points: [{ x: .94, y: .08 }, { x: 1, y: 0 }, { x: 1, y: .82 }, { x: .94, y: .76 }] };

    const result = reconcileRoomSurfaceCandidates([
      [back, fullLeft, fullRight, floor],
      [{ ...back, confidence: .98 }, narrowLeft, narrowRight, floor],
    ]);

    expect(result.some((surface) => surface.kind === 'wall'
      && Math.min(...surface.points.map((point) => point.x)) === 0
      && Math.max(...surface.points.map((point) => point.x)) >= .2)).toBe(true);
    expect(result.some((surface) => surface.kind === 'wall'
      && Math.min(...surface.points.map((point) => point.x)) <= .8
      && Math.max(...surface.points.map((point) => point.x)) === 1)).toBe(true);
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

  it('keeps a real centred window when the surrounding layout is not the demo template', () => {
    const wallAndFloor = [
      { name: 'wall', kind: 'wall' as const, confidence: .96, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
      { name: 'floor', kind: 'floor' as const, confidence: .97, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    const independentOpening = [
      ...wallAndFloor,
      { name: 'black frame', kind: 'window' as const, confidence: .94, points: [{ x: .32, y: .2 }, { x: .68, y: .2 }, { x: .68, y: .6 }, { x: .32, y: .6 }] },
    ];

    const result = reconcileRoomSurfaceCandidates([independentOpening, independentOpening]);

    expect(result.find((surface) => surface.kind === 'window')?.points).toEqual([
      { x: .32, y: .2 }, { x: .68, y: .2 }, { x: .68, y: .6 }, { x: .32, y: .6 },
    ]);
  });

  it('detects a removable object around the user-selected point', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [{
      type: 'output_text', text: JSON.stringify({ found: true, label: 'Sedia', confidence: .91, removalKind: 'loose-object', points: [
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
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.input[0].content[1].text).toContain('explicit removal request');
    expect(payload.input[0].content[1].text).toContain('built-in kitchen cabinets');
  });

  it('keeps fitted kitchens and bathroom furnishings while rejecting true architecture', () => {
    const rectangle = (left: number, top: number, right: number, bottom: number) => [
      { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
    ];
    const result = normalizeCleanupRegions([
      { label: 'Cucina incassata', removalKind: 'installed-furnishing', confidence: .96, points: rectangle(.03, .08, .96, .82) },
      { label: 'Forno e cappa', removalKind: 'fixed-appliance', confidence: .91, points: rectangle(.1, .2, .28, .55) },
      { label: 'Mobile lavabo', removalKind: 'bathroom-furnishing', confidence: .88, points: rectangle(.58, .42, .88, .82) },
      { label: 'Parete portante', removalKind: 'architecture', confidence: .99, points: rectangle(0, 0, 1, .7) },
      { label: 'Senza categoria', confidence: .99, points: rectangle(.4, .1, .6, .3) },
    ], .5);

    expect(result.map((region) => region.label)).toEqual(['Cucina incassata', 'Forno e cappa', 'Mobile lavabo']);
    expect(result.every((region) => region.removalKind !== 'architecture')).toBe(true);
  });

  it('detects all movable objects for safe automatic room cleaning', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [{
      type: 'output_text', text: JSON.stringify({ regions: [
        { label: 'Letto', confidence: .94, removalKind: 'loose-object', points: [{ x: .2, y: .45 }, { x: .7, y: .45 }, { x: .75, y: .9 }, { x: .15, y: .9 }] },
        { label: 'Comodino', confidence: .88, removalKind: 'loose-object', points: [{ x: .72, y: .5 }, { x: .86, y: .5 }, { x: .86, y: .72 }, { x: .72, y: .72 }] },
        { label: 'Applique a parete', confidence: .91, removalKind: 'architecture', points: [{ x: .8, y: .2 }, { x: .9, y: .2 }, { x: .9, y: .3 }, { x: .8, y: .3 }] },
      ] }),
    }] }] }), { status: 200 }));

    const result = await detectMovableObjectRegions(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      new File(['room'], 'room.jpg', { type: 'image/jpeg' }),
    );

    expect(result.map((region) => region.label)).toEqual(['Letto', 'Comodino']);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const prompts = vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)).input[0].content[1].text as string);
    expect(prompts.join('\n')).toContain('base cabinets');
    expect(prompts.join('\n')).toContain('wall cabinets');
    expect(prompts.join('\n')).toContain('integrated ovens');
    expect(prompts.join('\n')).toContain('hobs');
    expect(prompts.join('\n')).toContain('extractor hoods');
    expect(prompts.join('\n')).toContain('bathroom vanities');
    expect(prompts.join('\n')).toContain('attachment is not architecture');
    expect(prompts.join('\n')).toContain('fruit bowls');
    expect(prompts.join('\n')).toContain('coffee machines');
    expect(prompts.join('\n')).toContain('must not remain floating');
  });

  it('rechecks the full room when the first furniture pass returns empty', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [{ content: [{
        type: 'output_text', text: JSON.stringify({ regions: [] }),
      }] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [{ content: [{
        type: 'output_text', text: JSON.stringify({ regions: [] }),
      }] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [{ content: [{
        type: 'output_text', text: JSON.stringify({ regions: [
          { label: 'Divano', confidence: .48, removalKind: 'loose-object', points: [{ x: .1, y: .45 }, { x: .82, y: .45 }, { x: .86, y: .9 }, { x: .08, y: .9 }] },
        ] }),
      }] }] }), { status: 200 }));

    const result = await detectMovableObjectRegions(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      new File(['room'], 'room.jpg', { type: 'image/jpeg' }),
    );

    expect(result).toMatchObject([{ label: 'Divano', confidence: .48 }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('performs one focused localization using Terra categories', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [{
      type: 'output_text', text: JSON.stringify({ regions: [{
        label: 'Letto completo', confidence: .96, removalKind: 'loose-object',
        points: [{ x: .15, y: .4 }, { x: .9, y: .4 }, { x: .9, y: .92 }, { x: .15, y: .92 }],
      }] }),
    }] }] }), { status: 200 }));

    const result = await detectMovableObjectRegions(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      new File(['room'], 'room.jpg', { type: 'image/jpeg' }),
      'real-estate-emptying',
      ['letto', 'cassettiera', 'tende'],
    );

    expect(result).toMatchObject([{ label: 'Letto completo' }]);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const prompt = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).input[0].content[1].text as string;
    expect(prompt).toContain('letto, cassettiera, tende');
    expect(prompt).toContain('must never be skipped');
  });

  it('rejects an opening hallucinated by only one geometry pass', () => {
    const room = [
      { name: 'wall', kind: 'wall' as const, confidence: .96, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .7 }, { x: 0, y: .7 }] },
      { name: 'floor', kind: 'floor' as const, confidence: .97, points: [{ x: 0, y: .7 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    const hallucinated = { name: 'reflection', kind: 'window' as const, confidence: .91, points: [{ x: .6, y: .2 }, { x: .85, y: .2 }, { x: .85, y: .55 }, { x: .6, y: .55 }] };
    const result = reconcileRoomSurfaceCandidates([[...room, hallucinated], room, room]);
    expect(result.some((surface) => surface.kind === 'window')).toBe(false);
  });

  it('keeps a repeated perspective row of strong windows found by the opening audit', () => {
    const room = [
      { name: 'back wall', kind: 'wall' as const, confidence: .96, points: [{ x: .15, y: .18 }, { x: .88, y: .18 }, { x: .88, y: .72 }, { x: .15, y: .72 }] },
      { name: 'right wall', kind: 'wall' as const, confidence: .94, points: [{ x: .88, y: .18 }, { x: 1, y: 0 }, { x: 1, y: .82 }, { x: .88, y: .72 }] },
      { name: 'floor', kind: 'floor' as const, confidence: .97, points: [{ x: .15, y: .72 }, { x: .88, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    const repeatedWindows = [
      { name: 'near arch', kind: 'window' as const, confidence: .94, points: [{ x: .89, y: .18 }, { x: .99, y: .18 }, { x: .99, y: .61 }, { x: .89, y: .61 }] },
      { name: 'middle arch', kind: 'window' as const, confidence: .91, points: [{ x: .78, y: .29 }, { x: .84, y: .29 }, { x: .84, y: .58 }, { x: .78, y: .58 }] },
      { name: 'far arch', kind: 'window' as const, confidence: .88, points: [{ x: .70, y: .36 }, { x: .74, y: .36 }, { x: .74, y: .56 }, { x: .70, y: .56 }] },
    ];

    const result = reconcileRoomSurfaceCandidates([room, room, [...room, ...repeatedWindows]]);

    expect(result.filter((surface) => surface.kind === 'window')).toHaveLength(3);
  });

  it('keeps the strongest overlapping window trace without averaging it toward the centre', () => {
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
    expect(windows[0].points[0].x).toBeCloseTo(.6, 2);
    expect(windows[0].points[1].x).toBeCloseTo(.885, 2);
  });

  it('aligns window vertices before averaging even when the traces start at different corners', () => {
    const room = [
      { name: 'wall', kind: 'wall' as const, confidence: .96, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
      { name: 'floor', kind: 'floor' as const, confidence: .97, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    const clockwise = [{ x: .12, y: .18 }, { x: .42, y: .18 }, { x: .42, y: .54 }, { x: .12, y: .54 }];
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
    expect(window?.points[0].x).toBeCloseTo(.12, 2);
    expect(window?.points[0].y).toBeCloseTo(.18, 2);
    expect(window?.points[2].x).toBeCloseTo(.42, 2);
    expect(window?.points[2].y).toBeCloseTo(.54, 2);
    expect(result.filter((surface) => surface.kind === 'window')).toHaveLength(1);
  });

  it('corrects an opening type using the floor boundary', () => {
    const result = reconcileRoomSurfaceCandidates([[
      { name: 'wall', kind: 'wall', confidence: .95, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
      { name: 'floor', kind: 'floor', confidence: .96, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      { name: 'opening', kind: 'door', confidence: .91, points: [{ x: .08, y: .2 }, { x: .3, y: .2 }, { x: .3, y: .58 }, { x: .08, y: .58 }] },
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

  it('runs an opening-first third pass for rooms generated from floorplans', async () => {
    const geometry = { surfaces: [
      { name: 'wall', kind: 'wall', confidence: .96, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .7 }, { x: 0, y: .7 }] },
      { name: 'floor', kind: 'floor', confidence: .96, points: [{ x: 0, y: .7 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      { name: 'window', kind: 'window', confidence: .92, points: [{ x: .12, y: .15 }, { x: .3, y: .15 }, { x: .3, y: .5 }, { x: .12, y: .5 }] },
    ] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(geometry) }] }],
    }), { status: 200 }));

    const result = await detectRoomSurfaces(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      new File(['room'], 'room.jpg', { type: 'image/jpeg' }),
      { openingAudit: true, source: 'floorplan-render' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.some((surface) => surface.kind === 'window')).toBe(true);
    const thirdPayload = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(thirdPayload.reasoning).toEqual({ effort: 'medium' });
    expect(thirdPayload.input[0].content[1].text).toContain('Opening-first verification pass');
  });

  it('sends Grok the supported aspect ratio closest to the exact source ratio', async () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0x49, 0x48, 0x44, 0x52], 12);
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

  it('sends the technical mask as the second Grok input with explicit non-photographic semantics', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'dGVzdA==', mime_type: 'image/jpeg' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await editImage(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      {
        source: new File(['room'], 'room.jpg', { type: 'image/jpeg' }),
        mask: new File(['mask'], 'mask.png', { type: 'image/png' }),
        maskReferenceFile: new File(['magenta-reference'], 'mask-reference.png', { type: 'image/png' }),
        prompt: 'Remove the selected sofa',
        maskExplanation: 'transparent pixels are editable',
      },
    );

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.images).toHaveLength(2);
    expect(payload.images[0].url).toMatch(/^data:image\/jpeg;base64,/);
    expect(payload.images[1].url).toMatch(/^data:image\/png;base64,/);
    expect(payload.prompt).toContain('Input image 2 is a technical edit mask');
    expect(payload.prompt).toContain('MAGENTA pixels are the only editable area');
    expect(payload.prompt).toContain('must never appear in the result');
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

describe('acceptsRoomCleanup', () => {
  const good = {
    sameCameraAndCrop: true,
    sameArchitecture: true,
    openingsPreserved: true,
    removableTargetsRemoved: true,
    noVisiblePatchArtifacts: true,
    noNewObjects: true,
    realisticContinuation: true,
    confidence: .9,
    reason: 'ok',
  };

  it('rejects framing, architecture, residual-object and patch failures', () => {
    expect(acceptsRoomCleanup(good)).toBe(true);
    expect(acceptsRoomCleanup({ ...good, sameCameraAndCrop: false })).toBe(false);
    expect(acceptsRoomCleanup({ ...good, sameArchitecture: false })).toBe(false);
    expect(acceptsRoomCleanup({ ...good, removableTargetsRemoved: false })).toBe(false);
    expect(acceptsRoomCleanup({ ...good, noVisiblePatchArtifacts: false })).toBe(false);
    expect(acceptsRoomCleanup({ ...good, confidence: .81 })).toBe(false);
  });
});
