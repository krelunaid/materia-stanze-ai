export type NormalizedProductBounds = { left: number; top: number; right: number; bottom: number };
export type PixelCrop = { left: number; top: number; right: number; bottom: number };

function colorDistance(data: Uint8ClampedArray, first: number, second: number) {
  const red = data[first] - data[second];
  const green = data[first + 1] - data[second + 1];
  const blue = data[first + 2] - data[second + 2];
  return Math.hypot(red, green, blue);
}

/**
 * Removes only background pixels connected to the outside of the AI product box.
 * Unlike a global chroma key this preserves similarly coloured parts of the product
 * and clears holes between legs or shelves when they connect to the background.
 */
export function removeConnectedProductBackground(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  bounds?: NormalizedProductBounds,
  expectedWidthHeightRatio?: number,
) {
  const data = new Uint8ClampedArray(source);
  const requestedLeft = bounds ? Math.floor(bounds.left * width) : 0;
  const requestedTop = bounds ? Math.floor(bounds.top * height) : 0;
  const requestedRight = bounds ? Math.ceil(bounds.right * width) : width - 1;
  const requestedBottom = bounds ? Math.ceil(bounds.bottom * height) : height - 1;
  // Keep the expansion deliberately small: the vision box already follows the
  // furniture body and a larger margin would reintroduce lamps or artwork.
  const padding = Math.max(1, Math.round(Math.max(requestedRight - requestedLeft, requestedBottom - requestedTop) * .009));
  const left = Math.max(0, requestedLeft - padding);
  const top = Math.max(0, requestedTop - padding);
  const right = Math.min(width - 1, requestedRight + padding);
  const bottom = Math.min(height - 1, requestedBottom + padding);
  const offset = (x: number, y: number) => (y * width + x) * 4;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < left || x > right || y < top || y > bottom) data[offset(x, y) + 3] = 0;
    }
  }

  const borderSamples: number[] = [];
  const perimeter = Math.max(1, (right - left + bottom - top) * 2);
  const stride = Math.max(1, Math.floor(perimeter / 180));
  for (let x = left; x <= right; x += stride) {
    borderSamples.push(offset(x, top), offset(x, bottom));
  }
  for (let y = top; y <= bottom; y += stride) {
    borderSamples.push(offset(left, y), offset(right, y));
  }
  // A product may touch one side of an imperfect AI box. Build the palette only
  // from the most frequent border colour families, rather than treating every
  // border pixel (including the product) as removable background.
  const colorFamilies = new Map<number, { count: number; sample: number }>();
  for (const sample of borderSamples) {
    const key = (data[sample] >> 5) * 64 + (data[sample + 1] >> 5) * 8 + (data[sample + 2] >> 5);
    const family = colorFamilies.get(key);
    if (family) family.count += 1;
    else colorFamilies.set(key, { count: 1, sample });
  }
  const rankedFamilies = [...colorFamilies.values()].sort((first, second) => second.count - first.count);
  const palette: number[] = [];
  let represented = 0;
  for (const family of rankedFamilies) {
    if (palette.length >= 5 || (palette.length >= 2 && represented / borderSamples.length >= .78)) break;
    palette.push(family.sample);
    represented += family.count;
  }
  const nearestEdgeColor = (pixelOffset: number) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const sample of palette) nearest = Math.min(nearest, colorDistance(data, pixelOffset, sample));
    return nearest;
  };

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(Math.max(1, (right - left + 1) * (bottom - top + 1)));
  let head = 0; let tail = 0;
  const enqueue = (x: number, y: number, requireBackgroundColor = false) => {
    const index = y * width + x;
    if (visited[index]) return;
    if (requireBackgroundColor && nearestEdgeColor(index * 4) > 24) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = left; x <= right; x += 1) { enqueue(x, top, true); enqueue(x, bottom, true); }
  for (let y = top; y <= bottom; y += 1) { enqueue(left, y, true); enqueue(right, y, true); }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width; const y = Math.floor(index / width);
    const currentOffset = index * 4;
    data[currentOffset + 3] = 0;
    const neighbours = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nextX, nextY] of neighbours) {
      if (nextX < left || nextX > right || nextY < top || nextY > bottom) continue;
      const nextIndex = nextY * width + nextX;
      if (visited[nextIndex]) continue;
      const nextOffset = nextIndex * 4;
      const edgeDistance = nearestEdgeColor(nextOffset);
      // Do not walk across a gradual colour transition: pale wood can be close
      // to a beige catalog floor. A conservative direct palette match keeps the
      // complete object and accepts a tiny soft halo instead of deleting it.
      if (edgeDistance <= 22) enqueue(nextX, nextY);
    }
  }

  // Feather just the product edge; do not create a rectangular halo.
  for (let y = top + 1; y < bottom; y += 1) {
    for (let x = left + 1; x < right; x += 1) {
      const pixelOffset = offset(x, y);
      if (data[pixelOffset + 3] === 0) continue;
      const touchesBackground = data[offset(x - 1, y) + 3] === 0 || data[offset(x + 1, y) + 3] === 0
        || data[offset(x, y - 1) + 3] === 0 || data[offset(x, y + 1) + 3] === 0;
      if (touchesBackground) data[pixelOffset + 3] = Math.min(data[pixelOffset + 3], 190);
    }
  }

  // Catalog scenes often contain books, lamps and cast shadows inside the AI
  // rectangle. Keep the largest connected foreground object intact instead of
  // cropping it by an estimated physical aspect ratio, which can cut legs or tops.
  const labels = new Int32Array(width * height);
  const componentQueue = new Int32Array(Math.max(1, (right - left + 1) * (bottom - top + 1)));
  let label = 0; let largestLabel = 0; let largestSize = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const startIndex = y * width + x;
      if (labels[startIndex] || data[startIndex * 4 + 3] < 32) continue;
      label += 1;
      let componentHead = 0; let componentTail = 0; let componentSize = 0;
      labels[startIndex] = label;
      componentQueue[componentTail++] = startIndex;
      while (componentHead < componentTail) {
        const index = componentQueue[componentHead++];
        componentSize += 1;
        const currentX = index % width; const currentY = Math.floor(index / width);
        const neighbours = [[currentX - 1, currentY], [currentX + 1, currentY], [currentX, currentY - 1], [currentX, currentY + 1]];
        for (const [nextX, nextY] of neighbours) {
          if (nextX < left || nextX > right || nextY < top || nextY > bottom) continue;
          const nextIndex = nextY * width + nextX;
          if (labels[nextIndex] || data[nextIndex * 4 + 3] < 32) continue;
          labels[nextIndex] = label;
          componentQueue[componentTail++] = nextIndex;
        }
      }
      if (componentSize > largestSize) { largestSize = componentSize; largestLabel = label; }
    }
  }
  if (largestLabel) {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const index = y * width + x;
        if (labels[index] !== largestLabel) data[index * 4 + 3] = 0;
      }
    }
  }

  // Low, wide cabinets are commonly photographed with books or lamps resting on
  // top and a long cast shadow beneath them. Those pixels can touch the furniture,
  // so connected-component filtering alone cannot separate them. Detect the
  // sustained, opaque horizontal body and retain a short support zone for legs.
  // The rule is intentionally limited to wide silhouettes so chairs, lamps and
  // other upright products keep their full shape.
  let componentLeft = width; let componentTop = height; let componentRight = -1; let componentBottom = -1;
  if (largestLabel) {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const index = y * width + x;
        if (labels[index] !== largestLabel || data[index * 4 + 3] < 96) continue;
        componentLeft = Math.min(componentLeft, x); componentRight = Math.max(componentRight, x);
        componentTop = Math.min(componentTop, y); componentBottom = Math.max(componentBottom, y);
      }
    }
  }
  const componentWidth = componentRight - componentLeft + 1;
  const componentHeight = componentBottom - componentTop + 1;
  if (componentWidth > 0 && componentHeight > 0 && componentWidth / componentHeight >= 1.3) {
    const requiredRun = Math.max(4, Math.floor(componentWidth * .58));
    const qualifyingRows: boolean[] = [];
    for (let y = componentTop; y <= componentBottom; y += 1) {
      let longestRun = 0; let currentRun = 0;
      for (let x = componentLeft; x <= componentRight; x += 1) {
        const opaque = data[(y * width + x) * 4 + 3] >= 96;
        currentRun = opaque ? currentRun + 1 : 0;
        longestRun = Math.max(longestRun, currentRun);
      }
      qualifyingRows[y] = longestRun >= requiredRun;
    }
    let bestStart = -1; let bestEnd = -1; let runStart = -1;
    for (let y = componentTop; y <= componentBottom + 1; y += 1) {
      if (y <= componentBottom && qualifyingRows[y]) {
        if (runStart < 0) runStart = y;
      } else if (runStart >= 0) {
        const runEnd = y - 1;
        if (runEnd - runStart > bestEnd - bestStart) { bestStart = runStart; bestEnd = runEnd; }
        runStart = -1;
      }
    }
    const bodyHeight = bestEnd - bestStart + 1;
    if (bestStart >= 0 && bodyHeight >= Math.max(3, Math.round(componentHeight * .12))) {
      // Start at the first sustained full-width row. This deliberately excludes
      // books and lamps resting on the top plane, even when their pixels touch it.
      const retainedTop = bestStart;
      const supportBottom = bestEnd + Math.round(componentWidth * .13);
      const dimensionBottom = expectedWidthHeightRatio && expectedWidthHeightRatio > 1
        // Perspective exposes some depth, hence a 26% tolerance over the
        // catalog front elevation. More would retain the staged floor shadow.
        ? retainedTop + Math.round(componentWidth / expectedWidthHeightRatio * 1.26)
        : componentBottom;
      const retainedBottom = Math.min(componentBottom, supportBottom, dimensionBottom);
      for (let y = componentTop; y <= componentBottom; y += 1) {
        if (y >= retainedTop && y <= retainedBottom) continue;
        for (let x = componentLeft; x <= componentRight; x += 1) data[(y * width + x) * 4 + 3] = 0;
      }

      // Below the wide body, retain only narrow runs that continue vertically:
      // these are legs or feet. Broad or diagonal runs are staged floor shadows.
      let previousSupports: Array<{ start: number; end: number }> = [];
      const maximumSupportWidth = Math.max(3, Math.round(componentWidth * .25));
      for (let y = bestEnd + 1; y <= retainedBottom; y += 1) {
        const runs: Array<{ start: number; end: number }> = [];
        let runStart = -1;
        for (let x = componentLeft; x <= componentRight + 1; x += 1) {
          const opaque = x <= componentRight && data[(y * width + x) * 4 + 3] >= 96;
          if (opaque && runStart < 0) runStart = x;
          if (!opaque && runStart >= 0) { runs.push({ start: runStart, end: x - 1 }); runStart = -1; }
        }
        const supports = runs.filter((run) => {
          if (run.end - run.start + 1 > maximumSupportWidth) return false;
          return y === bestEnd + 1 || previousSupports.some((previous) => run.start <= previous.end + 2 && run.end >= previous.start - 2);
        });
        for (let x = componentLeft; x <= componentRight; x += 1) {
          const supported = supports.some((run) => x >= run.start - 1 && x <= run.end + 1);
          if (!supported) data[(y * width + x) * 4 + 3] = 0;
        }
        previousSupports = supports;
      }
    }
  }

  let cropLeft = width; let cropTop = height; let cropRight = -1; let cropBottom = -1;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (data[offset(x, y) + 3] < 32) continue;
      cropLeft = Math.min(cropLeft, x); cropRight = Math.max(cropRight, x);
      cropTop = Math.min(cropTop, y); cropBottom = Math.max(cropBottom, y);
    }
  }
  const crop: PixelCrop = cropRight >= cropLeft && cropBottom >= cropTop
    ? { left: cropLeft, top: cropTop, right: cropRight + 1, bottom: cropBottom + 1 }
    : { left, top, right: right + 1, bottom: bottom + 1 };
  return { data, crop };
}
