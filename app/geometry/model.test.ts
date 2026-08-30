import { describe, expect, it } from 'vitest';
import type { Surface } from '../domain/editor';
import { approveGeometry, geometryForDerivedImage, geometrySnapshotsAfterEdit, surfacesMatch } from './model';

const floor: Surface = {
  id: 'floor',
  name: 'Pavimento',
  kind: 'floor',
  frozen: false,
  points: [{ x: 0, y: .6 }, { x: 1, y: .6 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
};

describe('RoomGeometryV1', () => {
  it('keeps approved contours when an empty-room image is derived', () => {
    const detected: Surface[] = [{
      ...floor,
      id: 'new-floor',
      points: [{ x: 0, y: .4 }, { x: 1, y: .4 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    }];
    const derived = geometryForDerivedImage([floor]);
    expect(surfacesMatch(derived, [floor])).toBe(true);
    expect(surfacesMatch(derived, detected)).toBe(false);
    expect(derived[0]).not.toBe(floor);
    expect(derived[0].points[0]).not.toBe(floor.points[0]);
  });

  it('marks a committed contour as approved', () => {
    const geometry = approveGeometry([floor], 'ai');
    expect(geometry.schema).toBe('RoomGeometryV1');
    expect(geometry.status).toBe('approved');
    expect(geometry.surfaces[0].id).toBe('floor');
  });

  it('persists a Pencil opening across original and empty-room snapshots', () => {
    const door: Surface = {
      id: 'manual-door-1',
      name: 'Porta 1',
      kind: 'door',
      frozen: false,
      source: 'manual',
      confidence: 1,
      parentId: 'wall:left',
      points: [{ x: 0, y: .2 }, { x: .2, y: .2 }, { x: .2, y: .9 }, { x: 0, y: .9 }],
    };
    const snapshots = geometrySnapshotsAfterEdit([floor, door], true);

    expect(snapshots.original.some((surface) => surface.id === door.id)).toBe(true);
    expect(snapshots.processed?.some((surface) => surface.id === door.id)).toBe(true);
    expect(snapshots.original).not.toBe(snapshots.processed);
  });
});
