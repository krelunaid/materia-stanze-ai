import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { Surface } from '../domain/editor';
import { buildStoredProject, listProjects, loadProject, saveProject } from './project-store';

const floor: Surface = {
  id: 'floor',
  name: 'Pavimento',
  kind: 'floor',
  frozen: false,
  points: [{ x: 0, y: .7 }, { x: 1, y: .7 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
};

describe('project store', () => {
  it('saves approved geometry without rewriting it', async () => {
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
      approved: true,
    });
    await saveProject(project);
    const loaded = await loadProject('room-1');
    expect(loaded?.geometry.status).toBe('approved');
    expect(loaded?.geometry.surfaces[0].points).toEqual(floor.points);
    const listed = await listProjects();
    expect(listed[0]).toMatchObject({ id: 'room-1', title: 'Soggiorno' });
  });

  it('never silently reports success without durable storage', async () => {
    vi.stubGlobal('indexedDB', undefined);
    try { await expect(saveProject({} as Parameters<typeof saveProject>[0])).rejects.toThrow('non è disponibile'); }
    finally { vi.unstubAllGlobals(); }
  });

  it('does not mark a draft geometry as approved merely because it was saved', () => {
    const project = buildStoredProject({ id: 'draft', title: 'Draft', sourceType: 'photo', fileName: 'photo.jpg', mime: 'image/jpeg', original: new Blob(), processed: null, processedLabel: '', surfaces: [floor], originalSurfaces: [floor], processedSurfaces: null });
    expect(project.geometry.status).toBe('proposed');
    expect(project.geometry.approvedAt).toBeNull();
  });
});
