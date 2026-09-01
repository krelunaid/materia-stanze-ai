import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchMaterials: vi.fn(),
}));

vi.mock('../../server/ai-api-guard.ts', () => ({
  guardAiRequest: vi.fn(async () => ({ ok: true, headers: new Headers() })),
  handleAiOptions: vi.fn(() => new Response(null, { status: 204 })),
}));

vi.mock('../../server/ai-provider.ts', () => ({
  enrichFurnitureProductImages: vi.fn(async (products) => products),
  getAiProvider: vi.fn(() => ({ id: 'grok', label: 'Grok', apiKey: 'grok-test' })),
  getVisionAuditor: vi.fn(() => ({ id: 'openai', label: 'OpenAI', apiKey: 'openai-test', model: 'gpt-5.6-terra' })),
  knownRetailerProductImage: vi.fn(() => ''),
  readProductPage: vi.fn(async () => []),
  searchMaterials: mocks.searchMaterials,
}));

import { POST } from './route';

function searchRequest() {
  return {
    json: async () => ({
      query: 'carta da parati vintage rose',
      criteria: { brand: 'Dekornik', model: 'Vintage Rose', category: 'Rivestimenti' },
    }),
  } as unknown as Request;
}

beforeEach(() => {
  mocks.searchMaterials.mockReset().mockImplementation(async (provider: { id: string }) => {
    if (provider.id === 'grok') throw new DOMException('The operation was aborted', 'AbortError');
    return [{
      name: 'Vintage Rose', brand: 'Dekornik', collection: 'Vintage', category: 'Rivestimenti',
      color: 'rosa', effect: 'carta da parati', format: '', finish: 'opaca',
      description: 'Carta da parati floreale', sourceUrl: 'https://example.com/vintage-rose',
      productImageUrl: '', textureImageUrl: '', roomImageUrls: [], confidence: .91,
      official: true, correction: '',
    }];
  });
});

describe('product search provider resilience', () => {
  it('uses the independent OpenAI result when Grok times out', async () => {
    const response = await POST(searchRequest());
    const result = await response.json() as { provider?: string; products?: Array<{ category?: string }> };

    expect(response.ok).toBe(true);
    expect(result.provider).toBe('openai');
    expect(result.products).toMatchObject([{ category: 'Rivestimenti' }]);
    expect(mocks.searchMaterials).toHaveBeenCalledTimes(2);
  });
});
