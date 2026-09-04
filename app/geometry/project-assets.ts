/** Replace session-only object URLs with blobs before putting a project in IndexedDB. */
export async function archiveProjectAssets<T>(value: T): Promise<{ value: T; assets: Record<string, Blob> }> {
  const assets: Record<string, Blob> = {};
  const seen = new Map<string, string>();
  let nextId = 0;
  async function visit(item: unknown): Promise<unknown> {
    if (typeof item === 'string' && item.startsWith('blob:')) {
      const existing = seen.get(item);
      if (existing) return existing;
      const key = `materia-asset:${nextId++}`;
      seen.set(item, key);
      const response = await fetch(item);
      if (!response.ok) throw new Error('Una foto prodotto non è più disponibile. Ricaricala prima di salvare.');
      assets[key] = await response.blob();
      return key;
    }
    if (item instanceof Blob) return item;
    if (Array.isArray(item)) return Promise.all(item.map(visit));
    if (item && typeof item === 'object') {
      return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([key, entry]) => [key, await visit(entry)])));
    }
    return item;
  }
  return { value: await visit(value) as T, assets };
}

export function restoreProjectAssets<T>(value: T, assets: Record<string, Blob>): { value: T; urls: string[] } {
  const urls = new Map<string, string>();
  function visit(item: unknown): unknown {
    if (typeof item === 'string' && item.startsWith('materia-asset:')) {
      if (!assets[item]) throw new Error('Il progetto contiene un riferimento immagine mancante.');
      if (!urls.has(item)) urls.set(item, URL.createObjectURL(assets[item]));
      return urls.get(item);
    }
    if (item instanceof Blob) return item;
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, visit(entry)]));
    return item;
  }
  try { return { value: visit(value) as T, urls: [...urls.values()] }; }
  catch (error) { urls.forEach((url) => URL.revokeObjectURL(url)); throw error; }
}
