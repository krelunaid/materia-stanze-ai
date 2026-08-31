import { describe, expect, it } from 'vitest';
import { cleanupTileRatioMatches, planCleanupTiles, pointInCleanupTile, snapCleanupTileBounds } from './cleanup-tiles';

const region = (label: string, left: number, top: number, right: number, bottom: number) => ({
  label,
  confidence: .9,
  points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }],
});

describe('cleanup tile planning', () => {
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
});
