import { describe, expect, it } from 'vitest';
import { coverSourceRect } from './canvas-draw';

describe('coverSourceRect', () => {
  it('returns the full source when aspect ratios already match', () => {
    expect(coverSourceRect(1600, 1000, 800, 500)).toEqual({ sx: 0, sy: 0, sw: 1600, sh: 1000 });
  });

  it('crops the sides of a wider generated image instead of stretching it', () => {
    const rect = coverSourceRect(2000, 1000, 800, 500);
    expect(rect.sy).toBe(0);
    expect(rect.sh).toBe(1000);
    expect(rect.sw).toBeCloseTo(1600);
    expect(rect.sx).toBeCloseTo(200);
  });

  it('crops the top and bottom of a taller generated image', () => {
    const rect = coverSourceRect(800, 1200, 800, 500);
    expect(rect.sx).toBe(0);
    expect(rect.sw).toBe(800);
    expect(rect.sh).toBeCloseTo(500);
    expect(rect.sy).toBeCloseTo(350);
  });
});
