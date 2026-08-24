import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAiProvider, searchMaterials } from './ai-provider';

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
});
