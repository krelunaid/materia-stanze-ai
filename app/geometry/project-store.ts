import { approveGeometry, cloneSurfaces, type RoomGeometryV1 } from './model';
import type { Surface } from '../domain/editor';
import type { StudioMaterial, PlacedFurniture, PendingFurniture, GeometryDetectionStatus } from '../components/room-studio';

export type EditorSnapshot = {
  version: 1;
  material: StudioMaterial | null;
  materials: StudioMaterial[];
  furniture: PlacedFurniture[];
  pendingFurniture: PendingFurniture | null;
  furnitureFiles: [string, File][];
  materialSamples: [string, Blob][];
  customRequests: string[];
  customColor: string;
  manualRoomWidth: number | null;
  roomRatio: number;
  geometrySaved: boolean;
  detectionStatus: GeometryDetectionStatus;
  activeStep: number;
  showProcessedPreview: boolean;
};

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
  editor?: EditorSnapshot;
  assets?: Record<string, Blob>;
};

export type ProjectSummary = {
  id: string;
  title: string;
  fileName: string;
  updatedAt: number;
};

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
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
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
  approved?: boolean;
  editor?: EditorSnapshot;
  assets?: Record<string, Blob>;
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
    geometry: { ...approveGeometry(input.surfaces, input.source ?? 'manual'),
      status: input.approved ? 'approved' : 'proposed',
      approvedAt: input.approved ? new Date().toISOString() : null },
    editor: input.editor,
    assets: input.assets,
    originalSurfaces: cloneSurfaces(input.originalSurfaces),
    processedSurfaces: input.processedSurfaces ? cloneSurfaces(input.processedSurfaces) : null,
    updatedAt: Date.now(),
  };
}

export async function saveProject(project: StoredProject): Promise<void> {
  if (!canUseIdb()) throw new Error('Il salvataggio locale non è disponibile su questo dispositivo.');
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('save failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Salvataggio interrotto.'));
    tx.objectStore(STORE).put(project);
  }); } finally { db.close(); }
}

export async function loadProject(id: string): Promise<StoredProject | null> {
  if (!canUseIdb()) throw new Error('Archivio locale non disponibile.');
  const db = await openDb();
  try { return await new Promise<StoredProject | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve((request.result as StoredProject | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('load failed'));
  }); } finally { db.close(); }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!canUseIdb()) throw new Error('Archivio locale non disponibile.');
  const db = await openDb();
  try { return await new Promise<ProjectSummary[]>((resolve, reject) => {
    const records: ProjectSummary[] = [];
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(records.sort((a, b) => b.updatedAt - a.updatedAt)); return; }
      const project = cursor.value as StoredProject;
      records.push({ id: project.id, title: project.title, fileName: project.fileName, updatedAt: project.updatedAt });
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('list failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Lettura interrotta.'));
  }); } finally { db.close(); }
}
