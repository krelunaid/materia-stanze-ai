import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseSupportedImageAspectRatio, detectRoomSurfaces, editImage, getAiProvider, normalizeRoomSurfaces, reconcileRoomSurfaceCandidates, searchMaterials } from './ai-provider';

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

  it('merges two partially overlapping traces of the same window', () => {
    const room = [
      { name: 'wall', kind: 'wall' as const, confidence: .96, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .56 }, { x: 0, y: .56 }] },
      { name: 'floor', kind: 'floor' as const, confidence: .97, points: [{ x: 0, y: .56 }, { x: 1, y: .56 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    const result = reconcileRoomSurfaceCandidates([
      [...room, { name: 'outer frame', kind: 'window', confidence: .92, points: [{ x: .6, y: .07 }, { x: .885, y: .08 }, { x: .885, y: .4 }, { x: .6, y: .41 }] }],
      [...room, { name: 'glass and frame', kind: 'window', confidence: .9, points: [{ x: .695, y: .015 }, { x: .855, y: .01 }, { x: .855, y: .265 }, { x: .695, y: .268 }] }],
    ]);

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
