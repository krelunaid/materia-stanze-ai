export type SurfaceKind = 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'other';

export type Point = { x: number; y: number };

export type Surface = {
  id: string;
  name: string;
  kind: SurfaceKind;
  points: Point[];
  frozen: boolean;
  materialId?: string;
};

export const surfaceLabels: Record<SurfaceKind, string> = {
  wall: 'Muro',
  floor: 'Pavimento',
  ceiling: 'Soffitto',
  door: 'Porta',
  window: 'Finestra',
  other: 'Superficie',
};

export function clampPoint(point: Point): Point {
  return {
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(1, Math.max(0, point.y)),
  };
}

export function isValidPolygon(points: Point[]) {
  if (points.length < 3) return false;
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
  return Math.abs(area) > 0.0005;
}

export function nextSurfaceName(kind: SurfaceKind, surfaces: Surface[]) {
  const base = surfaceLabels[kind];
  const siblings = surfaces.filter((surface) => surface.kind === kind);
  if (kind === 'wall' || kind === 'door' || kind === 'window' || kind === 'other') {
    const highestNumber = siblings.reduce((highest, surface) => {
      const match = surface.name.match(new RegExp(`^${base}\\s+(\\d+)$`, 'i'));
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    return `${base} ${highestNumber + 1}`;
  }
  return siblings.length === 0 ? base : `${base} ${siblings.length + 1}`;
}

export function moveVertex(surface: Surface, vertexIndex: number, point: Point): Surface {
  if (surface.frozen || !surface.points[vertexIndex]) return surface;
  return {
    ...surface,
    points: surface.points.map((current, index) => index === vertexIndex ? clampPoint(point) : current),
  };
}

export function pointsToSvg(points: Point[]) {
  return points.map((point) => `${point.x * 1000},${point.y * 625}`).join(' ');
}
