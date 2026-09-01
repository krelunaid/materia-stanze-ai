import { describe, expect, it } from 'vitest';
import { assessVisibleSurfaceEdit } from './surface-edit-difference';

const fullFrame = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

function solidPixels(width: number, height: number, value: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

describe('assessVisibleSurfaceEdit', () => {
  it('rejects an unchanged result', () => {
    const original = solidPixels(20, 20, 120);
    expect(assessVisibleSurfaceEdit(original, original.slice(), 20, 20, fullFrame).visiblyChanged).toBe(false);
  });

  it('accepts a visible material change inside the target polygon', () => {
    const original = solidPixels(20, 20, 120);
    const edited = original.slice();
    for (let y = 4; y < 16; y += 1) {
      for (let x = 4; x < 16; x += 1) edited[(y * 20 + x) * 4] = 180;
    }
    const target = [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }];
    const result = assessVisibleSurfaceEdit(original, edited, 20, 20, target);
    expect(result.visiblyChanged).toBe(true);
    expect(result.changedPixelRatio).toBeGreaterThan(.9);
  });

  it('ignores changes outside the selected surface', () => {
    const original = solidPixels(20, 20, 120);
    const edited = original.slice();
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) edited[(y * 20 + x) * 4] = 255;
    }
    const target = [{ x: .5, y: .5 }, { x: 1, y: .5 }, { x: 1, y: 1 }, { x: .5, y: 1 }];
    expect(assessVisibleSurfaceEdit(original, edited, 20, 20, target).visiblyChanged).toBe(false);
  });
});
