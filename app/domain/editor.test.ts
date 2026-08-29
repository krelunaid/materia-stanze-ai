import { describe, expect, it } from 'vitest';
import { clampPoint, isValidPolygon, moveVertex, nextSurfaceName, Surface } from './editor';

const wall: Surface = {
  id: 'wall-1',
  name: 'Muro 1',
  kind: 'wall',
  frozen: false,
  points: [{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.8 }],
};

describe('editor geometry', () => {
  it('clamps normalized coordinates', () => {
    expect(clampPoint({ x: -1, y: 2 })).toEqual({ x: 0, y: 1 });
  });

  it('rejects degenerate polygons', () => {
    expect(isValidPolygon([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }])).toBe(false);
    expect(isValidPolygon(wall.points)).toBe(true);
  });

  it('rejects self-intersections, duplicate edges and non-finite points', () => {
    expect(isValidPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(false);
    expect(isValidPolygon([{ x: 0, y: 0 }, { x: .001, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBe(false);
    expect(isValidPolygon([{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });

  it('numbers walls deterministically', () => {
    expect(nextSurfaceName('wall', [wall])).toBe('Muro 2');
    expect(nextSurfaceName('wall', [wall, { ...wall, id: 'wall-3', name: 'Muro 3' }])).toBe('Muro 4');
    expect(nextSurfaceName('wall', [{ ...wall, name: 'Parete TV' }])).toBe('Muro 1');
    expect(nextSurfaceName('floor', [])).toBe('Pavimento');
  });

  it('does not move a frozen surface', () => {
    const frozen = { ...wall, frozen: true };
    expect(moveVertex(frozen, 0, { x: 0.4, y: 0.4 })).toBe(frozen);
  });
});
