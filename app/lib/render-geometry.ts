import type { Point } from '../domain/editor';

export type FurniturePlacement = { x: number; y: number; scale: number };
export type NormalizedRect = { left: number; top: number; right: number; bottom: number };
export type FurnitureContactGeometry = { bottom: number; spans: Array<{ left: number; right: number }> };

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

/** Finds the visible bottom edge and the feet/contact runs of an RGBA cutout. */
export function furnitureContactGeometry(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 24,
): FurnitureContactGeometry {
  const fallback = { bottom: 1, spans: [{ left: .18, right: .82 }] };
  if (width < 1 || height < 1 || pixels.length < width * height * 4) return fallback;
  let bottom = -1;
  for (let y = height - 1; y >= 0 && bottom < 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > alphaThreshold) { bottom = y; break; }
    }
  }
  if (bottom < 0) return fallback;

  const bandTop = Math.max(0, bottom - Math.max(2, Math.ceil(height * .035)));
  const occupied = Array.from({ length: width }, (_, x) => {
    for (let y = bandTop; y <= bottom; y += 1) {
      if (pixels[(y * width + x) * 4 + 3] > alphaThreshold) return true;
    }
    return false;
  });
  const rawRuns: Array<{ left: number; right: number }> = [];
  for (let x = 0; x < width; x += 1) {
    if (!occupied[x]) continue;
    const left = x;
    while (x + 1 < width && occupied[x + 1]) x += 1;
    rawRuns.push({ left, right: x + 1 });
  }
  const maxGap = Math.max(1, Math.ceil(width * .012));
  const merged: Array<{ left: number; right: number }> = [];
  for (const run of rawRuns) {
    const previous = merged.at(-1);
    if (previous && run.left - previous.right <= maxGap) previous.right = run.right;
    else merged.push({ ...run });
  }
  const spans = merged
    .sort((a, b) => (b.right - b.left) - (a.right - a.left))
    .slice(0, 6)
    .sort((a, b) => a.left - b.left)
    .map((run) => ({ left: run.left / width, right: run.right / width }));
  return { bottom: (bottom + 1) / height, spans: spans.length ? spans : fallback.spans };
}
