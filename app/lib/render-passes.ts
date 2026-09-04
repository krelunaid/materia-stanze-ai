import type { Surface } from '../domain/editor';
import type { PlacedFurniture, StudioMaterial } from '../components/room-studio';

export function planRenderPasses(surfaces: Surface[], furniture: PlacedFurniture[], materials: Map<string, StudioMaterial>) {
  const editable = surfaces.filter((surface) => surface.materialId && !surface.frozen);
  return [
    ...[...new Set(editable.map((surface) => surface.materialId!))].map((id) => ({
      material: materials.get(id), surfaces: editable.filter((surface) => surface.materialId === id), furniture: [] as PlacedFurniture[],
    })),
    ...furniture.map((item) => ({ material: undefined, surfaces: [] as Surface[], furniture: [item] })),
  ];
}
