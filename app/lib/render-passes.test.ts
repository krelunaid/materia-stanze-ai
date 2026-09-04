import { expect, it } from 'vitest';
import { planRenderPasses } from './render-passes';
import type { Surface } from '../domain/editor';
import type { StudioMaterial, PlacedFurniture } from '../components/room-studio';

it('uses a separate matching reference for each product and omits frozen material areas', () => {
  const materials: StudioMaterial[] = ['oak', 'stone'].map((id) => ({ id, name: id, description: '', category: 'Pavimenti', textureUrl: `blob:${id}` }));
  const surfaces = ['oak', 'stone', 'oak', 'stone'].map((materialId, index) => ({ id: String(index), kind: 'wall', points: [], name: String(index), materialId, frozen: index === 3 })) as Surface[];
  const furniture = ['chair', 'table'].map((id) => ({ id, name: id, previewUrl: `blob:${id}` })) as PlacedFurniture[];
  const passes = planRenderPasses(surfaces, furniture, new Map(materials.map((item) => [item.id, item])));
  expect(passes).toHaveLength(4);
  expect(passes[0].material?.textureUrl).toBe('blob:oak');
  expect(passes[0].surfaces.map((item) => item.id)).toEqual(['0', '2']);
  expect(passes[1].material?.textureUrl).toBe('blob:stone');
  expect(passes[1].surfaces.map((item) => item.id)).toEqual(['1']);
  expect(passes[2].furniture).toEqual([furniture[0]]);
  expect(passes[3].furniture).toEqual([furniture[1]]);
});
