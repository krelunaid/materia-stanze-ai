import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectArchitecturalOpenings: vi.fn(),
  detectRoomSurfaces: vi.fn(),
  mergeArchitecturalOpeningAudit: vi.fn(),
}));

vi.mock('../../server/ai-api-guard.ts', () => ({
  guardAiRequest: vi.fn(async () => ({ ok: true, headers: new Headers() })),
  handleAiOptions: vi.fn(() => new Response(null, { status: 204 })),
}));

vi.mock('../../server/ai-provider.ts', () => ({
  detectArchitecturalOpenings: mocks.detectArchitecturalOpenings,
  detectRoomSurfaces: mocks.detectRoomSurfaces,
  getAiProvider: vi.fn(() => ({ id: 'grok', label: 'Grok', apiKey: 'grok-test' })),
  getVisionAuditor: vi.fn(() => ({ id: 'openai', label: 'OpenAI', apiKey: 'openai-test', model: 'gpt-5.6-terra' })),
  mergeArchitecturalOpeningAudit: mocks.mergeArchitecturalOpeningAudit,
}));

import { POST } from './route';

const primarySurfaces = [{
  name: 'Pavimento', kind: 'floor', confidence: .93,
  points: [{ x: 0, y: .7 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
}];
const auditedOpenings = [{
  name: 'Finestra verificata 1', kind: 'window', confidence: .96,
  points: [{ x: .2, y: .2 }, { x: .4, y: .2 }, { x: .4, y: .6 }, { x: .2, y: .6 }],
}];

function photoRequest() {
  const form = new FormData();
  form.append('image', new File(['room'], 'room.jpg', { type: 'image/jpeg' }));
  return { formData: async () => form } as unknown as Request;
}

beforeEach(() => {
  mocks.detectRoomSurfaces.mockReset().mockResolvedValue(primarySurfaces);
  mocks.detectArchitecturalOpenings.mockReset().mockResolvedValue(auditedOpenings);
  mocks.mergeArchitecturalOpeningAudit.mockReset().mockReturnValue([...primarySurfaces, ...auditedOpenings]);
});

describe('room geometry with an independent opening audit', () => {
  it('merges Terra openings into the Grok room geometry', async () => {
    const response = await POST(photoRequest());
    const result = await response.json() as { surfaces?: unknown[]; auditedOpenings?: number; auditorModel?: string };

    expect(response.ok).toBe(true);
    expect(result.surfaces).toHaveLength(2);
    expect(result.auditedOpenings).toBe(1);
    expect(result.auditorModel).toBe('gpt-5.6-terra');
    expect(mocks.mergeArchitecturalOpeningAudit).toHaveBeenCalledWith(primarySurfaces, auditedOpenings);
  });

  it('keeps the primary geometry when the independent audit times out', async () => {
    mocks.detectArchitecturalOpenings.mockRejectedValueOnce(new Error('timeout'));

    const response = await POST(photoRequest());
    const result = await response.json() as { surfaces?: unknown[]; auditedOpenings?: number };

    expect(response.ok).toBe(true);
    expect(result.surfaces).toEqual(primarySurfaces);
    expect(result.auditedOpenings).toBe(0);
  });

  it('retries the primary geometry once after a transient abort', async () => {
    mocks.detectRoomSurfaces
      .mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))
      .mockResolvedValueOnce(primarySurfaces);

    const response = await POST(photoRequest());
    const result = await response.json() as { surfaces?: unknown[] };

    expect(response.ok).toBe(true);
    expect(result.surfaces).toHaveLength(2);
    expect(mocks.detectRoomSurfaces).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient geometry failure', async () => {
    mocks.detectRoomSurfaces.mockRejectedValueOnce(new Error('invalid geometry'));

    const response = await POST(photoRequest());

    expect(response.status).toBe(500);
    expect(mocks.detectRoomSurfaces).toHaveBeenCalledTimes(1);
  });
});
