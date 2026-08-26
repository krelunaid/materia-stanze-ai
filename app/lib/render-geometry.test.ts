import { describe, expect, it } from 'vitest';
import { furnitureEditRect, hasCompatibleImageGeometry, rectPoints } from './render-geometry';

describe('controlled render geometry', () => {
  it('opens only a bounded area around the furniture floor anchor', () => {
    const rect = furnitureEditRect({ x: .5, y: .8, scale: 24 });
    expect(rect.left).toBeCloseTo(.3608);
    expect(rect.top).toBeCloseTo(.476);
    expect(rect.right).toBeCloseTo(.6392);
    expect(rect.bottom).toBeCloseTo(.8288);
    expect(rectPoints(rect)).toHaveLength(4);
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
});
