import { isValidPolygon, Point, SurfaceKind } from '../domain/editor';

export type GeometrySlot = 'left' | 'center' | 'right' | 'extra';

export type GeometryCandidate = {
  id?: string;
  name: string;
  kind: SurfaceKind;
  points: Point[];
  confidence: number;
  slot?: GeometrySlot;
  parentId?: string;
};

export type GeometryRejection = {
  kind: SurfaceKind;
  reason: 'invalid-polygon' | 'low-confidence' | 'invalid-area' | 'duplicate-floor' | 'template-leak' | 'opening-without-wall' | 'slot-mismatch' | 'opening-floor-mismatch' | 'opening-group-dropped';
};

export type GeometryValidationOptions = {
  source?: 'user' | 'demo';
  expectedSlots?: Partial<Record<'door' | 'window', GeometrySlot>> & Record<string, GeometrySlot | undefined>;
};

function polygonArea(points: Point[]) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

function bounds(points: Point[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

function center(points: Point[]) {
  const box = bounds(points);
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current]; const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function signedArea(points: Point[]) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentIntersection(a: Point, b: Point, c: Point, d: Point) {
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) < 1e-9) return b;
  const determinant1 = a.x * b.y - a.y * b.x;
  const determinant2 = c.x * d.y - c.y * d.x;
  return {
    x: (determinant1 * (c.x - d.x) - (a.x - b.x) * determinant2) / denominator,
    y: (determinant1 * (c.y - d.y) - (a.y - b.y) * determinant2) / denominator,
  };
}

function convexIntersection(subject: Point[], clip: Point[]) {
  let output = [...subject];
  const orientation = signedArea(clip) >= 0 ? 1 : -1;
  clip.forEach((clipStart, index) => {
    const clipEnd = clip[(index + 1) % clip.length];
    const input = output;
    output = [];
    input.forEach((current, subjectIndex) => {
      const previous = input[(subjectIndex + input.length - 1) % input.length];
      const currentInside = orientation * cross(clipStart, clipEnd, current) >= -1e-7;
      const previousInside = orientation * cross(clipStart, clipEnd, previous) >= -1e-7;
      if (currentInside) {
        if (!previousInside) output.push(segmentIntersection(previous, current, clipStart, clipEnd));
        output.push(current);
      } else if (previousInside) output.push(segmentIntersection(previous, current, clipStart, clipEnd));
    });
  });
  return output;
}

export function openingCoverageInWall(opening: Point[], wall: Point[]) {
  return polygonArea(convexIntersection(opening, wall)) / Math.max(polygonArea(opening), Number.EPSILON);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const abC = cross(a, b, c); const abD = cross(a, b, d);
  const cdA = cross(c, d, a); const cdB = cross(c, d, b);
  return abC * abD < -1e-9 && cdA * cdB < -1e-9;
}

function isSimplePolygon(points: Point[]) {
  return points.every((point, index) => {
    const next = points[(index + 1) % points.length];
    if (Math.hypot(next.x - point.x, next.y - point.y) < .008) return false;
    return points.every((other, otherIndex) => {
      if (otherIndex === index || otherIndex === (index + 1) % points.length || (otherIndex + 1) % points.length === index) return true;
      return !segmentsCross(point, next, other, points[(otherIndex + 1) % points.length]);
    });
  });
}

function inferredSlot(points: Point[]): GeometrySlot {
  const x = center(points).x;
  return x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center';
}

function floorBoundaryAtX(floor: GeometryCandidate | undefined, x: number) {
  if (!floor) return null;
  const intersections: number[] = [];
  floor.points.forEach((point, index) => {
    const next = floor.points[(index + 1) % floor.points.length];
    if (x < Math.min(point.x, next.x) - .0001 || x > Math.max(point.x, next.x) + .0001) return;
    if (Math.abs(next.x - point.x) < .0001) intersections.push(Math.min(point.y, next.y));
    else {
      const ratio = (x - point.x) / (next.x - point.x);
      if (ratio >= 0 && ratio <= 1) intersections.push(point.y + (next.y - point.y) * ratio);
    }
  });
  return intersections.length ? Math.min(...intersections) : null;
}

function bboxIou(left: ReturnType<typeof bounds>, right: ReturnType<typeof bounds>) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  const intersection = width * height;
  const leftArea = (left.right - left.left) * (left.bottom - left.top);
  const rightArea = (right.right - right.left) * (right.bottom - right.top);
  return intersection / Math.max(leftArea + rightArea - intersection, Number.EPSILON);
}

function isDemoWindowTemplate(candidate: GeometryCandidate) {
  if (candidate.kind !== 'window' || candidate.points.length !== 4) return false;
  const box = bounds(candidate.points);
  const demo = { left: .334, right: .667, top: .18, bottom: .552 };
  return bboxIou(box, demo) >= .45;
}

function hasDemoRoomLayout(candidates: GeometryCandidate[]) {
  const demoFrontWall = { left: .218, right: .785, top: .13, bottom: .695 };
  const demoFloor = { left: 0, right: 1, top: .695, bottom: 1 };
  return candidates.some((candidate) => candidate.kind === 'wall' && bboxIou(bounds(candidate.points), demoFrontWall) >= .45)
    && candidates.some((candidate) => candidate.kind === 'floor' && bboxIou(bounds(candidate.points), demoFloor) >= .45);
}

function minimumArea(kind: SurfaceKind) {
  if (kind === 'floor') return .06;
  if (kind === 'wall') return .02;
  if (kind === 'ceiling') return .01;
  if (kind === 'door' || kind === 'window') return .004;
  return .001;
}

export function validateRoomGeometry<T extends GeometryCandidate>(candidates: T[], options: GeometryValidationOptions = {}) {
  const rejected: GeometryRejection[] = [];
  const accepted: T[] = [];
  const valid = candidates.filter((candidate) => {
    if (!isValidPolygon(candidate.points) || !isSimplePolygon(candidate.points)) { rejected.push({ kind: candidate.kind, reason: 'invalid-polygon' }); return false; }
    const minimumConfidence = candidate.kind === 'door' || candidate.kind === 'window' ? .5 : .45;
    if (candidate.confidence < minimumConfidence) { rejected.push({ kind: candidate.kind, reason: 'low-confidence' }); return false; }
    const area = polygonArea(candidate.points);
    const maximum = candidate.kind === 'door' || candidate.kind === 'window' ? .25 : 1;
    if (area < minimumArea(candidate.kind) || area > maximum) { rejected.push({ kind: candidate.kind, reason: 'invalid-area' }); return false; }
    return true;
  });

  const floors = valid.filter((candidate) => candidate.kind === 'floor')
    .sort((left, right) => right.confidence - left.confidence);
  const floor = floors[0];
  floors.slice(1).forEach((candidate) => rejected.push({ kind: candidate.kind, reason: 'duplicate-floor' }));
  const walls = valid.filter((candidate) => candidate.kind === 'wall');
  const resemblesDemoLayout = hasDemoRoomLayout(valid);
  let wallIndex = 0;
  let droppedOpenings = false;
  const usedOpeningIds = new Set<string>();
  for (const candidate of valid) {
    if (candidate.kind === 'floor' && candidate !== floor) continue;
    if (candidate.kind !== 'door' && candidate.kind !== 'window') {
      const slot = candidate.kind === 'wall' ? inferredSlot(candidate.points) : candidate.slot;
      const id = candidate.id && !candidate.id.startsWith('demo-')
        ? candidate.id
        : candidate.kind === 'wall' ? `wall:${slot}:${wallIndex++}` : candidate.kind;
      accepted.push({ ...candidate, id, slot } as T);
      continue;
    }
    if (options.source !== 'demo' && resemblesDemoLayout && isDemoWindowTemplate(candidate)) { rejected.push({ kind: candidate.kind, reason: 'template-leak' }); droppedOpenings = true; continue; }
    const slot = inferredSlot(candidate.points);
    const expectedSlot = options.expectedSlots?.[candidate.id ?? ''] ?? options.expectedSlots?.[candidate.kind];
    if (expectedSlot && expectedSlot !== 'extra' && expectedSlot !== slot) {
      rejected.push({ kind: candidate.kind, reason: 'slot-mismatch' }); continue;
    }
    const openingCenter = center(candidate.points);
    const parents = walls.map((wall) => ({
      wall,
      overlap: openingCoverageInWall(candidate.points, wall.points),
    })).sort((left, right) => right.overlap - left.overlap || right.wall.confidence - left.wall.confidence);
    const parent = parents[0]?.overlap >= .82 && pointInPolygon(openingCenter, parents[0].wall.points) ? parents[0].wall : undefined;
    if (!parent) { rejected.push({ kind: candidate.kind, reason: 'opening-without-wall' }); continue; }
    const floorY = floorBoundaryAtX(floor, openingCenter.x);
    const box = bounds(candidate.points);
    if ((candidate.kind === 'window' && floorY !== null && box.bottom > floorY - .025)
      || (candidate.kind === 'door' && floorY !== null && Math.abs(box.bottom - floorY) > .12)) {
      rejected.push({ kind: candidate.kind, reason: 'opening-floor-mismatch' }); continue;
    }
    const parentSlot = inferredSlot(parent.points);
    const parentId = parent.id && !parent.id.startsWith('demo-') ? parent.id : `wall:${parentSlot}:${walls.indexOf(parent)}`;
    const baseId = candidate.id && !candidate.id.startsWith('demo-') ? candidate.id : `${candidate.kind}:${slot}`;
    let id = baseId;
    let duplicate = 2;
    while (usedOpeningIds.has(id)) id = `${baseId}:${duplicate++}`;
    usedOpeningIds.add(id);
    accepted.push({ ...candidate, id, slot, parentId } as T);
  }
  if (droppedOpenings) {
    accepted.filter((candidate) => candidate.kind === 'door' || candidate.kind === 'window')
      .forEach((candidate) => rejected.push({ kind: candidate.kind, reason: 'opening-group-dropped' }));
  }
  return {
    surfaces: droppedOpenings ? accepted.filter((candidate) => candidate.kind !== 'door' && candidate.kind !== 'window') : accepted,
    rejected,
    droppedOpenings,
  };
}
