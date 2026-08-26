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
