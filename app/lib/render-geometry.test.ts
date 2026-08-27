import { describe, expect, it } from 'vitest';
import { furnitureContactGeometry, furnitureEditRect, hasCompatibleImageGeometry, rectPoints } from './render-geometry';

describe('controlled render geometry', () => {
  it('opens only a bounded area around the furniture floor anchor', () => {
    const rect = furnitureEditRect({ x: .5, y: .8, scale: 24 });
    expect(rect.left).toBeCloseTo(.3176);
    expect(rect.top).toBeCloseTo(.476);
    expect(rect.right).toBeCloseTo(.6824);
    expect(rect.bottom).toBeCloseTo(.8816);
    expect(rectPoints(rect)).toHaveLength(4);
  });

  it('keeps a visible floor band for a natural furniture contact shadow', () => {
    const placement = { x: .5, y: .7, scale: 20 };
    const rect = furnitureEditRect(placement);
    expect(rect.bottom - placement.y).toBeGreaterThanOrEqual(.065);
    expect(rect.right - rect.left).toBeGreaterThan(placement.scale / 100);
  });

  it('clamps furniture editing to the photograph', () => {
    expect(furnitureEditRect({ x: .03, y: .2, scale: 80 })).toMatchObject({ left: 0, top: 0 });
    expect(furnitureEditRect({ x: .98, y: .98, scale: 80 })).toMatchObject({ right: 1, bottom: 1 });
  });

  it('rejects a generated crop with a different aspect ratio', () => {
    expect(hasCompatibleImageGeometry(1600, 1000, 1536, 960)).toBe(true);
    expect(hasCompatibleImageGeometry(1600, 1000, 1500, 1000)).toBe(true);
    expect(hasCompatibleImageGeometry(1600, 1000, 1024, 1024)).toBe(false);
    expect(hasCompatibleImageGeometry(0, 1000, 1024, 1024)).toBe(false);
  });

  it('anchors a transparent furniture cutout to its visible feet', () => {
    const width = 20; const height = 10;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (const x of [3, 4, 15, 16]) pixels[((8 * width + x) * 4) + 3] = 255;
    const contact = furnitureContactGeometry(pixels, width, height);
    expect(contact.bottom).toBe(.9);
    expect(contact.spans).toEqual([{ left: .15, right: .25 }, { left: .75, right: .85 }]);
  });

  it('uses a safe broad shadow for an empty or invalid cutout', () => {
    expect(furnitureContactGeometry(new Uint8ClampedArray(), 0, 0)).toEqual({
      bottom: 1,
      spans: [{ left: .18, right: .82 }],
    });
  });
});
