import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auditRoomEmptyingNeed: vi.fn(),
  detectMovableObjectRegions: vi.fn(),
}));

vi.mock('../../server/ai-api-guard.ts', () => ({
  guardAiRequest: vi.fn(async () => ({ ok: true, headers: new Headers() })),
  handleAiOptions: vi.fn(() => new Response(null, { status: 204 })),
}));

vi.mock('../../server/ai-provider.ts', () => ({
  auditRoomEmptyingNeed: mocks.auditRoomEmptyingNeed,
  detectMovableObjectRegions: mocks.detectMovableObjectRegions,
  detectObjectRegion: vi.fn(),
  getAiProvider: vi.fn(() => ({ id: 'grok', label: 'Grok', apiKey: 'grok-test' })),
  getVisionAuditor: vi.fn(() => ({ id: 'openai', label: 'OpenAI', apiKey: 'openai-test', model: 'gpt-5.6-terra' })),
}));

import { POST } from './route';

function automaticRequest() {
  const form = new FormData();
  form.append('image', new File(['room'], 'room.jpg', { type: 'image/jpeg' }));
  form.append('mode', 'all');
  return { formData: async () => form } as unknown as Request;
}

beforeEach(() => {
  mocks.detectMovableObjectRegions.mockReset().mockResolvedValue([{
    label: 'Divano', confidence: .93,
    points: [{ x: .1, y: .4 }, { x: .8, y: .4 }, { x: .8, y: .8 }, { x: .1, y: .8 }],
  }]);
  mocks.auditRoomEmptyingNeed.mockReset().mockResolvedValue({
    needsEmptying: true,
    removableObjectCount: 1,
    majorCategories: ['divano'],
    confidence: .97,
    reason: 'È presente un divano.',
  });
});

describe('automatic room-emptying detection', () => {
  it('returns Grok polygons together with the independent Terra decision', async () => {
    const response = await POST(automaticRequest());
    const result = await response.json() as Record<string, unknown>;

    expect(response.ok).toBe(true);
    expect(result).toMatchObject({
      provider: 'grok',
      auditor: 'openai',
      auditorModel: 'gpt-5.6-terra',
      roomAudit: { needsEmptying: true, majorCategories: ['divano'], confidence: .97 },
    });
    expect(mocks.detectMovableObjectRegions).toHaveBeenCalledOnce();
    expect(mocks.auditRoomEmptyingNeed).toHaveBeenCalledOnce();
  });

  it('keeps safe Grok detection usable when the Terra audit is temporarily unavailable', async () => {
    mocks.auditRoomEmptyingNeed.mockRejectedValueOnce(new Error('temporary outage'));

    const response = await POST(automaticRequest());
    const result = await response.json() as { regions?: unknown[]; roomAudit?: unknown };

    expect(response.ok).toBe(true);
    expect(result.regions).toHaveLength(1);
    expect(result.roomAudit).toBeNull();
  });
});
