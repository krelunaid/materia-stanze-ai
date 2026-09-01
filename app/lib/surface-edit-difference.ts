export type NormalizedPoint = { x: number; y: number };

export type SurfaceEditDifference = {
  sampledPixels: number;
  meanChannelDifference: number;
  changedPixelRatio: number;
  visiblyChanged: boolean;
};

function pointInsidePolygon(x: number, y: number, polygon: NormalizedPoint[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Detects a real, visible edit inside one normalized surface polygon. */
export function assessVisibleSurfaceEdit(
  original: Uint8ClampedArray,
  edited: Uint8ClampedArray,
  width: number,
  height: number,
  polygon: NormalizedPoint[],
): SurfaceEditDifference {
  if (width < 1 || height < 1 || polygon.length < 3 || original.length !== edited.length || original.length < width * height * 4) {
    return { sampledPixels: 0, meanChannelDifference: 0, changedPixelRatio: 0, visiblyChanged: false };
  }

  const stride = Math.max(1, Math.floor(Math.max(width, height) / 480));
  let sampledPixels = 0;
  let changedPixels = 0;
  let totalDifference = 0;
  for (let y = Math.floor(stride / 2); y < height; y += stride) {
    for (let x = Math.floor(stride / 2); x < width; x += stride) {
      if (!pointInsidePolygon((x + .5) / width, (y + .5) / height, polygon)) continue;
      const offset = (y * width + x) * 4;
      const difference = (
        Math.abs(original[offset] - edited[offset])
        + Math.abs(original[offset + 1] - edited[offset + 1])
        + Math.abs(original[offset + 2] - edited[offset + 2])
      ) / 3;
      sampledPixels += 1;
      totalDifference += difference;
      if (difference >= 12) changedPixels += 1;
    }
  }

  const meanChannelDifference = sampledPixels ? totalDifference / sampledPixels : 0;
  const changedPixelRatio = sampledPixels ? changedPixels / sampledPixels : 0;
  return {
    sampledPixels,
    meanChannelDifference,
    changedPixelRatio,
    visiblyChanged: sampledPixels >= 32 && (meanChannelDifference >= 3 || changedPixelRatio >= .07),
  };
}
