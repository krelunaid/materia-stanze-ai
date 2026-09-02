import { describe, expect, it } from 'vitest';
import {
  CLEANUP_MAX_TILE_AREA_RATIO,
  cleanupTileBoundsFromRect,
  cleanupTileEdgeIsInternal,
  cleanupTileMaskEnvelope,
  cleanupProtectionMode,
  cleanupTileRatioMatches,
  planCleanupTiles,
  planRoomCleanupPass,
  pointInCleanupTile,
  snapCleanupTileBounds,
  snapCleanupTileRect,
} from './cleanup-tiles';

const region = (label: string, left: number, top: number, right: number, bottom: number) => ({
  label,
  confidence: .9,
  points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }],
});

describe('cleanup tile planning', () => {
  it('protects only an automatic opening outline while keeping explicit Freeze solid', () => {
    expect(cleanupProtectionMode({ kind: 'door', frozen: false })).toBe('outline');
    expect(cleanupProtectionMode({ kind: 'window', frozen: false })).toBe('outline');
    expect(cleanupProtectionMode({ kind: 'door', frozen: true })).toBe('fill');
    expect(cleanupProtectionMode({ kind: 'wall', frozen: true })).toBe('fill');
  });

  it('keeps every region while limiting a room cleanup to three local crops', () => {
    const input = [
      region('poltrona', .04, .42, .2, .82),
      region('lampada', .25, .3, .32, .72),
      region('tavolino', .42, .6, .58, .82),
      region('divano', .38, .45, .82, .78),
      region('pianta', .82, .22, .96, .7),
    ];
    const plans = planCleanupTiles(input);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.length).toBeLessThanOrEqual(3);
    expect(plans.flatMap((plan) => plan.regions).map((item) => item.label).sort())
      .toEqual(input.map((item) => item.label).sort());
  });

  it('adds architectural context and remaps every polygon into tile coordinates', () => {
    const [plan] = planCleanupTiles([region('tavolino', .45, .58, .58, .76)]);
    expect(plan.bounds.left).toBeLessThan(.45);
    expect(plan.bounds.top).toBeLessThan(.58);
    expect(plan.bounds.right).toBeGreaterThan(.58);
    expect(plan.bounds.bottom).toBeGreaterThan(.76);
    for (const point of plan.normalizedRegions[0].points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });

  it('keeps adjacent fitted kitchen parts in the same coherent crop', () => {
    const plans = planCleanupTiles([
      region('basi cucina', .05, .52, .34, .92),
      region('pensili cucina', .06, .18, .33, .5),
      region('forno', .28, .43, .38, .8),
      region('tavolo', .62, .55, .86, .87),
    ]);
    const kitchenPlan = plans.find((plan) => plan.regions.some((item) => item.label === 'basi cucina'));
    expect(kitchenPlan?.regions.map((item) => item.label)).toEqual(expect.arrayContaining([
      'basi cucina', 'pensili cucina', 'forno',
    ]));
  });

  it('plans a distributed fully furnished kitchen without merging distant objects', () => {
    const size = { width: 1600, height: 1068 };
    const input = [
      region('pensile sinistro', .01, .04, .22, .39),
      region('mensola spezie', .02, .39, .23, .54),
      region('frigorifero', .08, .53, .25, .97),
      region('lampada', .28, .1, .35, .36),
      region('pentole', .23, .22, .38, .49),
      region('cappa', .37, .17, .57, .42),
      region('cucina', .39, .51, .59, .94),
      region('pensile destro', .59, .19, .72, .48),
      region('credenza', .58, .5, .77, .91),
      region('arco', .73, .08, .98, .52),
      region('tavolo', .72, .57, .99, .97),
      region('sedie', .76, .59, .99, .98),
    ];
    const plans = planCleanupTiles(input, 10, size);
    expect(plans.length).toBeGreaterThan(1);
    expect(plans.length).toBeLessThanOrEqual(10);
    expect(plans.flatMap((plan) => plan.regions).map((item) => item.label).sort())
      .toEqual(input.map((item) => item.label).sort());
    for (const plan of plans) {
      const rect = snapCleanupTileRect(plan.bounds, size);
      expect(rect.width * rect.height / (size.width * size.height)).toBeLessThanOrEqual(CLEANUP_MAX_TILE_AREA_RATIO);
    }
  });

  it('uses one coherent full-room pass for a heavily furnished room', () => {
    const input = [
      region('pensili', .03, .08, .31, .43),
      region('basi', .02, .46, .36, .95),
      region('forno', .41, .5, .58, .9),
      region('tavolo e sedie', .72, .53, .99, .98),
    ];
    const plans = planRoomCleanupPass(input, 12, { width: 2560, height: 1708 });
    expect(plans).toHaveLength(1);
    expect(plans[0].bounds).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(plans[0].regions).toEqual(input);
    expect(snapCleanupTileRect(plans[0].bounds, { width: 2560, height: 1708 }))
      .toEqual({ left: 0, top: 0, right: 2560, bottom: 1708, width: 2560, height: 1708 });
  });

  it('splits a furnished room when the source ratio is unsupported by the image editor', () => {
    const input = [
      region('cassettiera', .02, .45, .25, .93),
      region('letto', .36, .43, .88, .95),
      region('comodino', .84, .58, .98, .94),
      region('pianta', .61, .22, .77, .66),
    ];
    const size = { width: 1400, height: 1120 }; // 5:4 is not an editor output ratio.
    const plans = planRoomCleanupPass(input, 12, size);

    expect(plans.length).toBeGreaterThan(1);
    expect(plans.every((plan) => (
      plan.bounds.left !== 0 || plan.bounds.top !== 0 || plan.bounds.right !== 1 || plan.bounds.bottom !== 1
    ))).toBe(true);
    expect(plans.flatMap((plan) => plan.regions).map((item) => item.label).sort())
      .toEqual(input.map((item) => item.label).sort());
    for (const plan of plans) {
      const rect = snapCleanupTileRect(plan.bounds, size);
      expect(cleanupTileRatioMatches(rect.width, rect.height, rect.width, rect.height)).toBe(true);
      expect(rect.width * rect.height / (size.width * size.height)).toBeLessThanOrEqual(CLEANUP_MAX_TILE_AREA_RATIO);
    }
  });

  it('keeps a small cleanup as a detail crop', () => {
    const plans = planRoomCleanupPass([region('sedia', .4, .5, .58, .86)], 12, { width: 1600, height: 900 });
    expect(plans).toHaveLength(1);
    expect(plans[0].bounds).not.toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('maps a known tile corner exactly', () => {
    expect(pointInCleanupTile({ x: .25, y: .2 }, { left: .25, top: .2, right: .75, bottom: .8 }))
      .toEqual({ x: 0, y: 0 });
    expect(pointInCleanupTile({ x: .75, y: .8 }, { left: .25, top: .2, right: .75, bottom: .8 }))
      .toEqual({ x: 1, y: 1 });
  });

  it('expands a pixel crop to an exact image-model aspect ratio', () => {
    const snapped = snapCleanupTileBounds({ left: .21, top: .17, right: .63, bottom: .71 }, 1200, 800);
    const width = Math.round((snapped.right - snapped.left) * 1200);
    const height = Math.round((snapped.bottom - snapped.top) * 800);
    expect(cleanupTileRatioMatches(width, height, width, height)).toBe(true);
    expect(['1.0000', '1.7778', '0.5625', '1.3333', '0.7500', '1.5000', '0.6667', '2.0000', '0.5000'])
      .toContain((width / height).toFixed(4));
    expect(snapped.left).toBeLessThanOrEqual(.21);
    expect(snapped.top).toBeLessThanOrEqual(.17);
    expect(snapped.right).toBeGreaterThanOrEqual(.63);
    expect(snapped.bottom).toBeGreaterThanOrEqual(.71);
  });

  it('rejects a generated tile whose aspect ratio changed', () => {
    expect(cleanupTileRatioMatches(1024, 1024, 1024, 768)).toBe(false);
    expect(cleanupTileRatioMatches(1024, 768, 800, 600)).toBe(true);
  });

  it('materializes one exact integer crop and round-trips its normalized bounds', () => {
    const size = { width: 1379, height: 911 };
    const rect = snapCleanupTileRect({ left: .2137, top: .1771, right: .6319, bottom: .7143 }, size);
    const bounds = cleanupTileBoundsFromRect(rect, size);
    expect([rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(Number.isInteger)).toBe(true);
    expect(Math.round(bounds.left * size.width)).toBe(rect.left);
    expect(Math.round(bounds.top * size.height)).toBe(rect.top);
    expect(Math.round(bounds.right * size.width)).toBe(rect.right);
    expect(Math.round(bounds.bottom * size.height)).toBe(rect.bottom);
  });

  it('rejects unsafe forced merging instead of creating a full-frame tile', () => {
    const chain = [
      region('alto sx', .01, .02, .22, .3),
      region('alto dx', .78, .02, .99, .3),
      region('basso sx', .01, .7, .22, .98),
      region('basso dx', .78, .7, .99, .98),
    ];
    expect(() => planCleanupTiles(chain, 1, { width: 1600, height: 900 }))
      .toThrow(/troppo distanti|pulizia.*sicura/i);
  });

  it('never returns a crop above the safe frame-area limit', () => {
    expect(CLEANUP_MAX_TILE_AREA_RATIO).toBeLessThanOrEqual(.65);
    const size = { width: 1600, height: 900 };
    const plans = planCleanupTiles([
      region('basi', .04, .5, .32, .9),
      region('pensili', .05, .16, .31, .48),
      region('tavolo', .62, .58, .82, .84),
    ], 3, size);
    for (const plan of plans) {
      const rect = snapCleanupTileRect(plan.bounds, size);
      expect(rect.width * rect.height / (size.width * size.height)).toBeLessThanOrEqual(CLEANUP_MAX_TILE_AREA_RATIO);
    }
  });

  it('uses one source-space mask envelope at every output scale', () => {
    const envelope = cleanupTileMaskEnvelope([region('tavolo', .4, .45, .62, .78)], { width: 1600, height: 900 });
    expect(envelope.outsetSourcePx * .8 / .8).toBeCloseTo(envelope.outsetSourcePx, 8);
    expect(envelope.outsetSourcePx * .4 / .4).toBeCloseTo(envelope.outsetSourcePx, 8);
    expect(envelope.shadowOffsetSourcePx).toBeCloseTo(envelope.outsetSourcePx * .9, 8);
  });

  it('splits one very large detected object into safe local pieces', () => {
    const size = { width: 1600, height: 900 };
    const plans = planCleanupTiles([region('armadio grande', .02, .03, .98, .97)], 4, size);
    expect(plans.length).toBeGreaterThan(1);
    expect(plans.length).toBeLessThanOrEqual(4);
    const pieces = plans.flatMap((plan) => plan.regions);
    expect(pieces.every((item) => item.label.includes('parte'))).toBe(true);
    expect(pieces.every((item) => item.internalEdges?.length)).toBe(true);
    expect(pieces.some((item) => item.points.some((point, index) => (
      cleanupTileEdgeIsInternal(item, point, item.points[(index + 1) % item.points.length])
    )))).toBe(true);
    for (const plan of plans) {
      const rect = snapCleanupTileRect(plan.bounds, size);
      expect(rect.width * rect.height / (size.width * size.height)).toBeLessThanOrEqual(.65);
    }
  });

  it('triangulates one large concave mask into safe connected pieces', () => {
    const concave = {
      label: 'mobile a U',
      confidence: .9,
      points: [
        { x: .15, y: .05 }, { x: .15, y: .95 }, { x: .85, y: .95 }, { x: .85, y: .05 },
        { x: .68, y: .05 }, { x: .68, y: .75 }, { x: .32, y: .75 }, { x: .32, y: .05 },
      ],
    };
    const plans = planCleanupTiles([concave], 12, { width: 900, height: 1600 });
    const pieces = plans.flatMap((plan) => plan.regions);
    expect(plans.length).toBeGreaterThan(1);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((item) => item.points.length >= 3 && item.points.length <= 4)).toBe(true);
    for (const plan of plans) {
      const rect = snapCleanupTileRect(plan.bounds, { width: 900, height: 1600 });
      expect(rect.width * rect.height / (900 * 1600)).toBeLessThanOrEqual(CLEANUP_MAX_TILE_AREA_RATIO);
    }
  });

  it('keeps triangular pieces valid when a large diamond is split', () => {
    const diamond = {
      label: 'oggetto diagonale',
      confidence: .9,
      points: [{ x: .5, y: .01 }, { x: .99, y: .5 }, { x: .5, y: .99 }, { x: .01, y: .5 }],
    };
    const plans = planCleanupTiles([diamond], 5, { width: 1600, height: 900 });
    expect(plans.flatMap((plan) => plan.regions).every((item) => item.points.length >= 3)).toBe(true);
  });
});
