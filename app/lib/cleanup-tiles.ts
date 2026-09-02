import { Point, SurfaceKind } from '../domain/editor';

export type CleanupTileRegion = {
  label: string;
  points: Point[];
  confidence: number;
  internalEdges?: CleanupTileSplitEdge[];
};

export type CleanupTileSplitEdge = { axis: 'x' | 'y'; value: number };

export type CleanupTileBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type CleanupTileImageSize = { width: number; height: number };

export type CleanupTilePixelRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type CleanupGenerationFrame = {
  width: number;
  height: number;
  sourceLeft: number;
  sourceTop: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type CleanupTileMaskEnvelope = {
  outsetSourcePx: number;
  shadowOffsetSourcePx: number;
};

// A crop may be large enough to contain a bed or a fitted kitchen, but a true
// full-frame regeneration is never accepted by the local-cleanup pipeline.
export const CLEANUP_MAX_TILE_AREA_RATIO = .65;

export type CleanupTilePlan = {
  bounds: CleanupTileBounds;
  regions: CleanupTileRegion[];
  normalizedRegions: CleanupTileRegion[];
};

export function cleanupProtectionMode(surface: { kind: SurfaceKind; frozen: boolean }) {
  return !surface.frozen && (surface.kind === 'door' || surface.kind === 'window')
    ? 'outline' as const
    : 'fill' as const;
}

export const COHERENT_ROOM_PASS_MIN_REGIONS = 4;

const supportedRatios = [
  { width: 1, height: 1 }, { width: 16, height: 9 }, { width: 9, height: 16 },
  { width: 4, height: 3 }, { width: 3, height: 4 }, { width: 3, height: 2 },
  { width: 2, height: 3 }, { width: 2, height: 1 }, { width: 1, height: 2 },
];

/**
 * Keeps the complete source photograph at its original scale and centres it
 * inside the smallest canvas accepted by the image editor.  The extra border
 * is technical context only and is cropped away after the single coherent
 * generation.
 */
export function cleanupGenerationFrame(width: number, height: number): CleanupGenerationFrame {
  const candidates = supportedRatios.map((ratio) => {
    const units = Math.ceil(Math.max(width / ratio.width, height / ratio.height));
    const frameWidth = units * ratio.width;
    const frameHeight = units * ratio.height;
    return {
      width: frameWidth,
      height: frameHeight,
      area: frameWidth * frameHeight,
      addedArea: frameWidth * frameHeight - width * height,
    };
  }).sort((first, second) => first.addedArea - second.addedArea || first.area - second.area);
  const chosen = candidates[0];
  return {
    width: chosen.width,
    height: chosen.height,
    sourceLeft: Math.floor((chosen.width - width) / 2),
    sourceTop: Math.floor((chosen.height - height) / 2),
    sourceWidth: width,
    sourceHeight: height,
  };
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function regionBounds(regions: CleanupTileRegion[]): CleanupTileBounds {
  const points = regions.flatMap((region) => region.points);
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function paddedBounds(regions: CleanupTileRegion[]): CleanupTileBounds {
  const bounds = regionBounds(regions);
  const width = Math.max(.02, bounds.right - bounds.left);
  const height = Math.max(.02, bounds.bottom - bounds.top);
  const desiredWidth = Math.min(1, Math.max(.38, width + .18));
  const desiredHeight = Math.min(1, Math.max(.42, height + .18));
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  let left = centerX - desiredWidth / 2;
  let right = centerX + desiredWidth / 2;
  let top = centerY - desiredHeight / 2;
  let bottom = centerY + desiredHeight / 2;
  if (left < 0) { right -= left; left = 0; }
  if (right > 1) { left -= right - 1; right = 1; }
  if (top < 0) { bottom -= top; top = 0; }
  if (bottom > 1) { top -= bottom - 1; bottom = 1; }
  return { left: clamp(left), top: clamp(top), right: clamp(right), bottom: clamp(bottom) };
}

export function pointInCleanupTile(point: Point, bounds: CleanupTileBounds): Point {
  const width = Math.max(.0001, bounds.right - bounds.left);
  const height = Math.max(.0001, bounds.bottom - bounds.top);
  return {
    x: clamp((point.x - bounds.left) / width),
    y: clamp((point.y - bounds.top) / height),
  };
}

export function snapCleanupTileBounds(
  bounds: CleanupTileBounds,
  imageWidth: number,
  imageHeight: number,
): CleanupTileBounds {
  const size = { width: imageWidth, height: imageHeight };
  return cleanupTileBoundsFromRect(snapCleanupTileRect(bounds, size), size);
}

export function cleanupTileBoundsFromRect(rect: CleanupTilePixelRect, size: CleanupTileImageSize): CleanupTileBounds {
  return {
    left: rect.left / size.width,
    top: rect.top / size.height,
    right: rect.right / size.width,
    bottom: rect.bottom / size.height,
  };
}

export function snapCleanupTileRect(bounds: CleanupTileBounds, size: CleanupTileImageSize): CleanupTilePixelRect {
  if (bounds.left <= .000001 && bounds.top <= .000001
    && bounds.right >= .999999 && bounds.bottom >= .999999) {
    return {
      left: 0,
      top: 0,
      right: size.width,
      bottom: size.height,
      width: size.width,
      height: size.height,
    };
  }
  const left = Math.floor(bounds.left * size.width);
  const top = Math.floor(bounds.top * size.height);
  const right = Math.ceil(bounds.right * size.width);
  const bottom = Math.ceil(bounds.bottom * size.height);
  const requiredWidth = Math.max(1, right - left);
  const requiredHeight = Math.max(1, bottom - top);
  const candidates = supportedRatios.flatMap((ratio) => {
    const units = Math.ceil(Math.max(requiredWidth / ratio.width, requiredHeight / ratio.height));
    const width = units * ratio.width; const height = units * ratio.height;
    return width <= size.width && height <= size.height ? [{ width, height, area: width * height }] : [];
  }).sort((first, second) => first.area - second.area);
  const chosen = candidates[0];
  if (!chosen) throw new Error('La zona richiesta è troppo estesa per una pulizia locale sicura. Indica un mobile alla volta.');
  const centerX = (left + right) / 2; const centerY = (top + bottom) / 2;
  let pixelLeft = Math.round(centerX - chosen.width / 2);
  let pixelTop = Math.round(centerY - chosen.height / 2);
  pixelLeft = Math.min(size.width - chosen.width, Math.max(0, pixelLeft));
  pixelTop = Math.min(size.height - chosen.height, Math.max(0, pixelTop));
  return {
    left: pixelLeft,
    top: pixelTop,
    right: pixelLeft + chosen.width,
    bottom: pixelTop + chosen.height,
    width: chosen.width,
    height: chosen.height,
  };
}

/**
 * A furnished room needs one coherent reconstruction.  The image service may
 * see the complete photograph, while the client still composites only the
 * authorized object polygons and restores protected architecture afterwards.
 * Small edits keep using tighter crops because they benefit from more local
 * detail.
 */
export function planRoomCleanupPass(
  regions: CleanupTileRegion[],
  maximumTiles = 12,
  imageSize?: CleanupTileImageSize,
): CleanupTilePlan[] {
  if (regions.length >= COHERENT_ROOM_PASS_MIN_REGIONS) {
    return [{
      bounds: { left: 0, top: 0, right: 1, bottom: 1 },
      regions,
      normalizedRegions: regions.map((region) => ({
        ...region,
        points: region.points.map((point) => ({ x: clamp(point.x), y: clamp(point.y) })),
      })),
    }];
  }
  return planCleanupTiles(regions, maximumTiles, imageSize);
}

export function cleanupTileMaskEnvelope(
  regions: CleanupTileRegion[],
  size: CleanupTileImageSize,
): CleanupTileMaskEnvelope {
  const bounds = regionBounds(regions);
  const shortSide = Math.min(size.width, size.height);
  const targetWidth = (bounds.right - bounds.left) * size.width;
  const targetHeight = (bounds.bottom - bounds.top) * size.height;
  const outsetSourcePx = Math.min(
    shortSide * .025,
    Math.max(shortSide * .006, Math.min(targetWidth, targetHeight) * .10),
  );
  return { outsetSourcePx, shadowOffsetSourcePx: outsetSourcePx * .9 };
}

export function cleanupTileEdgeIsInternal(
  region: CleanupTileRegion,
  first: Point,
  second: Point,
) {
  return (region.internalEdges ?? []).some((edge) => (
    Math.abs(first[edge.axis] - edge.value) <= .00001
    && Math.abs(second[edge.axis] - edge.value) <= .00001
  ));
}

export function cleanupTileRatioMatches(width: number, height: number, expectedWidth: number, expectedHeight: number) {
  if (width <= 0 || height <= 0 || expectedWidth <= 0 || expectedHeight <= 0) return false;
  return Math.abs(Math.log((width / height) / (expectedWidth / expectedHeight))) <= .006;
}

/**
 * Splits furniture into a few left-to-right crops. A local crop gives an image
 * editor enough wall/floor context without letting it recompose the full room.
 */
export function planCleanupTiles(
  regions: CleanupTileRegion[],
  maximumTiles = 3,
  imageSize?: CleanupTileImageSize,
): CleanupTilePlan[] {
  if (!regions.length) return [];
  const safeBounds = (bounds: CleanupTileBounds) => {
    if (!imageSize) return true;
    try {
      const rect = snapCleanupTileRect(bounds, imageSize);
      return rect.width * rect.height / (imageSize.width * imageSize.height) <= CLEANUP_MAX_TILE_AREA_RATIO;
    } catch {
      return false;
    }
  };
  const safeGroup = (group: CleanupTileRegion[]) => safeBounds(paddedBounds(group));
  const clipAt = (points: Point[], axis: 'x' | 'y', value: number, keepLower: boolean) => {
    const clipped: Point[] = [];
    const inside = (point: Point) => keepLower ? point[axis] <= value : point[axis] >= value;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const currentInside = inside(current);
      const nextInside = inside(next);
      if (currentInside) clipped.push(current);
      if (currentInside !== nextInside) {
        const delta = next[axis] - current[axis];
        if (Math.abs(delta) > .000001) {
          const progress = (value - current[axis]) / delta;
          clipped.push({
            x: axis === 'x' ? value : current.x + (next.x - current.x) * progress,
            y: axis === 'y' ? value : current.y + (next.y - current.y) * progress,
          });
        }
      }
    }
    return clipped.filter((point, index) => {
      const previous = clipped[(index + clipped.length - 1) % clipped.length];
      return !previous || Math.hypot(point.x - previous.x, point.y - previous.y) > .00001;
    });
  };
  const isConvex = (points: Point[]) => {
    let direction = 0;
    for (let index = 0; index < points.length; index += 1) {
      const first = points[index];
      const second = points[(index + 1) % points.length];
      const third = points[(index + 2) % points.length];
      const cross = (second.x - first.x) * (third.y - second.y)
        - (second.y - first.y) * (third.x - second.x);
      if (Math.abs(cross) <= .000001) continue;
      const nextDirection = Math.sign(cross);
      if (direction && direction !== nextDirection) return false;
      direction = nextDirection;
    }
    return direction !== 0;
  };
  const triangulate = (points: Point[]) => {
    if (points.length < 3) return [] as Point[][];
    const signedArea = points.reduce((total, point, index) => {
      const next = points[(index + 1) % points.length];
      return total + point.x * next.y - next.x * point.y;
    }, 0);
    const orientation = Math.sign(signedArea) || 1;
    const remaining = points.map((_, index) => index);
    const triangles: Point[][] = [];
    const insideTriangle = (point: Point, first: Point, second: Point, third: Point) => {
      const cross = (left: Point, right: Point, target: Point) => (
        (right.x - left.x) * (target.y - left.y) - (right.y - left.y) * (target.x - left.x)
      );
      const a = cross(first, second, point) * orientation;
      const b = cross(second, third, point) * orientation;
      const c = cross(third, first, point) * orientation;
      return a >= -.000001 && b >= -.000001 && c >= -.000001;
    };
    let guard = points.length * points.length;
    while (remaining.length > 3 && guard-- > 0) {
      let clipped = false;
      for (let cursor = 0; cursor < remaining.length; cursor += 1) {
        const previousIndex = remaining[(cursor + remaining.length - 1) % remaining.length];
        const currentIndex = remaining[cursor];
        const nextIndex = remaining[(cursor + 1) % remaining.length];
        const previous = points[previousIndex];
        const current = points[currentIndex];
        const next = points[nextIndex];
        const corner = ((current.x - previous.x) * (next.y - current.y)
          - (current.y - previous.y) * (next.x - current.x)) * orientation;
        if (corner <= .000001) continue;
        const containsVertex = remaining.some((candidateIndex) => (
          candidateIndex !== previousIndex && candidateIndex !== currentIndex && candidateIndex !== nextIndex
          && insideTriangle(points[candidateIndex], previous, current, next)
        ));
        if (containsVertex) continue;
        triangles.push([previous, current, next]);
        remaining.splice(cursor, 1);
        clipped = true;
        break;
      }
      if (!clipped) return [] as Point[][];
    }
    if (remaining.length === 3) triangles.push(remaining.map((index) => points[index]));
    return triangles;
  };
  const splitUnsafeRegion = (region: CleanupTileRegion, depth = 0): CleanupTileRegion[] => {
    if (!imageSize || safeGroup([region])) return [region];
    if (depth >= 3) {
      throw new Error('La zona richiesta è troppo estesa per una pulizia locale sicura. Indica una parte più piccola del mobile.');
    }
    if (!isConvex(region.points)) {
      const triangles = triangulate(region.points);
      if (!triangles.length) {
        throw new Error('La zona richiesta è troppo estesa per una pulizia locale sicura. Indica una parte più piccola del mobile.');
      }
      return triangles.flatMap((points, index) => splitUnsafeRegion({
        ...region,
        label: `${region.label} · parte ${index + 1}`,
        points,
      }, depth + 1));
    }
    const bounds = regionBounds([region]);
    const axis: 'x' | 'y' = bounds.right - bounds.left >= bounds.bottom - bounds.top ? 'x' : 'y';
    const cut = axis === 'x' ? (bounds.left + bounds.right) / 2 : (bounds.top + bounds.bottom) / 2;
    const halves = [clipAt(region.points, axis, cut, true), clipAt(region.points, axis, cut, false)]
      .filter((points) => points.length >= 3);
    if (halves.length !== 2) {
      throw new Error('La zona richiesta è troppo estesa per una pulizia locale sicura. Indica una parte più piccola del mobile.');
    }
    return halves.flatMap((points, index) => splitUnsafeRegion({
      ...region,
      label: `${region.label} · parte ${index + 1}`,
      points,
      internalEdges: [...(region.internalEdges ?? []), { axis, value: cut }],
    }, depth + 1));
  };
  const sorted = regions.flatMap((region) => splitUnsafeRegion(region)).sort((first, second) => {
    const firstX = first.points.reduce((sum, point) => sum + point.x, 0) / first.points.length;
    const secondX = second.points.reduce((sum, point) => sum + point.x, 0) / second.points.length;
    return firstX - secondX;
  });
  // First join nearby/overlapping detections. This keeps the base cabinets,
  // wall cabinets and appliances of the same kitchen in one coherent edit.
  const groups: CleanupTileRegion[][] = [];
  for (const region of sorted) {
    const bounds = regionBounds([region]);
    const matching = groups.find((group) => {
      const other = regionBounds(group);
      const horizontalGap = Math.max(0, Math.max(bounds.left, other.left) - Math.min(bounds.right, other.right));
      const verticalGap = Math.max(0, Math.max(bounds.top, other.top) - Math.min(bounds.bottom, other.bottom));
      return horizontalGap <= .07 && verticalGap <= .14 && safeGroup([...group, region]);
    });
    if (matching) matching.push(region); else groups.push([region]);
  }
  const center = (group: CleanupTileRegion[]) => {
    const bounds = regionBounds(group);
    return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
  };
  // If the room has many independent objects, merge only the closest groups
  // until the maximum request count is reached.
  while (groups.length > Math.max(1, maximumTiles)) {
    let closest: [number, number] = [0, 1];
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let first = 0; first < groups.length; first += 1) {
      for (let second = first + 1; second < groups.length; second += 1) {
        if (!safeGroup([...groups[first], ...groups[second]])) continue;
        const a = center(groups[first]); const b = center(groups[second]);
        const distance = Math.hypot(a.x - b.x, (a.y - b.y) * .7);
        if (distance < closestDistance) { closestDistance = distance; closest = [first, second]; }
      }
    }
    if (!Number.isFinite(closestDistance)) {
      throw new Error('Le zone sono troppo distanti per una pulizia automatica sicura. Usa “Pulisci un residuo” su un mobile alla volta.');
    }
    groups[closest[0]].push(...groups[closest[1]]);
    groups.splice(closest[1], 1);
  }
  return groups.filter((group) => group.length).map((group) => {
    const bounds = paddedBounds(group);
    if (!safeBounds(bounds)) {
      throw new Error('La zona richiesta è troppo estesa per una pulizia locale sicura. Usa “Pulisci un residuo” su un mobile alla volta.');
    }
    return {
      bounds,
      regions: group,
      normalizedRegions: group.map((region) => ({
        ...region,
        points: region.points.map((point) => pointInCleanupTile(point, bounds)),
      })),
    };
  });
}
