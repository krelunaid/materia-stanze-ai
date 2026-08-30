import { describe, expect, it } from 'vitest';
import { GeometryCandidate, validateRoomGeometry } from './validate';

const base: GeometryCandidate[] = [
  {
    id: 'wall:left:0', name: 'Muro sinistro', kind: 'wall', confidence: .9,
    points: [{ x: 0, y: 0 }, { x: .4, y: 0 }, { x: .4, y: .65 }, { x: 0, y: .72 }],
  },
  {
    id: 'wall:right:1', name: 'Muro destro', kind: 'wall', confidence: .9,
    points: [{ x: .4, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: .4, y: .65 }],
  },
  {
    id: 'floor', name: 'Pavimento', kind: 'floor', confidence: .9,
    points: [{ x: 0, y: .72 }, { x: .4, y: .65 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  },
];

const demoLayoutWall: GeometryCandidate = {
  id: 'wall:demo-front', name: 'Muro frontale demo', kind: 'wall', confidence: .95,
  points: [{ x: .218, y: .13 }, { x: .785, y: .13 }, { x: .785, y: .695 }, { x: .218, y: .695 }],
};

describe('validateRoomGeometry', () => {
  it('rejects the canonical demo window on a user geometry', () => {
    const demoWindow: GeometryCandidate = {
      name: 'Finestra', kind: 'window', confidence: .95,
      points: [{ x: .334, y: .18 }, { x: .667, y: .18 }, { x: .667, y: .552 }, { x: .334, y: .552 }],
    };
    const result = validateRoomGeometry([...base, demoLayoutWall, demoWindow]);
    expect(result.surfaces.some((surface) => surface.kind === 'window')).toBe(false);
    expect(result.rejected).toContainEqual({ kind: 'window', reason: 'template-leak' });
  });

  it('keeps a left window inside its parent wall', () => {
    const window: GeometryCandidate = {
      name: 'Finestra', kind: 'window', confidence: .87, slot: 'left',
      points: [{ x: .06, y: .08 }, { x: .32, y: .1 }, { x: .32, y: .45 }, { x: .06, y: .47 }],
    };
    const result = validateRoomGeometry([...base, window], { expectedSlots: { window: 'left' } });
    const accepted = result.surfaces.find((surface) => surface.kind === 'window');
    expect(accepted).toMatchObject({ id: 'window:left', slot: 'left', parentId: 'wall:left:0' });
  });

  it('rejects a slot mismatch instead of relabelling a centred opening', () => {
    const window: GeometryCandidate = {
      name: 'Finestra', kind: 'window', confidence: .9, slot: 'left',
      points: [{ x: .45, y: .16 }, { x: .61, y: .16 }, { x: .61, y: .42 }, { x: .45, y: .42 }],
    };
    const result = validateRoomGeometry([...base, window], { expectedSlots: { window: 'left' } });
    expect(result.surfaces.some((surface) => surface.kind === 'window')).toBe(false);
    expect(result.rejected).toContainEqual({ kind: 'window', reason: 'slot-mismatch' });
  });

  it('rejects an opening whose centre is outside every wall', () => {
    const window: GeometryCandidate = {
      name: 'Finestra', kind: 'window', confidence: .9,
      points: [{ x: .72, y: .78 }, { x: .9, y: .78 }, { x: .9, y: .94 }, { x: .72, y: .94 }],
    };
    const result = validateRoomGeometry([...base, window]);
    expect(result.surfaces.some((surface) => surface.kind === 'window')).toBe(false);
    expect(result.rejected).toContainEqual({ kind: 'window', reason: 'opening-without-wall' });
  });

  it('allows the canonical window only for the explicit demo source', () => {
    const demoWall: GeometryCandidate = {
      id: 'demo-wall', name: 'Muro demo', kind: 'wall', confidence: .99,
      points: [{ x: .2, y: .08 }, { x: .8, y: .08 }, { x: .8, y: .7 }, { x: .2, y: .7 }],
    };
    const demoWindow: GeometryCandidate = {
      id: 'demo-window', name: 'Finestra', kind: 'window', confidence: .95,
      points: [{ x: .334, y: .18 }, { x: .667, y: .18 }, { x: .667, y: .552 }, { x: .334, y: .552 }],
    };
    const result = validateRoomGeometry([...base, demoWall, demoWindow], { source: 'demo' });
    expect(result.surfaces.some((surface) => surface.kind === 'window')).toBe(true);
  });

  it('rejects a shifted template by IoU and drops every other opening', () => {
    const shiftedTemplate: GeometryCandidate = {
      name: 'Finestra sospetta', kind: 'window', confidence: .95,
      points: [{ x: .37, y: .2 }, { x: .63, y: .2 }, { x: .63, y: .53 }, { x: .37, y: .53 }],
    };
    const door: GeometryCandidate = {
      name: 'Porta', kind: 'door', confidence: .9,
      points: [{ x: .05, y: .28 }, { x: .18, y: .28 }, { x: .18, y: .7 }, { x: .05, y: .715 }],
    };
    const result = validateRoomGeometry([...base, demoLayoutWall, shiftedTemplate, door]);
    expect(result.droppedOpenings).toBe(true);
    expect(result.surfaces.some((surface) => surface.kind === 'door' || surface.kind === 'window')).toBe(false);
  });

  it('keeps valid openings when a different candidate is rejected', () => {
    const validWindow: GeometryCandidate = {
      name: 'Finestra reale', kind: 'window', confidence: .92,
      points: [{ x: .06, y: .1 }, { x: .3, y: .1 }, { x: .3, y: .46 }, { x: .06, y: .46 }],
    };
    const invalidDoor: GeometryCandidate = {
      name: 'Porta falsa', kind: 'door', confidence: .9,
      points: [{ x: .72, y: .78 }, { x: .9, y: .78 }, { x: .9, y: .94 }, { x: .72, y: .94 }],
    };
    const result = validateRoomGeometry([...base, validWindow, invalidDoor]);
    expect(result.surfaces.some((surface) => surface.kind === 'window')).toBe(true);
    expect(result.surfaces.some((surface) => surface.kind === 'door')).toBe(false);
    expect(result.droppedOpenings).toBe(false);
  });

  it('keeps repeated windows on the same wall as separate surfaces', () => {
    const first: GeometryCandidate = {
      name: 'Finestra sinistra', kind: 'window', confidence: .94,
      points: [{ x: .04, y: .12 }, { x: .15, y: .12 }, { x: .15, y: .44 }, { x: .04, y: .44 }],
    };
    const second: GeometryCandidate = {
      name: 'Finestra destra', kind: 'window', confidence: .93,
      points: [{ x: .22, y: .14 }, { x: .35, y: .14 }, { x: .35, y: .46 }, { x: .22, y: .46 }],
    };
    const result = validateRoomGeometry([...base, first, second]);
    const windows = result.surfaces.filter((surface) => surface.kind === 'window');
    expect(windows).toHaveLength(2);
    expect(new Set(windows.map((surface) => surface.id)).size).toBe(2);
    expect(windows.map((surface) => surface.id)).toEqual(['window:left', 'window:left:2']);
  });

  it('rejects a self-intersecting bowtie', () => {
    const bowtie: GeometryCandidate = {
      name: 'Muro impossibile', kind: 'wall', confidence: .9,
      points: [{ x: .1, y: .1 }, { x: .35, y: .55 }, { x: .1, y: .55 }, { x: .35, y: .1 }],
    };
    const result = validateRoomGeometry([...base, bowtie]);
    expect(result.rejected).toContainEqual({ kind: 'wall', reason: 'invalid-polygon' });
  });

  it('keeps a real centred window when the rest of the room is not the demo template', () => {
    const frontWall: GeometryCandidate = {
      id: 'wall:wide-front', name: 'Muro frontale reale', kind: 'wall', confidence: .95,
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .65 }, { x: 0, y: .65 }],
    };
    const centredWindow: GeometryCandidate = {
      name: 'Finestra centrale reale', kind: 'window', confidence: .9,
      points: [{ x: .35, y: .18 }, { x: .65, y: .18 }, { x: .65, y: .5 }, { x: .35, y: .5 }],
    };
    const result = validateRoomGeometry([frontWall, base[2], centredWindow]);
    expect(result.surfaces.some((surface) => surface.kind === 'window')).toBe(true);
    expect(result.rejected).not.toContainEqual({ kind: 'window', reason: 'template-leak' });
  });

  it('requires almost the whole opening to lie in its local parent wall', () => {
    const crossingWindow: GeometryCandidate = {
      name: 'Finestra a cavallo', kind: 'window', confidence: .9,
      points: [{ x: .32, y: .12 }, { x: .5, y: .12 }, { x: .5, y: .42 }, { x: .32, y: .42 }],
    };
    const result = validateRoomGeometry([...base, crossingWindow]);
    expect(result.rejected).toContainEqual({ kind: 'window', reason: 'opening-without-wall' });
  });
});
