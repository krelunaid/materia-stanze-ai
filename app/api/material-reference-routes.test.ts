import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  editImage: vi.fn(),
  verifyFurniturePlacement: vi.fn(),
  verifyFurnitureView: vi.fn(),
}));

vi.mock('../server/ai-api-guard.ts', () => ({
  guardAiRequest: vi.fn(async () => ({ ok: true, headers: new Headers() })),
  handleAiOptions: vi.fn(() => new Response(null, { status: 204 })),
}));

vi.mock('../server/ai-provider.ts', () => ({
  acceptsFurnitureRender: vi.fn(() => true),
  acceptsFurnitureView: vi.fn((verification) => Object.values(verification).every((value) => value === true || typeof value === 'number' || typeof value === 'string')),
  editImage: mocks.editImage,
  getRenderProvider: vi.fn(() => ({ id: 'grok', label: 'Grok', apiKey: 'test' })),
  verifyFurniturePlacement: mocks.verifyFurniturePlacement,
  verifyFurnitureView: mocks.verifyFurnitureView,
}));

import { POST as applyProduct } from './apply-product/route';
import { POST as prepareFurnitureView } from './prepare-furniture-view/route';
import { POST as renderRoom } from './render-room/route';

function baseForm() {
  const form = new FormData();
  form.append('image', new File(['room'], 'room.jpg', { type: 'image/jpeg' }));
  form.append('mask', new File(['mask'], 'mask.png', { type: 'image/png' }));
  return form;
}

function formRequest(form: FormData) {
  return { formData: async () => form } as unknown as Request;
}

beforeEach(() => {
  mocks.editImage.mockReset().mockResolvedValue('data:image/png;base64,result');
  mocks.verifyFurniturePlacement.mockReset();
  mocks.verifyFurnitureView.mockReset().mockResolvedValue({
    isolated: true,
    correctFacing: true,
    resemblesReference: true,
    structurallyComplete: true,
    completeSilhouette: true,
    uniformWhiteBackground: true,
    confidence: .98,
    reason: 'Vista fedele.',
  });
});

describe('uploaded material references', () => {
  it('forwards the uploaded sample file when applying one product', async () => {
    const form = baseForm();
    const sample = new File(['sample'], 'sample.png', { type: 'image/png' });
    form.append('materialReference', sample);
    form.append('referenceType', 'uploaded-sample');
    form.append('productName', 'Lastra marmo');
    form.append('targetName', 'Pavimento');

    const response = await applyProduct(formRequest(form));

    expect(mocks.editImage).toHaveBeenCalledTimes(1);
    expect(response.ok, await response.clone().text()).toBe(true);
    expect(mocks.editImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grok' }),
      expect.objectContaining({
        referenceImageFile: expect.objectContaining({ name: 'sample.png', type: 'image/png' }),
        referenceImageRole: 'material',
        referenceImageUrl: null,
      }),
    );
  });

  it('forwards the uploaded sample file to the final render', async () => {
    const form = baseForm();
    form.append('materialReference', new File(['sample'], 'sample.png', { type: 'image/png' }));
    form.append('referenceType', 'uploaded-sample');
    form.append('materials', 'Pavimento: Lastra marmo');

    const response = await renderRoom(formRequest(form));

    expect(mocks.editImage).toHaveBeenCalledTimes(1);
    expect(response.ok, await response.clone().text()).toBe(true);
    expect(mocks.editImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grok' }),
      expect.objectContaining({
        referenceImageFile: expect.objectContaining({ name: 'sample.png', type: 'image/png' }),
        referenceImageRole: 'material',
        referenceImageUrl: null,
      }),
    );
  });

  it('uses one combined visual sheet without losing material or furniture references', async () => {
    const form = baseForm();
    form.append('materialReference', new File(['sample'], 'sample.png', { type: 'image/png' }));
    form.append('furnitureReference', new File(['sofa'], 'sofa.png', { type: 'image/png' }));
    form.append('combinedReference', new File(['sheet'], 'material-and-sofa.png', { type: 'image/png' }));
    form.append('referenceType', 'uploaded-sample');
    form.append('materials', 'Pavimento: Lastra marmo');
    form.append('furniture', 'Divano; anchor at x 50%, y 70%');
    form.append('furnitureReferenceName', 'Divano');
    mocks.verifyFurniturePlacement.mockResolvedValue({ visible: true, confidence: 1 });

    const response = await renderRoom(formRequest(form));

    expect(response.ok, await response.clone().text()).toBe(true);
    expect(mocks.editImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grok' }),
      expect.objectContaining({
        referenceImageFile: expect.objectContaining({ name: 'material-and-sofa.png', type: 'image/png' }),
        referenceImageRole: 'combined',
        referenceImageUrl: null,
        prompt: expect.stringContaining('LEFT PANEL = the exact material sample'),
      }),
    );
    expect(mocks.verifyFurniturePlacement).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grok' }),
      expect.objectContaining({
        referenceImageFile: expect.objectContaining({ name: 'sofa.png', type: 'image/png' }),
      }),
    );
  });
});

describe('identity-preserving furniture views', () => {
  function furnitureViewForm(facing = 'front-wall') {
    const form = new FormData();
    form.append('image', new File(['desk'], 'scrivania.jpg', { type: 'image/jpeg' }));
    form.append('facing', facing);
    form.append('productName', 'Scrivania');
    form.append('productDescription', 'Legno chiaro con cassettiera grigia a destra');
    return form;
  }

  it('returns a corrected view only after strict identity and facing verification', async () => {
    const response = await prepareFurnitureView(formRequest(furnitureViewForm('front-wall')));

    expect(response.ok, await response.clone().text()).toBe(true);
    expect(mocks.editImage).toHaveBeenCalledTimes(1);
    expect(mocks.editImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grok' }),
      expect.objectContaining({ prompt: expect.stringContaining('front elevation') }),
    );
    expect(mocks.verifyFurnitureView).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grok' }),
      expect.objectContaining({ facing: 'front-wall', productName: 'Scrivania' }),
    );
  });

  it('retries once and rejects a perspective that changes product identity', async () => {
    const failed = {
      isolated: true,
      correctFacing: true,
      resemblesReference: false,
      structurallyComplete: false,
      completeSilhouette: true,
      uniformWhiteBackground: true,
      confidence: .73,
      reason: 'La cassettiera è stata spostata e manca una maniglia.',
    };
    mocks.verifyFurnitureView.mockResolvedValue(failed);

    const response = await prepareFurnitureView(formRequest(furnitureViewForm('right-wall')));
    const result = await response.json() as { code?: string };

    expect(response.status).toBe(422);
    expect(result.code).toBe('identity_check_failed');
    expect(mocks.editImage).toHaveBeenCalledTimes(2);
    expect(mocks.editImage.mock.calls[1]?.[1]?.prompt).toContain('manca una maniglia');
  });
});
