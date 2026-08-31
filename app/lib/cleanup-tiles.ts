import { Point } from '../domain/editor';

export type CleanupTileRegion = {
  label: string;
  points: Point[];
  confidence: number;
};

export type CleanupTileBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type CleanupTilePlan = {
  bounds: CleanupTileBounds;
  regions: CleanupTileRegion[];
  normalizedRegions: CleanupTileRegion[];
};

const supportedRatios = [
  { width: 1, height: 1 }, { width: 16, height: 9 }, { width: 9, height: 16 },
  { width: 4, height: 3 }, { width: 3, height: 4 }, { width: 3, height: 2 },
  { width: 2, height: 3 }, { width: 2, height: 1 }, { width: 1, height: 2 },
];

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
  const left = Math.floor(bounds.left * imageWidth);
  const top = Math.floor(bounds.top * imageHeight);
  const right = Math.ceil(bounds.right * imageWidth);
  const bottom = Math.ceil(bounds.bottom * imageHeight);
  const requiredWidth = Math.max(1, right - left);
  const requiredHeight = Math.max(1, bottom - top);
  const candidates = supportedRatios.flatMap((ratio) => {
    const units = Math.ceil(Math.max(requiredWidth / ratio.width, requiredHeight / ratio.height));
    const width = units * ratio.width; const height = units * ratio.height;
    return width <= imageWidth && height <= imageHeight ? [{ width, height, area: width * height }] : [];
  }).sort((first, second) => first.area - second.area);
  const chosen = candidates[0];
  if (!chosen) return bounds;
  const centerX = (left + right) / 2; const centerY = (top + bottom) / 2;
  let pixelLeft = Math.round(centerX - chosen.width / 2);
  let pixelTop = Math.round(centerY - chosen.height / 2);
  pixelLeft = Math.min(imageWidth - chosen.width, Math.max(0, pixelLeft));
  pixelTop = Math.min(imageHeight - chosen.height, Math.max(0, pixelTop));
  return {
    left: pixelLeft / imageWidth,
    top: pixelTop / imageHeight,
    right: (pixelLeft + chosen.width) / imageWidth,
    bottom: (pixelTop + chosen.height) / imageHeight,
  };
}

export function cleanupTileRatioMatches(width: number, height: number, expectedWidth: number, expectedHeight: number) {
  if (width <= 0 || height <= 0 || expectedWidth <= 0 || expectedHeight <= 0) return false;
  return Math.abs(Math.log((width / height) / (expectedWidth / expectedHeight))) <= .015;
}

/**
 * Splits furniture into a few left-to-right crops. A local crop gives an image
 * editor enough wall/floor context without letting it recompose the full room.
 */
export function planCleanupTiles(regions: CleanupTileRegion[], maximumTiles = 3): CleanupTilePlan[] {
  if (!regions.length) return [];
  const sorted = [...regions].sort((first, second) => {
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
      return horizontalGap <= .07 && verticalGap <= .14;
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
        const a = center(groups[first]); const b = center(groups[second]);
        const distance = Math.hypot(a.x - b.x, (a.y - b.y) * .7);
        if (distance < closestDistance) { closestDistance = distance; closest = [first, second]; }
      }
    }
    groups[closest[0]].push(...groups[closest[1]]);
    groups.splice(closest[1], 1);
  }
  return groups.filter((group) => group.length).map((group) => {
    const bounds = paddedBounds(group);
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
