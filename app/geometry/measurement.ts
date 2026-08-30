import { Point, Surface } from '../domain/editor';

export type MeasurementSource = 'manual' | 'door' | 'window' | 'perspective';

export type RoomMeasurement = {
  widthMeters: number;
  depthMeters: number;
  heightMeters: number;
  confidence: number;
  source: MeasurementSource;
  referenceLabel: string;
};

type Bounds = { left: number; right: number; top: number; bottom: number; width: number; height: number };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function bounds(points: Point[]): Bounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

export function horizontalSpanAtY(surface: Surface | undefined, y: number) {
  if (!surface || surface.points.length < 3) return 0;
  const intersections: number[] = [];
  surface.points.forEach((point, index) => {
    const next = surface.points[(index + 1) % surface.points.length];
    if (Math.abs(point.y - next.y) < 1e-6) {
      if (Math.abs(y - point.y) < .004) intersections.push(point.x, next.x);
      return;
    }
    const minimum = Math.min(point.y, next.y);
    const maximum = Math.max(point.y, next.y);
    if (y < minimum || y > maximum) return;
    const progress = (y - point.y) / (next.y - point.y);
    intersections.push(point.x + (next.x - point.x) * progress);
  });
  if (intersections.length < 2) return 0;
  return clamp(Math.max(...intersections) - Math.min(...intersections), 0, 1);
}

function largestSurface(surfaces: Surface[], kind: Surface['kind']) {
  return surfaces.filter((surface) => surface.kind === kind).sort((left, right) => {
    const leftBounds = bounds(left.points);
    const rightBounds = bounds(right.points);
    return rightBounds.width * rightBounds.height - leftBounds.width * leftBounds.height;
  })[0];
}

function openingReference(surfaces: Surface[], wall: Surface | undefined) {
  const candidates = surfaces.filter((surface) => surface.kind === 'door' || surface.kind === 'window').sort((left, right) => {
    const leftParent = left.parentId === wall?.id ? 1 : 0;
    const rightParent = right.parentId === wall?.id ? 1 : 0;
    if (leftParent !== rightParent) return rightParent - leftParent;
    return bounds(right.points).height - bounds(left.points).height;
  });
  const opening = candidates[0];
  if (!opening) return null;
  const openingBounds = bounds(opening.points);
  if (openingBounds.height < .12) return null;
  return opening.kind === 'door'
    ? { surface: opening, heightMeters: 2.1, confidence: .78, source: 'door' as const, label: 'porta standard da 2,10 m' }
    : { surface: opening, heightMeters: 1.2, confidence: .64, source: 'window' as const, label: 'finestra standard da 1,20 m' };
}

export function inferRoomMeasurement(surfaces: Surface[], imageRatio: number, manualWidthMeters?: number | null): RoomMeasurement {
  const wall = largestSurface(surfaces, 'wall');
  const floor = largestSurface(surfaces, 'floor');
  const wallBounds = wall ? bounds(wall.points) : { left: .2, right: .8, top: .12, bottom: .68, width: .6, height: .56 };
  const safeRatio = clamp(Number.isFinite(imageRatio) ? imageRatio : 1.6, .5, 2.5);
  const reference = openingReference(surfaces, wall);

  let heightMeters = 2.7;
  let widthMeters = clamp((wallBounds.width * safeRatio / Math.max(.2, wallBounds.height)) * heightMeters, 2.4, 9);
  let source: MeasurementSource = 'perspective';
  let confidence = wall ? .5 : .32;
  let referenceLabel = 'prospettiva della parete e altezza media 2,70 m';

  if (reference) {
    const openingHeight = bounds(reference.surface.points).height;
    const metersPerImageHeight = reference.heightMeters / openingHeight;
    heightMeters = clamp(wallBounds.height * metersPerImageHeight, 2.2, 4.5);
    widthMeters = clamp(wallBounds.width * safeRatio * metersPerImageHeight, 2.4, 12);
    source = reference.source;
    confidence = reference.confidence;
    referenceLabel = reference.label;
  }

  const floorBounds = floor ? bounds(floor.points) : null;
  const backY = floorBounds ? floorBounds.top + .01 : .68;
  const nearY = floorBounds ? floorBounds.bottom - .01 : .98;
  const backSpan = Math.max(.18, horizontalSpanAtY(floor, backY));
  const nearSpan = Math.max(backSpan, horizontalSpanAtY(floor, nearY));
  const perspectiveStrength = clamp(nearSpan / backSpan, 1, 4);
  let depthMeters = clamp(widthMeters * (.58 + perspectiveStrength * .16), 2.4, 12);

  if (manualWidthMeters && Number.isFinite(manualWidthMeters)) {
    const previousWidth = widthMeters;
    widthMeters = clamp(manualWidthMeters, 1.5, 20);
    depthMeters = clamp(depthMeters * (widthMeters / Math.max(1.5, previousWidth)), 2, 20);
    source = 'manual';
    confidence = .98;
    referenceLabel = 'larghezza confermata da te';
  }

  return {
    widthMeters: rounded(widthMeters),
    depthMeters: rounded(depthMeters),
    heightMeters: rounded(heightMeters),
    confidence,
    source,
    referenceLabel,
  };
}

function dimensionToMeters(value: string, unit: string | undefined) {
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (unit?.toLocaleLowerCase('it') === 'mm') return parsed / 1000;
  if (unit?.toLocaleLowerCase('it') === 'm') return parsed;
  return parsed / 100;
}

export function productWidthMeters(name: string, description?: string) {
  const text = `${name} ${description ?? ''}`;
  const labelled = text.match(/(?:larghezza|width|\bL)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/i);
  if (labelled) return dimensionToMeters(labelled[1], labelled[2]);
  const dimensions = text.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(mm|cm|m)\b/i);
  if (dimensions) return dimensionToMeters(dimensions[1], dimensions[2]);
  return null;
}

export function measuredFurnitureScale(options: {
  name: string;
  description?: string;
  y: number;
  floor?: Surface;
  room: RoomMeasurement;
  fallback: number;
}) {
  const widthMeters = productWidthMeters(options.name, options.description);
  if (!widthMeters || !options.floor || options.room.widthMeters <= 0) return options.fallback;
  const span = horizontalSpanAtY(options.floor, options.y);
  if (span < .1) return options.fallback;
  return rounded(clamp((widthMeters / options.room.widthMeters) * span * 100, 10, 72));
}
