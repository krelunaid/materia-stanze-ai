// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), topology: vi.fn(), detect: vi.fn() }));
vi.mock('../../server/ai-api-guard', () => ({ guardAiRequest: async () => ({ ok: true, headers: new Headers() }), handleAiOptions: vi.fn() }));
vi.mock('../../server/ai-provider', () => ({ getAiProvider: () => ({ id: 'grok' }), getVisionAuditor: () => null, verifyEditedRoomShell: mocks.verify, roomShellTopologyStatus: mocks.topology, detectRoomSurfaces: mocks.detect, detectArchitecturalOpenings: vi.fn(), mergeArchitecturalOpeningAudit: vi.fn() }));
import { POST } from './route';
afterEach(() => vi.resetAllMocks());
const surfaces = [{ kind: 'wall', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .7 }, { x: 0, y: .7 }] }];
function request(value: unknown) {
  const form = new FormData();
  form.append('image', new File(['room'], 'room.jpg', { type: 'image/jpeg' }));
  form.append('verifyOnly', 'true'); form.append('surfaces', JSON.stringify(value));
  return new Request('https://example.test/api/detect-surfaces', { method: 'POST', body: form });
}
it('audits the edited points without running a replacement detection', async () => {
  mocks.topology.mockReturnValue('verified'); mocks.verify.mockResolvedValue({ accepted: true, reason: 'Confini corretti' });
  expect(await (await POST(request(surfaces))).json()).toMatchObject({ accepted: true });
  expect(mocks.verify).toHaveBeenCalledWith(expect.anything(), expect.any(File), surfaces);
  expect(mocks.detect).not.toHaveBeenCalled();
});
it('never clears a shell error when topology still fails', async () => {
  mocks.topology.mockReturnValue('geometry-invalid');
  expect(await (await POST(request(surfaces))).json()).toMatchObject({ accepted: false });
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('rejects invalid coordinates before sending a photo to the model', async () => {
  expect((await POST(request([{ kind: 'wall', points: [{ x: -1, y: 0 }] }]))).status).toBe(400);
  expect(mocks.verify).not.toHaveBeenCalled();
});
