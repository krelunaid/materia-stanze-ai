import type { Surface } from '../domain/editor';

export const ROOM_GEOMETRY_SCHEMA = 'RoomGeometryV1' as const;

export type RoomGeometrySource = 'ai' | 'manual' | 'guided' | 'demo';

export type RoomGeometryV1 = {
  schema: typeof ROOM_GEOMETRY_SCHEMA;
  revision: number;
  status: 'proposed' | 'approved';
  source: RoomGeometrySource;
  surfaces: Surface[];
  approvedAt: string | null;
};

export function cloneSurfaces(surfaces: Surface[]): Surface[] {
  return surfaces.map((surface) => ({
    ...surface,
    points: surface.points.map((point) => ({ x: point.x, y: point.y })),
  }));
}

export function approveGeometry(
  surfaces: Surface[],
  source: RoomGeometrySource,
  revision = 1,
): RoomGeometryV1 {
  return {
    schema: ROOM_GEOMETRY_SCHEMA,
    revision,
    status: 'approved',
    source,
    surfaces: cloneSurfaces(surfaces),
    approvedAt: new Date().toISOString(),
  };
}

/**
 * Empty-room and render consume approved contours.
 * They must never write a new detection over them.
 */
export function geometryForDerivedImage(approved: Surface[]): Surface[] {
  return cloneSurfaces(approved);
}

/**
 * Geometry edits belong to the room, not to one side of the before/after toggle.
 * Keep both snapshots current once an empty-room preview exists so a Pencil edit
 * made on either image cannot be replaced by an older snapshot.
 */
export function geometrySnapshotsAfterEdit(
  edited: Surface[],
  hasProcessedPreview: boolean,
): { original: Surface[]; processed: Surface[] | null } {
  return {
    original: cloneSurfaces(edited),
    processed: hasProcessedPreview ? cloneSurfaces(edited) : null,
  };
}

export function surfacesMatch(left: Surface[], right: Surface[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((surface, index) => {
    const other = right[index];
    return (
      surface.id === other.id
      && surface.kind === other.kind
      && surface.frozen === other.frozen
      && surface.points.length === other.points.length
      && surface.points.every(
        (point, pointIndex) =>
          point.x === other.points[pointIndex].x && point.y === other.points[pointIndex].y,
      )
    );
  });
}
