import type { Point } from '../domain/editor';

export type FurniturePlacement = { x: number; y: number; scale: number };
export type NormalizedRect = { left: number; top: number; right: number; bottom: number };

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** A bounded edit window around the furniture floor-contact anchor. */
export function furnitureEditRect(item: FurniturePlacement): NormalizedRect {
  const width = Math.min(.9, Math.max(.06, item.scale / 100));
  const height = Math.min(.9, Math.max(.1, width * 1.35));
  return {
    left: clamp(item.x - width * .58),
    top: clamp(item.y - height),
    right: clamp(item.x + width * .58),
    bottom: clamp(item.y + Math.max(.025, width * .12)),
  };
}

export function rectPoints(rect: NormalizedRect): Point[] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
}

export function hasCompatibleImageGeometry(
  sourceWidth: number,
  sourceHeight: number,
  generatedWidth: number,
  generatedHeight: number,
  // xAI returns the nearest supported photographic ratio (for example 3:2
  // for a 16:10 source). The generated pixels are subsequently cropped only
  // inside the authorised edit polygons, never across the whole photograph.
  tolerance = .15,
) {
  if ([sourceWidth, sourceHeight, generatedWidth, generatedHeight].some((value) => !Number.isFinite(value) || value <= 0)) return false;
  const sourceRatio = sourceWidth / sourceHeight;
  const generatedRatio = generatedWidth / generatedHeight;
  return Math.abs(sourceRatio - generatedRatio) / sourceRatio <= tolerance;
}
