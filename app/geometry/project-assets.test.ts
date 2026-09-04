import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveProjectAssets, restoreProjectAssets } from './project-assets';

afterEach(() => vi.restoreAllMocks());
describe('project image references', () => {
  it('archives distinct images without overwriting concurrent entries and reuses duplicate URLs', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(new Blob([String(url)], { type: 'image/png' })));
    const snapshot = { materials: [{ previewUrl: 'blob:a', textureUrl: 'blob:a' }, { textureUrl: 'blob:b' }], furniture: [{ preparedViews: { front: 'blob:c' } }] };
    const archived = await archiveProjectAssets(snapshot);
    expect(Object.keys(archived.assets)).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(archived.value.materials[0].previewUrl).toBe(archived.value.materials[0].textureUrl);
    expect(archived.value.materials[1].textureUrl).not.toBe(archived.value.materials[0].textureUrl);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:restored-${Math.random()}`);
    const restored = restoreProjectAssets(archived.value, archived.assets);
    expect(restored.urls).toHaveLength(3);
    expect(restored.value.furniture[0].preparedViews.front).toMatch(/^blob:restored/);
  });

  it('fails instead of saving a broken photo reference', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(archiveProjectAssets({ image: 'blob:expired' })).rejects.toThrow('non è più disponibile');
  });
});
