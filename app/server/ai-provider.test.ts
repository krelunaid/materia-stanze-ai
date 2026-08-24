import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectRoomSurfaces, getAiProvider, searchMaterials } from './ai-provider';

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
      imageUrl: '',
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
    });
  });

  it('asks Grok vision for normalized architectural polygons', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        surfaces: [
          { name: 'back', kind: 'wall', confidence: .94, points: [{ x: .24, y: .18 }, { x: .76, y: .18 }, { x: .76, y: .62 }, { x: .24, y: .62 }] },
          { name: 'left', kind: 'wall', confidence: .89, points: [{ x: 0, y: 0 }, { x: .24, y: .18 }, { x: .24, y: .62 }, { x: 0, y: 1 }] },
          { name: 'floor', kind: 'floor', confidence: .97, points: [{ x: .24, y: .62 }, { x: .76, y: .62 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
        ],
      }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await detectRoomSurfaces(
      { id: 'grok', label: 'Grok', apiKey: 'xai-test' },
      new File(['room'], 'room.jpg', { type: 'image/jpeg' }),
    );

    expect(result.map((surface) => surface.name)).toEqual(['Muro 1', 'Muro 2', 'Pavimento']);
    expect(result.at(-1)?.points).toEqual(expect.arrayContaining([{ x: 1, y: 1 }, { x: 0, y: 1 }]));
    const request = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body));
    expect(payload).toMatchObject({
      model: 'grok-4.6',
      reasoning: { effort: 'medium' },
      text: { format: { type: 'json_schema', name: 'room_surface_geometry', strict: true } },
    });
    expect(payload.input[0].content[0]).toMatchObject({ type: 'input_image', detail: 'high' });
  });
});
