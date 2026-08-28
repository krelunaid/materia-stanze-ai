import { describe, expect, it } from 'vitest';
import type { Surface } from '../domain/editor';
import { buildStoredProject, listProjects, loadProject, resetMemoryProjectStore, saveProject } from './project-store';

const floor: Surface = {
  id: 'floor',
  name: 'Pavimento',
  kind: 'floor',
  frozen: false,
  points: [{ x: 0, y: .7 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
};

describe('project store', () => {
  it('saves approved geometry without rewriting it', async () => {
    resetMemoryProjectStore();
    const project = buildStoredProject({
      id: 'room-1',
      title: 'Soggiorno',
      sourceType: 'photo',
      fileName: 'soggiorno.jpg',
      mime: 'image/jpeg',
      original: new Blob(['room'], { type: 'image/jpeg' }),
      processed: null,
      processedLabel: 'Stanza vuota',
      surfaces: [floor],
      originalSurfaces: [floor],
      processedSurfaces: null,
      source: 'manual',
    });
    await saveProject(project);
    const loaded = await loadProject('room-1');
    expect(loaded?.geometry.status).toBe('approved');
    expect(loaded?.geometry.surfaces[0].points).toEqual(floor.points);
    const listed = await listProjects();
    expect(listed[0]).toMatchObject({ id: 'room-1', title: 'Soggiorno' });
  });
});
