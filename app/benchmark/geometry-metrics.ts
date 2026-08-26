import type { Point, SurfaceKind } from '../domain/editor';

export type BenchmarkSurface = {
  id: string;
  kind: SurfaceKind;
  points: Point[];
};

export type GeometryMetrics = {
  segmentationIoU: number | null;
  edgeErrorPx: number | null;
  doorWidthDeltaPx: number | null;
  doorHeightDeltaPx: number | null;
  windowWidthDeltaPx: number | null;
  windowHeightDeltaPx: number | null;
};

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const intersects = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y))
        / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonIoU(expected: Point[], actual: Point[], resolution = 256) {
  let intersection = 0;
  let union = 0;
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const point = { x: (x + .5) / resolution, y: (y + .5) / resolution };
      const inExpected = pointInPolygon(point, expected);
      const inActual = pointInPolygon(point, actual);
      if (inExpected || inActual) union += 1;
      if (inExpected && inActual) intersection += 1;
    }
  }
  return union ? intersection / union : 0;
}

function distanceToSegment(point: Point, start: Point, end: Point, width: number, height: number) {
  const px = point.x * width;
  const py = point.y * height;
  const sx = start.x * width;
  const sy = start.y * height;
  const ex = end.x * width;
  const ey = end.y * height;
  const dx = ex - sx;
  const dy = ey - sy;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lengthSquared));
  return Math.hypot(px - (sx + ratio * dx), py - (sy + ratio * dy));
}

function sampleBoundary(points: Point[], samplesPerEdge = 12) {
  return points.flatMap((start, index) => {
    const end = points[(index + 1) % points.length];
    return Array.from({ length: samplesPerEdge }, (_, sample) => {
      const ratio = sample / samplesPerEdge;
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    });
  });
}

function directedEdgeError(from: Point[], to: Point[], width: number, height: number) {
  const samples = sampleBoundary(from);
  const distances = samples.map((point) => Math.min(...to.map((start, index) => (
    distanceToSegment(point, start, to[(index + 1) % to.length], width, height)
  ))));
  return distances.reduce((sum, value) => sum + value, 0) / distances.length;
}

function edgeError(expected: Point[], actual: Point[], width: number, height: number) {
  return (directedEdgeError(expected, actual, width, height) + directedEdgeError(actual, expected, width, height)) / 2;
}

function bounds(points: Point[], width: number, height: number) {
  const xs = points.map((point) => point.x * width);
  const ys = points.map((point) => point.y * height);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value: number | null) {
  return value === null ? null : Number(value.toFixed(4));
}

export function evaluateGeometry(expected: BenchmarkSurface[], actual: BenchmarkSurface[], width: number, height: number): GeometryMetrics {
  const pairs = expected.map((expectedSurface) => {
    const actualSurface = actual.find((surface) => surface.id === expectedSurface.id);
    return actualSurface ? { expected: expectedSurface, actual: actualSurface } : null;
  }).filter((pair): pair is { expected: BenchmarkSurface; actual: BenchmarkSurface } => Boolean(pair));

  const openingDeltas = (kind: 'door' | 'window', dimension: 'width' | 'height') => pairs
    .filter((pair) => pair.expected.kind === kind && pair.actual.kind === kind)
    .map((pair) => Math.abs(bounds(pair.actual.points, width, height)[dimension] - bounds(pair.expected.points, width, height)[dimension]));

  return {
    segmentationIoU: round(average(pairs.map((pair) => polygonIoU(pair.expected.points, pair.actual.points)))),
    edgeErrorPx: round(average(pairs.map((pair) => edgeError(pair.expected.points, pair.actual.points, width, height)))),
    doorWidthDeltaPx: round(average(openingDeltas('door', 'width'))),
    doorHeightDeltaPx: round(average(openingDeltas('door', 'height'))),
    windowWidthDeltaPx: round(average(openingDeltas('window', 'width'))),
    windowHeightDeltaPx: round(average(openingDeltas('window', 'height'))),
  };
}
