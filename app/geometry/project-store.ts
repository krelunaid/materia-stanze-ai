import { approveGeometry, cloneSurfaces, type RoomGeometryV1 } from './model';
import type { Surface } from '../domain/editor';

const DB_NAME = 'materia-projects';
const DB_VERSION = 1;
const STORE = 'projects';

export type StoredProject = {
  id: string;
  title: string;
  sourceType: 'photo' | 'floorplan';
  fileName: string;
  mime: string;
  original: Blob;
  processed: Blob | null;
  processedLabel: string;
  geometry: RoomGeometryV1;
  originalSurfaces: Surface[];
  processedSurfaces: Surface[] | null;
  updatedAt: number;
};

export type ProjectSummary = {
  id: string;
  title: string;
  fileName: string;
  updatedAt: number;
};

const memory = new Map<string, StoredProject>();

function canUseIdb() {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

export function buildStoredProject(input: {
  id: string;
  title: string;
  sourceType: 'photo' | 'floorplan';
  fileName: string;
  mime: string;
  original: Blob;
  processed: Blob | null;
  processedLabel: string;
  surfaces: Surface[];
  originalSurfaces: Surface[];
  processedSurfaces: Surface[] | null;
  source?: RoomGeometryV1['source'];
}): StoredProject {
  return {
    id: input.id,
    title: input.title,
    sourceType: input.sourceType,
    fileName: input.fileName,
    mime: input.mime,
    original: input.original,
    processed: input.processed,
    processedLabel: input.processedLabel,
    geometry: approveGeometry(input.surfaces, input.source ?? 'manual'),
    originalSurfaces: cloneSurfaces(input.originalSurfaces),
    processedSurfaces: input.processedSurfaces ? cloneSurfaces(input.processedSurfaces) : null,
    updatedAt: Date.now(),
  };
}

export async function saveProject(project: StoredProject): Promise<void> {
  memory.set(project.id, project);
  if (!canUseIdb()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('save failed'));
    tx.objectStore(STORE).put(project);
  });
  db.close();
}

export async function loadProject(id: string): Promise<StoredProject | null> {
  if (!canUseIdb()) return memory.get(id) ?? null;
  const db = await openDb();
  const project = await new Promise<StoredProject | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve((request.result as StoredProject | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('load failed'));
  });
  db.close();
  return project;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const records = await listStoredProjects();
  return records
    .map((project) => ({
      id: project.id,
      title: project.title,
      fileName: project.fileName,
      updatedAt: project.updatedAt,
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

async function listStoredProjects(): Promise<StoredProject[]> {
  if (!canUseIdb()) return [...memory.values()];
  const db = await openDb();
  const records = await new Promise<StoredProject[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as StoredProject[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error('list failed'));
  });
  db.close();
  return records;
}

export function resetMemoryProjectStore() {
  memory.clear();
}
