'use client';

/* eslint-disable @next/next/no-img-element -- room and material previews are local blob URLs */

import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AcceptedRoomFile, validateRoomFile } from '../lib/file-validation';
import {
  isValidPolygon,
  nextSurfaceName,
  Point,
  pointsToSvg,
  Surface,
  SurfaceKind,
  surfaceLabels,
} from '../domain/editor';

type SourceType = 'photo' | 'floorplan';
type ImportedRoom = AcceptedRoomFile & { previewUrl?: string; sourceType: SourceType };
type MaterialReferenceKind = 'verified-texture' | 'official-product-image' | 'metadata-only' | 'uploaded-sample';
type StudioMaterial = {
  id: string;
  name: string;
  category: 'Pavimenti' | 'Rivestimenti' | 'Colori' | 'Arredi';
  description: string;
  color?: string;
  pattern?: 'wood' | 'stone' | 'tile';
  previewUrl?: string;
  textureUrl?: string;
  productImageUrl?: string;
  roomImageUrls?: string[];
  referenceKind?: MaterialReferenceKind;
  official?: boolean;
  confidence?: number;
  brand?: string;
  sourceUrl?: string;
};
type DragVertex = { surfaceId: string; vertexIndex: number; pointerId: number; origin: Point };
type AiStatus = 'checking' | 'ready' | 'missing' | 'unreachable';

const catalogMaterials: StudioMaterial[] = [
  { id: 'oak-natural', name: 'Rovere naturale', category: 'Pavimenti', description: 'Doghe grandi · effetto legno', color: '#b88d5f', pattern: 'wood' },
  { id: 'oak-light', name: 'Rovere chiaro', category: 'Pavimenti', description: '20 × 120 cm · poco giallo', color: '#d4b98f', pattern: 'wood' },
  { id: 'travertine', name: 'Travertino beige', category: 'Rivestimenti', description: '60 × 120 cm · opaco', color: '#d8c6aa', pattern: 'stone' },
  { id: 'concrete', name: 'Cemento grigio', category: 'Rivestimenti', description: '90 × 90 cm · materico', color: '#aaa9a3', pattern: 'tile' },
  { id: 'wall-sage', name: 'Verde salvia', category: 'Colori', description: 'Pittura murale opaca', color: '#9eab96' },
  { id: 'wall-linen', name: 'Bianco lino', category: 'Colori', description: 'Pittura murale calda', color: '#e9e2d4' },
  { id: 'wall-clay', name: 'Terra rosata', category: 'Colori', description: 'Pittura minerale', color: '#c9957f' },
];

const furnitureCatalog = [
  { name: 'Divano chiaro', description: 'Soggiorno · tessuto' },
  { name: 'Poltrona', description: 'Soggiorno · relax' },
  { name: 'Tavolo da pranzo', description: 'Zona pranzo · legno' },
  { name: 'Sedie', description: 'Zona pranzo · set coordinato' },
  { name: 'Mobile TV', description: 'Soggiorno · contenitore basso' },
  { name: 'Lampada', description: 'Illuminazione · terra o sospensione' },
  { name: 'Tappeto', description: 'Tessile · soggiorno o camera' },
  { name: 'Letto', description: 'Camera · matrimoniale' },
  { name: 'Cucina', description: 'Cucina · composizione completa' },
  { name: 'Armadio', description: 'Camera · contenitore' },
  { name: 'Tende', description: 'Finestre · tessuto' },
  { name: 'Quadri', description: 'Decorazione parete' },
];

const kindColors: Record<SurfaceKind, string> = {
  wall: '#4f8f84', floor: '#bf8d58', ceiling: '#8ab8c2', door: '#8b6d9c', window: '#5d93b4', other: '#7f8985',
};

function materialReferenceLabel(item: StudioMaterial) {
  if (item.referenceKind === 'verified-texture') return 'Texture ufficiale verificata';
  if (item.referenceKind === 'official-product-image') return 'Foto prodotto ufficiale';
  if (item.referenceKind === 'uploaded-sample') return 'Campione caricato da te';
  return item.sourceUrl ? 'Solo dati ufficiali · resa indicativa' : 'Campione incluso';
}

function surfaceLabelPoint(surface: Surface) {
  return surface.points.reduce((center, point) => ({ x: center.x + point.x / surface.points.length, y: center.y + point.y / surface.points.length }), { x: 0, y: 0 });
}

const guidedPresets: Array<Omit<Surface, 'id'>> = [
  { name: 'Muro 1', kind: 'wall', frozen: false, points: [{ x: .25, y: .2 }, { x: .75, y: .2 }, { x: .75, y: .68 }, { x: .25, y: .68 }] },
  { name: 'Muro 2', kind: 'wall', frozen: false, points: [{ x: 0, y: 0 }, { x: .25, y: .2 }, { x: .25, y: .68 }, { x: 0, y: 1 }] },
  { name: 'Muro 3', kind: 'wall', frozen: false, points: [{ x: .75, y: .2 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: .75, y: .68 }] },
  { name: 'Pavimento', kind: 'floor', frozen: false, points: [{ x: .25, y: .68 }, { x: .75, y: .68 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
];

function createGuidedSurfaces(bounds?: { left: number; right: number; top: number; floor: number }) {
  if (!bounds) return guidedPresets.map((surface, index) => ({ ...surface, id: `guided-${Date.now()}-${index}` }));
  const { left, right, top, floor } = bounds;
  const outerTop = 0;
  const bottom = 1;
  const presets: Array<Omit<Surface, 'id'>> = [
    { name: 'Muro 1', kind: 'wall', frozen: false, points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: floor }, { x: left, y: floor }] },
    { name: 'Muro 2', kind: 'wall', frozen: false, points: [{ x: 0, y: outerTop }, { x: left, y: top }, { x: left, y: floor }, { x: 0, y: bottom }] },
    { name: 'Muro 3', kind: 'wall', frozen: false, points: [{ x: right, y: top }, { x: 1, y: outerTop }, { x: 1, y: bottom }, { x: right, y: floor }] },
    { name: 'Pavimento', kind: 'floor', frozen: false, points: [{ x: left, y: floor }, { x: right, y: floor }, { x: 1, y: bottom }, { x: 0, y: bottom }] },
  ];
  return presets.map((surface, index) => ({ ...surface, id: `guided-${Date.now()}-${index}` }));
}

function createDemoSurfaces() {
  const presets: Array<Omit<Surface, 'id'>> = [
    { name: 'Muro 1', kind: 'wall', frozen: false, points: [{ x: .218, y: .13 }, { x: .785, y: .13 }, { x: .785, y: .695 }, { x: .218, y: .695 }] },
    { name: 'Muro 2', kind: 'wall', frozen: false, points: [{ x: 0, y: 0 }, { x: .218, y: .13 }, { x: .218, y: .695 }, { x: 0, y: .86 }] },
    { name: 'Muro 3', kind: 'wall', frozen: false, points: [{ x: .785, y: .13 }, { x: 1, y: 0 }, { x: 1, y: .86 }, { x: .785, y: .695 }] },
    { name: 'Pavimento', kind: 'floor', frozen: false, points: [{ x: .218, y: .695 }, { x: .785, y: .695 }, { x: 1, y: .86 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: .86 }] },
    { name: 'Soffitto', kind: 'ceiling', frozen: false, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .785, y: .13 }, { x: .218, y: .13 }] },
    { name: 'Finestra', kind: 'window', frozen: false, points: [{ x: .334, y: .18 }, { x: .667, y: .18 }, { x: .667, y: .552 }, { x: .334, y: .552 }] },
  ];
  return presets.map((surface, index) => ({ ...surface, id: `demo-${Date.now()}-${index}` }));
}

function strongestEdge(scores: number[], start: number, end: number, fallback: number) {
  let bestIndex = Math.round(scores.length * fallback);
  let bestScore = -1;
  const from = Math.max(1, Math.round(scores.length * start));
  const to = Math.min(scores.length - 2, Math.round(scores.length * end));
  for (let index = from; index <= to; index += 1) {
    const score = (scores[index - 1] + scores[index] * 2 + scores[index + 1]) / 4;
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  }
  return bestIndex / scores.length;
}

function detectRoomBounds(image: HTMLImageElement) {
  const width = 240;
  const height = Math.max(150, Math.round(width * image.naturalHeight / image.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const luminance = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114;
  };
  const verticalScores = Array(width).fill(0) as number[];
  const horizontalScores = Array(height).fill(0) as number[];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = Math.round(width * .05); x < width * .95; x += 2) horizontalScores[y] += Math.abs(luminance(x, y + 1) - luminance(x, y - 1));
  }
  const top = strongestEdge(horizontalScores, .12, .48, .2);
  const floor = strongestEdge(horizontalScores, Math.max(.52, top + .2), .86, .68);
  const upperBandStart = Math.max(.05, top - .05);
  const upperBandEnd = Math.min(.92, top + .1);
  for (let x = 1; x < width - 1; x += 1) {
    for (let y = Math.round(height * upperBandStart); y < height * upperBandEnd; y += 1) verticalScores[x] += Math.abs(luminance(x + 1, y) - luminance(x - 1, y));
  }
  const left = strongestEdge(verticalScores, .12, .46, .25);
  const right = strongestEdge(verticalScores, Math.max(.54, left + .2), .9, .75);
  return { left, right, top, floor };
}

function refineArchitecturalOpening(image: HTMLImageElement, surface: Surface, roomBounds?: { left: number; right: number; top: number; floor: number }) {
  if (!['window', 'door'].includes(surface.kind) || surface.points.length < 3) return surface;
  const width = 360;
  const height = Math.max(220, Math.round(width * image.naturalHeight / image.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return surface;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const luminance = (x: number, y: number) => {
    const safeX = Math.min(width - 1, Math.max(0, x));
    const safeY = Math.min(height - 1, Math.max(0, y));
    const offset = (safeY * width + safeX) * 4;
    return pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114;
  };
  const xs = surface.points.map((point) => point.x);
  const ys = surface.points.map((point) => point.y);
  const original = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  const openingWidth = Math.max(.035, original.right - original.left);
  const openingHeight = Math.max(.05, original.bottom - original.top);
  const scanBoundaries = (axis: 'x' | 'y', from: number, to: number, crossFrom: number, crossTo: number) => {
    const size = axis === 'x' ? width : height;
    const crossSize = axis === 'x' ? height : width;
    const start = Math.max(2, Math.round(from * size));
    const end = Math.min(size - 3, Math.round(to * size));
    const crossStart = Math.max(0, Math.round(crossFrom * crossSize));
    const crossEnd = Math.min(crossSize - 1, Math.round(crossTo * crossSize));
    const scored: Array<{ position: number; score: number }> = [];
    for (let index = start; index <= end; index += 1) {
      let score = 0;
      let samples = 0;
      for (let cross = crossStart; cross <= crossEnd; cross += 2) {
        score += axis === 'x'
          ? Math.abs(luminance(index + 2, cross) - luminance(index - 2, cross))
          : Math.abs(luminance(cross, index + 2) - luminance(cross, index - 2));
        samples += 1;
      }
      score /= Math.max(1, samples);
      scored.push({ position: index / size, score });
    }
    return scored;
  };
  const outerPair = (scored: Array<{ position: number; score: number }>, center: number, fallbackStart: number, fallbackEnd: number, reliability = .5) => {
    const bestScore = scored.reduce((best, candidate) => Math.max(best, candidate.score), 0);
    const reliableScore = Math.max(6, bestScore * reliability);
    const reliable = scored.filter((candidate) => candidate.score >= reliableScore);
    const before = reliable.filter((candidate) => candidate.position < center - .008).at(0);
    const after = reliable.filter((candidate) => candidate.position > center + .008).at(-1);
    return { start: before?.position ?? fallbackStart, end: after?.position ?? fallbackEnd };
  };

  const roomLeft = roomBounds?.left ?? Math.max(0, original.left - openingWidth * 1.5);
  const roomRight = roomBounds?.right ?? Math.min(1, original.right + openingWidth * 1.5);
  const roomTop = roomBounds?.top ?? Math.max(0, original.top - openingHeight * 1.5);
  const roomFloor = roomBounds?.floor ?? Math.min(1, original.bottom + openingHeight * 2);
  const roomWidth = Math.max(.2, roomRight - roomLeft);
  const centerX = (original.left + original.right) / 2;
  const centerY = (original.top + original.bottom) / 2;
  const horizontalRadius = Math.min(roomWidth * .48, Math.max(.18, openingWidth * 1.5));
  const verticalEdges = scanBoundaries(
    'x',
    Math.max(roomLeft + roomWidth * .06, centerX - horizontalRadius),
    Math.min(roomRight - roomWidth * .06, centerX + horizontalRadius),
    Math.max(roomTop + .015, original.top - openingHeight * .5),
    Math.min(roomFloor - .02, original.bottom + Math.max(.2, openingHeight * 2.5)),
  );
  const verticalPair = outerPair(verticalEdges, centerX, original.left, original.right);
  const left = verticalPair.start;
  const right = verticalPair.end;
  const horizontalEdges = scanBoundaries('y', roomTop + .025, roomFloor - .025, left, right);
  const horizontalPair = outerPair(horizontalEdges, centerY, original.top, original.bottom, .35);
  const top = horizontalPair.start;
  const bottom = horizontalPair.end;
  if (right - left < .025 || bottom - top < .04) return surface;
  return { ...surface, points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }] };
}

function createFloorplanOutline(): Surface[] {
  return [{
    id: `floorplan-${Date.now()}`,
    name: 'Perimetro planimetria',
    kind: 'floor',
    frozen: false,
    points: [{ x: .06, y: .06 }, { x: .94, y: .06 }, { x: .94, y: .94 }, { x: .06, y: .94 }],
  }];
}

function wallFromLine(start: Point, end: Point): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const halfThickness = .008;
  const offsetX = (-dy / length) * halfThickness;
  const offsetY = (dx / length) * halfThickness;
  return [
    { x: start.x + offsetX, y: start.y + offsetY },
    { x: end.x + offsetX, y: end.y + offsetY },
    { x: end.x - offsetX, y: end.y - offsetY },
    { x: start.x - offsetX, y: start.y - offsetY },
  ];
}

function eventPoint(event: ReactPointerEvent<SVGSVGElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function optimizedPreviewUrl(file: File): string | Promise<string> {
  const isApplePhoto = ['image/heic', 'image/heif'].includes(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (file.size < 512 * 1024 && !isApplePhoto) return URL.createObjectURL(file);

  return (async () => {
    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = 'async';
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('timeout')), 15000);
        image.onload = () => { window.clearTimeout(timer); resolve(); };
        image.onerror = () => { window.clearTimeout(timer); reject(new Error('decode')); };
        image.src = sourceUrl;
      });
      const maximumSide = 1800;
      const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const optimized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .88));
      if (!optimized) throw new Error('encode');
      return URL.createObjectURL(optimized);
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  })();
}

function loadImageSource(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    const timer = window.setTimeout(() => reject(new Error('La foto sta impiegando troppo tempo a caricarsi.')), 20000);
    image.onload = () => { window.clearTimeout(timer); resolve(image); };
    image.onerror = () => { window.clearTimeout(timer); reject(new Error('Non riesco a leggere una delle immagini.')); };
    image.src = source;
  });
}

async function createGeometryInput(source: string) {
  const image = await loadImageSource(source);
  const maximumSide = 1024;
  const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Non posso preparare la foto per il riconoscimento.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .82));
  if (!result) throw new Error('Non posso preparare la foto per il riconoscimento.');
  return result;
}

async function requestJson<T>(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    const nativeAccessToken = import.meta.env.VITE_SITES_BYPASS_TOKEN?.trim();
    if (window.location.protocol === 'capacitor:' && nativeAccessToken) {
      headers.set('OAI-Sites-Authorization', `Bearer ${nativeAccessToken}`);
    }
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    const text = await response.text();
    let result: T;
    try {
      result = JSON.parse(text) as T;
    } catch {
      throw new Error(response.ok
        ? 'Il server ha restituito una risposta non valida.'
        : 'Il servizio non è raggiungibile da questa versione dell’app.');
    }
    return { response, result };
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      throw new Error('L’operazione sta impiegando troppo tempo. Controlla la connessione e riprova.');
    }
    throw caught;
  } finally {
    window.clearTimeout(timer);
  }
}

export function RoomStudio() {
  const [room, setRoom] = useState<ImportedRoom | null>(null);
  const [roomRatio, setRoomRatio] = useState(16 / 10);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [pastSurfaces, setPastSurfaces] = useState<Surface[][]>([]);
  const [futureSurfaces, setFutureSurfaces] = useState<Surface[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [drawKind, setDrawKind] = useState<SurfaceKind | null>(null);
  const [quickDraw, setQuickDraw] = useState(false);
  const [lineWallDraw, setLineWallDraw] = useState(false);
  const [draft, setDraft] = useState<Point[]>([]);
  const [material, setMaterial] = useState<StudioMaterial | null>(null);
  const [materialQuery, setMaterialQuery] = useState('');
  const [onlineMaterials, setOnlineMaterials] = useState<StudioMaterial[]>([]);
  const [furniture, setFurniture] = useState<string[]>([]);
  const [customRequests, setCustomRequests] = useState<string[]>([]);
  const [customColor, setCustomColor] = useState('#c8b9a6');
  const [renderSummaryOpen, setRenderSummaryOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isImportingRoom, setIsImportingRoom] = useState(false);
  const [isAutoFitting, setIsAutoFitting] = useState(false);
  const [isEmptyingRoom, setIsEmptyingRoom] = useState(false);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [isApplyingProduct, setIsApplyingProduct] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>('checking');
  const [aiProviderLabel, setAiProviderLabel] = useState<string | null>(null);
  const [processedPreview, setProcessedPreview] = useState<string | null>(null);
  const [processedLabel, setProcessedLabel] = useState('Stanza vuota');
  const [showProcessedPreview, setShowProcessedPreview] = useState(false);
  const [dragVertex, setDragVertex] = useState<DragVertex | null>(null);
  const [isCorrectingEdges, setIsCorrectingEdges] = useState(false);
  const roomInputRef = useRef<HTMLInputElement>(null);
  const floorplanInputRef = useRef<HTMLInputElement>(null);
  const materialInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const roomBlobRef = useRef<string | null>(null);
  const materialBlobRef = useRef<string | null>(null);
  const processedBlobRef = useRef<string | null>(null);
  const dragStartRef = useRef<Surface[] | null>(null);
  const roomImageRef = useRef<HTMLImageElement>(null);
  const autoFitPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    shellRef.current?.setAttribute('data-hydrated', 'true');
    return () => {
      if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
      if (materialBlobRef.current) URL.revokeObjectURL(materialBlobRef.current);
      if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    const headers = new Headers();
    const nativeAccessToken = import.meta.env.VITE_SITES_BYPASS_TOKEN?.trim();
    if (window.location.protocol === 'capacitor:' && nativeAccessToken) {
      headers.set('OAI-Sites-Authorization', `Bearer ${nativeAccessToken}`);
    }
    void fetch(endpoint('/api/capabilities'), { cache: 'no-store', headers, signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { aiReady?: boolean; providerLabel?: string | null };
        setAiProviderLabel(result.providerLabel ?? null);
        setAiStatus(response.ok && result.aiReady ? 'ready' : 'missing');
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') setAiStatus('unreachable');
        else setAiStatus('unreachable');
      })
      .finally(() => window.clearTimeout(timer));
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, []);

  useEffect(() => {
    shellRef.current?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }, [activeStep]);

  useEffect(() => {
    if (!dragVertex) return;
    const preventTouchScroll = (event: TouchEvent) => event.preventDefault();
    document.addEventListener('touchmove', preventTouchScroll, { passive: false });
    return () => document.removeEventListener('touchmove', preventTouchScroll);
  }, [dragVertex]);

  const selected = surfaces.find((surface) => surface.id === selectedId) ?? null;
  const projectName = room?.projectName ?? 'Progetto senza titolo';
  const importedCaption = useMemo(() => room ? `Immagine · ${room.displaySize}` : null, [room]);
  const filteredMaterials = useMemo(() => {
    const query = materialQuery.trim().toLocaleLowerCase('it');
    if (!query) return catalogMaterials.slice(0, 4);
    return catalogMaterials.filter((item) => `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase('it').includes(query));
  }, [materialQuery]);
  const filteredFurniture = useMemo(() => {
    const query = materialQuery.trim().toLocaleLowerCase('it');
    if (!query) return [];
    return furnitureCatalog.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase('it').includes(query));
  }, [materialQuery]);
  const materialMap = useMemo(() => new Map(catalogMaterials.concat(onlineMaterials, material ? [material] : []).map((item) => [item.id, item])), [material, onlineMaterials]);

  function commitSurfaces(next: Surface[]) {
    setPastSurfaces((history) => [...history, surfaces].slice(-40));
    setFutureSurfaces([]);
    setSurfaces(next);
  }

  function undo() {
    const previous = pastSurfaces.at(-1);
    if (!previous) return;
    setPastSurfaces((history) => history.slice(0, -1));
    setFutureSurfaces((future) => [surfaces, ...future].slice(0, 40));
    setSurfaces(previous);
    const previousSelected = previous.find((surface) => surface.id === selectedId);
    if (selectedId && !previousSelected) setSelectedId(null);
    setRenameDraft(previousSelected?.name ?? '');
    setNotice('Ultima modifica annullata.');
  }

  function redo() {
    const next = futureSurfaces[0];
    if (!next) return;
    setFutureSurfaces((future) => future.slice(1));
    setPastSurfaces((history) => [...history, surfaces].slice(-40));
    setSurfaces(next);
    setRenameDraft(next.find((surface) => surface.id === selectedId)?.name ?? '');
    setNotice('Modifica ripristinata.');
  }

  function importRoom(file?: File, sourceType: SourceType = 'photo') {
    if (!file) return;
    const result = validateRoomFile(file);
    if (!result.ok) { setError(result.message); return; }
    if (!result.value.canPreview) {
      setError('Il PDF non è ancora modificabile. Esportalo come immagine e riprova.');
      return;
    }
    const finishImport = (previewUrl: string) => {
      if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
      if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
      roomBlobRef.current = previewUrl;
      processedBlobRef.current = null;
      const initialSurfaces = sourceType === 'floorplan' ? createFloorplanOutline() : [];
      setRoom({ ...result.value, previewUrl, sourceType });
      setProcessedPreview(null); setShowProcessedPreview(false); setProcessedLabel('Stanza vuota'); setOnlineMaterials([]);
      autoFitPreviewRef.current = null;
      setSurfaces(initialSurfaces); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(initialSurfaces[0]?.id ?? null); setRenameDraft(initialSurfaces[0]?.name ?? ''); setDraft([]); setDrawKind(null); setQuickDraw(false); setLineWallDraw(false); setError(null);
      setIsCorrectingEdges(false);
      setNotice(sourceType === 'floorplan'
        ? 'Planimetria riprodotta. Adatta il perimetro con i pallini e aggiungi le pareti interne con due tocchi.'
        : 'Foto pronta. Sto riconoscendo pavimento e muri: potrai correggere i pallini solo se serve.');
      setIsImportingRoom(false);
      setActiveStep(2);
    };
    const failImport = () => {
      setError('La foto non può essere letta. Su iPhone prova a condividerla come JPEG oppure scegli uno screenshot.');
      setIsImportingRoom(false);
    };

    setError(null);
    const preview = optimizedPreviewUrl(file);
    if (typeof preview === 'string') finishImport(preview);
    else { setIsImportingRoom(true); void preview.then(finishImport).catch(failImport); }
  }

  function onRoomInput(event: ChangeEvent<HTMLInputElement>) {
    void importRoom(event.currentTarget.files?.[0], 'photo'); event.currentTarget.value = '';
  }

  function onFloorplanInput(event: ChangeEvent<HTMLInputElement>) {
    void importRoom(event.currentTarget.files?.[0], 'floorplan'); event.currentTarget.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setIsDraggingFile(false); void importRoom(event.dataTransfer.files?.[0], 'photo');
  }

  function removeRoom() {
    if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
    if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
    roomBlobRef.current = null;
    processedBlobRef.current = null;
    setRoom(null); setSurfaces([]); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(null); setDraft([]); setDrawKind(null); setQuickDraw(false); setLineWallDraw(false); setProcessedPreview(null); setShowProcessedPreview(false); setProcessedLabel('Stanza vuota'); setOnlineMaterials([]); setNotice(null); setIsCorrectingEdges(false);
  }

  function startDrawing(kind: SurfaceKind = 'wall', quick = false) {
    if (!room) return;
    setDrawKind(kind); setQuickDraw(quick); setLineWallDraw(false); setDraft([]); setSelectedId(null); setRenameDraft('');
    setNotice(quick ? 'Muro facile: tocca i quattro angoli. Si chiuderà automaticamente.' : `Disegno avanzato: tocca tutti i vertici e poi “Chiudi superficie”.`);
  }

  function startFloorplanWall() {
    if (!room) return;
    setDrawKind('wall'); setQuickDraw(false); setLineWallDraw(true); setDraft([]); setSelectedId(null); setRenameDraft('');
    setNotice('Parete interna: tocca l’inizio e la fine della linea. Lo spessore viene creato automaticamente.');
  }

  function addDraftPoint(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drawKind || dragVertex) return;
    const point = eventPoint(event);
    const next = [...draft, point];
    if (lineWallDraw && next.length === 2) completeSurface(wallFromLine(next[0], next[1]), 'wall');
    else if (quickDraw && next.length === 4) completeSurface(next, drawKind);
    else setDraft(next);
  }

  function completeSurface(points: Point[], kind: SurfaceKind) {
    if (!isValidPolygon(points)) {
      setError('Servono almeno tre punti non allineati per chiudere la superficie.'); return;
    }
    const id = `surface-${Date.now()}-${surfaces.length}`;
    const surface: Surface = { id, name: nextSurfaceName(kind, surfaces), kind, points, frozen: false };
    commitSurfaces([...surfaces, surface]); setSelectedId(id); setRenameDraft(surface.name); setDraft([]); setDrawKind(null); setQuickDraw(false); setLineWallDraw(false); setError(null);
    setNotice(`${surface.name} creata. Trascina i punti per correggerla.`);
  }

  function cancelDrawing() { setDraft([]); setDrawKind(null); setQuickDraw(false); setLineWallDraw(false); setNotice(null); }

  function beginVertexDrag(event: ReactPointerEvent<SVGCircleElement>, surfaceId: string, vertexIndex: number) {
    const surface = surfaces.find((item) => item.id === surfaceId);
    if (!surface || surface.frozen || !isCorrectingEdges) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    shellRef.current?.classList.add('is-moving-vertex');
    dragStartRef.current = surfaces;
    setDragVertex({ surfaceId, vertexIndex, pointerId: event.pointerId, origin: surface.points[vertexIndex] });
  }

  function moveDraggedVertex(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragVertex || event.pointerId !== dragVertex.pointerId) return;
    event.preventDefault();
    const point = eventPoint(event);
    setSurfaces((current) => current.map((surface) => {
      if (surface.frozen) return surface;
      const linkedPoints = surface.points.map((candidate, index) => {
        const isDragged = surface.id === dragVertex.surfaceId && index === dragVertex.vertexIndex;
        const isShared = Math.abs(candidate.x - dragVertex.origin.x) < .004 && Math.abs(candidate.y - dragVertex.origin.y) < .004;
        return isDragged || isShared ? point : candidate;
      });
      return { ...surface, points: linkedPoints };
    }));
  }

  function endVertexDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragVertex && event.pointerId === dragVertex.pointerId) {
      if (dragStartRef.current) {
        setPastSurfaces((history) => [...history, dragStartRef.current as Surface[]].slice(-40));
        setFutureSurfaces([]);
      }
      dragStartRef.current = null;
      setDragVertex(null);
      shellRef.current?.classList.remove('is-moving-vertex');
    }
  }

  function toggleEdgeCorrection() {
    if (isCorrectingEdges) {
      setIsCorrectingEdges(false);
      shellRef.current?.classList.remove('is-moving-vertex');
      setNotice('Bordi salvati. Ora puoi continuare ai prodotti.');
      return;
    }
    setIsCorrectingEdges(true);
    setNotice('Correzione attiva: trascina solo i pallini. La pagina resterà ferma finché tieni premuto.');
  }

  function toggleFreeze() {
    if (!selected) return;
    commitSurfaces(surfaces.map((surface) => surface.id === selected.id ? { ...surface, frozen: !surface.frozen } : surface));
    setNotice(selected.frozen ? `${selected.name} sbloccata.` : `${selected.name} protetta: geometria e materiale non possono cambiare.`);
  }

  function freezeAllExceptSelected() {
    if (!selected) return;
    commitSurfaces(surfaces.map((surface) => ({ ...surface, frozen: surface.id !== selected.id })));
    setNotice(`Tutte le superfici sono protette tranne ${selected.name}.`);
  }

  function renameSelected() {
    const name = renameDraft.trim();
    if (!selected || !name || name === selected.name) return;
    commitSurfaces(surfaces.map((surface) => surface.id === selected.id ? { ...surface, name } : surface));
    setNotice(`Superficie rinominata “${name}”.`);
  }

  function deleteSelected() {
    if (!selected || selected.frozen) return;
    commitSurfaces(surfaces.filter((surface) => surface.id !== selected.id)); setSelectedId(null); setRenameDraft('');
    setNotice(`${selected.name} eliminata.`);
  }

  function importMaterial(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('Il campione materiale deve essere JPG o PNG.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('Il campione materiale supera il limite di 20 MB.'); return; }
    if (materialBlobRef.current) URL.revokeObjectURL(materialBlobRef.current);
    const previewUrl = URL.createObjectURL(file);
    materialBlobRef.current = previewUrl;
    const next: StudioMaterial = { id: `material-${Date.now()}`, name: file.name.replace(/\.[^.]+$/, ''), category: 'Rivestimenti', description: 'Campione fotografico personale', previewUrl, textureUrl: previewUrl, referenceKind: 'uploaded-sample' };
    setMaterial(next); setError(null); setNotice(`Campione “${next.name}” pronto. Seleziona una superficie e applicalo.`);
  }

  function onMaterialInput(event: ChangeEvent<HTMLInputElement>) {
    importMaterial(event.currentTarget.files?.[0]); event.currentTarget.value = '';
  }

  function applyMaterial() {
    if (!selected || !material || selected.frozen) return;
    commitSurfaces(surfaces.map((surface) => surface.id === selected.id ? { ...surface, materialId: material.id } : surface));
    setNotice(`${material.name} applicato a ${selected.name}. L’originale resta visibile fuori dal contorno.`);
  }

  function endpoint(path: string) {
    return window.location.protocol === 'capacitor:'
      ? `https://materia-stanze-ai.andreagadducci.chatgpt.site${path}`
      : path;
  }

  async function searchProductsOnline() {
    const query = materialQuery.trim();
    if (query.length < 3 || isSearchingProducts) {
      if (query.length < 3) setError('Scrivi almeno tre caratteri per cercare un prodotto.');
      return;
    }
    setIsSearchingProducts(true); setError(null); setNotice(`Cerco “${query}” nei cataloghi online…`); setOnlineMaterials([]);
    try {
      const { response, result } = await requestJson<{ products?: Array<{ name: string; brand: string; collection?: string; category: StudioMaterial['category']; color?: string; effect?: string; format?: string; finish?: string; description: string; sourceUrl: string; productImageUrl?: string; textureImageUrl?: string; roomImageUrls?: string[]; confidence?: number; official?: boolean; correction?: string }>; message?: string }>(endpoint('/api/search-products'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
      }, 60000);
      if (!response.ok) throw new Error(result.message ?? 'Ricerca non disponibile.');
      const found = (result.products ?? []).map((item, index) => {
        const technicalDetails = [
          item.collection,
          item.color,
          item.effect,
          item.format,
          item.finish,
          item.correction,
          item.description,
          typeof item.confidence === 'number' ? `${item.official ? 'Fonte ufficiale' : 'Fonte verificata'} · ${Math.round(item.confidence * 100)}%` : null,
        ].filter(Boolean).join(' · ');
        const textureUrl = item.textureImageUrl || undefined;
        const productImageUrl = item.productImageUrl || undefined;
        const referenceKind: MaterialReferenceKind = textureUrl ? 'verified-texture' : productImageUrl ? 'official-product-image' : 'metadata-only';
        return {
          id: `online-${Date.now()}-${index}`,
          name: item.name,
          brand: item.brand,
          category: item.category,
          description: technicalDetails,
          sourceUrl: item.sourceUrl,
          previewUrl: textureUrl ?? productImageUrl,
          textureUrl,
          productImageUrl,
          roomImageUrls: item.roomImageUrls ?? [],
          referenceKind,
          official: item.official,
          confidence: item.confidence,
        };
      });
      setOnlineMaterials(found);
      setNotice(found.length ? `${found.length} prodotti verificati. L’app indica chiaramente se ha trovato anche una texture ufficiale oppure soltanto i dati del catalogo.` : 'Nessun prodotto affidabile trovato. Prova con marca e collezione più precise.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ricerca non disponibile.'); setNotice(null);
    } finally { setIsSearchingProducts(false); }
  }

  function recommendedSurface(item: StudioMaterial) {
    const description = `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase('it');
    const preferredKind: SurfaceKind = item.category === 'Pavimenti' || /pavimento|parquet|rovere|piastrella|mattonell/.test(description) ? 'floor' : 'wall';
    return surfaces.find((surface) => !surface.frozen && surface.kind === preferredKind)
      ?? (selected && !selected.frozen ? selected : null)
      ?? surfaces.find((surface) => !surface.frozen)
      ?? null;
  }

  async function createMaskedInput(options: { editableSurface?: Surface; frozenSurfaces?: Surface[]; sourceUrl?: string }) {
    const sourceUrl = options.sourceUrl ?? room?.previewUrl;
    if (!sourceUrl) throw new Error('La foto della stanza non è pronta.');
    const image = await loadImageSource(sourceUrl);
    const maxSide = 1536;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const imageCanvas = document.createElement('canvas');
    const maskCanvas = document.createElement('canvas');
    imageCanvas.width = maskCanvas.width = width;
    imageCanvas.height = maskCanvas.height = height;
    const imageContext = imageCanvas.getContext('2d');
    const maskContext = maskCanvas.getContext('2d');
    if (!imageContext || !maskContext) throw new Error('Non posso preparare la superficie.');
    imageContext.drawImage(image, 0, 0, width, height);

    const drawPolygon = (surface: Surface) => {
      maskContext.beginPath();
      surface.points.forEach((point, index) => {
        const x = point.x * width; const y = point.y * height;
        if (index === 0) maskContext.moveTo(x, y); else maskContext.lineTo(x, y);
      });
      maskContext.closePath(); maskContext.fill();
    };

    if (options.editableSurface) {
      maskContext.fillStyle = '#ffffff'; maskContext.fillRect(0, 0, width, height);
      maskContext.globalCompositeOperation = 'destination-out';
      drawPolygon(options.editableSurface);
    } else {
      maskContext.clearRect(0, 0, width, height);
      maskContext.fillStyle = '#ffffff';
      for (const surface of options.frozenSurfaces ?? []) drawPolygon(surface);
    }

    const [inputImage, mask] = await Promise.all([
      new Promise<Blob | null>((resolve) => imageCanvas.toBlob(resolve, 'image/png')),
      new Promise<Blob | null>((resolve) => maskCanvas.toBlob(resolve, 'image/png')),
    ]);
    if (!inputImage || !mask) throw new Error('Non posso preparare foto e maschera della superficie.');
    return { inputImage, mask };
  }

  async function protectAiResult(resultSource: string, options: { editableSurface?: Surface; frozenSurfaces?: Surface[] }) {
    if (!room?.previewUrl) throw new Error('La fotografia originale non è disponibile.');
    const [original, generated] = await Promise.all([
      loadImageSource(room.previewUrl),
      loadImageSource(resultSource),
    ]);
    const maxSide = 1536;
    const scale = Math.min(1, maxSide / Math.max(original.naturalWidth, original.naturalHeight));
    const width = Math.max(1, Math.round(original.naturalWidth * scale));
    const height = Math.max(1, Math.round(original.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Non posso proteggere le zone Freeze.');

    const clipTo = (surface: Surface) => {
      context.beginPath();
      surface.points.forEach((point, index) => {
        const x = point.x * width; const y = point.y * height;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.closePath();
      context.clip();
    };

    if (options.editableSurface) {
      context.drawImage(original, 0, 0, width, height);
      context.save();
      clipTo(options.editableSurface);
      context.drawImage(generated, 0, 0, width, height);
      context.restore();
    } else {
      context.drawImage(generated, 0, 0, width, height);
      for (const surface of options.frozenSurfaces ?? []) {
        context.save();
        clipTo(surface);
        context.drawImage(original, 0, 0, width, height);
        context.restore();
      }
    }

    const protectedImage = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!protectedImage) throw new Error('Non posso completare la protezione Freeze.');
    if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
    const protectedUrl = URL.createObjectURL(protectedImage);
    processedBlobRef.current = protectedUrl;
    return protectedUrl;
  }

  async function applyMaterialAutomatically() {
    if (!material || !room?.previewUrl || isApplyingProduct) return;
    if (material.category === 'Arredi') {
      setCustomRequests((current) => current.includes(material.name) ? current : [...current, material.name]);
      setNotice(`${material.name} aggiunto al render. Le superfici bloccate resteranno identiche.`);
      return;
    }
    const target = recommendedSurface(material);
    if (!target) { setError('Tutte le superfici sono bloccate. Sbloccane una per applicare il prodotto.'); return; }
    setSelectedId(target.id); setRenameDraft(target.name); setError(null);

    if (!material.sourceUrl) {
      commitSurfaces(surfaces.map((surface) => surface.id === target.id ? { ...surface, materialId: material.id } : surface));
      setNotice(`${material.name} applicato automaticamente a ${target.name}. Le zone bloccate non sono state toccate.`);
      return;
    }

    setIsApplyingProduct(true); setNotice(`Adatto ${material.name} a ${target.name} rispettando prospettiva e zone bloccate…`);
    try {
      const { inputImage, mask } = await createMaskedInput({ editableSurface: target });
      const form = new FormData();
      form.append('image', inputImage, room.file.name.replace(/\.(heic|heif)$/i, '.png'));
      form.append('mask', mask, 'surface-mask.png');
      form.append('productName', `${material.brand ? `${material.brand} ` : ''}${material.name}`);
      form.append('productDescription', `${material.description} · fonte: ${material.sourceUrl}`);
      form.append('targetName', target.name);
      form.append('protectedAreas', surfaces.filter((surface) => surface.frozen).map((surface) => surface.name).join(', '));
      const referenceUrl = material.textureUrl ?? material.productImageUrl;
      if (referenceUrl) form.append('imageUrl', referenceUrl);
      form.append('referenceType', material.referenceKind ?? 'metadata-only');
      const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/apply-product'), { method: 'POST', body: form }, 180000);
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Render non disponibile.');
      const protectedPreview = await protectAiResult(result.image, { editableSurface: target });
      commitSurfaces(surfaces.map((surface) => surface.id === target.id ? { ...surface, materialId: material.id } : surface));
      setProcessedPreview(protectedPreview); setProcessedLabel(material.name); setShowProcessedPreview(true);
      setNotice(material.referenceKind === 'verified-texture' || material.referenceKind === 'uploaded-sample'
        ? `${material.name} adattato a ${target.name} usando il campione visivo. Fuori dal contorno restano i pixel originali.`
        : `${material.name} applicato in modo indicativo a ${target.name}: manca una texture ufficiale verificata. Fuori dal contorno restano i pixel originali.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito ad applicare il prodotto.'); setNotice(null);
    } finally { setIsApplyingProduct(false); }
  }

  function chooseMaterial(next: StudioMaterial) {
    setMaterial(next);
    setNotice(`${next.name} selezionato. Ora applicalo alla superficie scelta.`);
  }

  function toggleFurniture(item: string) {
    setFurniture((current) => current.includes(item) ? current.filter((name) => name !== item) : [...current, item]);
  }

  function chooseCustomColor() {
    chooseMaterial({ id: `color-${customColor.slice(1)}`, name: `Colore ${customColor.toUpperCase()}`, category: 'Colori', description: 'Colore personalizzato', color: customColor });
  }

  function addCustomRequest() {
    const request = materialQuery.trim();
    if (!request || customRequests.includes(request)) return;
    setCustomRequests((current) => [...current, request]);
    setNotice(`“${request}” aggiunto alla richiesta del render.`);
  }

  function materialFill(surface: Surface) {
    if (!surface.materialId) return `${kindColors[surface.kind]}44`;
    const assigned = materialMap.get(surface.materialId);
    if (!assigned) return `${kindColors[surface.kind]}44`;
    if (assigned.previewUrl) return `url(#uploaded-material-${assigned.id})`;
    if (assigned.pattern) return `url(#catalog-material-${assigned.id})`;
    return assigned.color ?? `${kindColors[surface.kind]}44`;
  }

  function seedGuidedSurfaces() {
    if (!room || surfaces.length > 0) return;
    const created = createGuidedSurfaces();
    commitSurfaces(created); setSelectedId(created[0].id); setRenameDraft(created[0].name);
    setNotice('Tracciatura guidata inserita. Adatta ogni vertice alla fotografia trascinandolo.');
  }

  async function autoFitSurfaces() {
    if (!room?.previewUrl || room.sourceType !== 'photo' || !roomImageRef.current) return;
    setIsAutoFitting(true); setError(null);
    setNotice(aiStatus === 'ready' || aiStatus === 'checking'
      ? 'Grok sta leggendo gli angoli reali, il pavimento, le pareti e il soffitto…'
      : 'Sto preparando una tracciatura locale della stanza…');
    try {
      let detected: Surface[] | null = null;
      let usedGrok = false;
      let grokError: Error | null = null;

      if (aiStatus === 'ready' || aiStatus === 'checking') {
        try {
          const inputImage = await createGeometryInput(room.previewUrl);
          const form = new FormData();
          form.append('image', inputImage, room.file.name.replace(/\.(heic|heif|png)$/i, '.jpg'));
          const { response, result } = await requestJson<{
            surfaces?: Array<{ name: string; kind: SurfaceKind; points: Point[]; confidence: number }>;
            message?: string;
          }>(endpoint('/api/detect-surfaces'), { method: 'POST', body: form }, 75000);
          if (!response.ok || !result.surfaces?.length) throw new Error(result.message ?? 'Grok non ha trovato superfici affidabili.');
          detected = result.surfaces.filter((surface) => isValidPolygon(surface.points)).map((surface, index) => ({
            id: `grok-${Date.now()}-${index}`,
            name: surface.name,
            kind: surface.kind,
            points: surface.points,
            frozen: false,
          }));
          usedGrok = detected.length > 0;
          const detectedWalls = detected.filter((surface) => surface.kind === 'wall');
          if (detectedWalls.length === 3) {
            const edgeTouches = (surface: Surface) => surface.points.filter((point) => point.x <= .025 || point.x >= .975).length;
            const centralWall = [...detectedWalls].sort((a, b) => edgeTouches(a) - edgeTouches(b))[0];
            const wallXs = centralWall.points.map((point) => point.x);
            const aiLeft = Math.min(...wallXs);
            const aiRight = Math.max(...wallXs);
            const localBounds = detectRoomBounds(roomImageRef.current);
            const localSpan = localBounds.right - localBounds.left;
            const combinedBounds = localSpan >= .25 && localSpan <= .8
              ? localBounds
              : aiRight - aiLeft >= .2 ? { ...localBounds, left: aiLeft, right: aiRight } : localBounds;
            const architecturalExtras = detected.filter((surface) => !['wall', 'floor'].includes(surface.kind));
            if (!architecturalExtras.some((surface) => surface.kind === 'ceiling')) architecturalExtras.push({
              id: `guided-ceiling-${Date.now()}`,
              name: 'Soffitto',
              kind: 'ceiling',
              frozen: false,
              points: [],
            });
            const alignedExtras = architecturalExtras.map((surface) => surface.kind === 'ceiling' ? {
              ...surface,
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: combinedBounds.right, y: combinedBounds.top },
                { x: combinedBounds.left, y: combinedBounds.top },
              ],
            } : refineArchitecturalOpening(roomImageRef.current as HTMLImageElement, surface, combinedBounds));
            detected = [...createGuidedSurfaces(combinedBounds), ...alignedExtras];
          }
        } catch (caught) {
          grokError = caught instanceof Error ? caught : new Error('Grok non ha completato il riconoscimento.');
        }
      }

      if (!detected?.length) detected = createGuidedSurfaces(detectRoomBounds(roomImageRef.current));

      const frozenSurfaces = surfaces.filter((surface) => surface.frozen);
      const frozenKeys = new Set(frozenSurfaces.map((surface) => `${surface.kind}:${surface.name.toLocaleLowerCase('it')}`));
      const editableByKey = new Map(surfaces.filter((surface) => !surface.frozen).map((surface) => [`${surface.kind}:${surface.name.toLocaleLowerCase('it')}`, surface]));
      const adjusted = detected.filter((surface) => !frozenKeys.has(`${surface.kind}:${surface.name.toLocaleLowerCase('it')}`)).map((surface) => {
        const previous = editableByKey.get(`${surface.kind}:${surface.name.toLocaleLowerCase('it')}`);
        return previous ? { ...surface, id: previous.id, materialId: previous.materialId } : surface;
      });
      const nextSurfaces = [...adjusted, ...frozenSurfaces];
      commitSurfaces(nextSurfaces);
      const first = adjusted[0] ?? frozenSurfaces[0] ?? null;
      setSelectedId(first?.id ?? null); setRenameDraft(first?.name ?? '');
      setIsCorrectingEdges(false);
      setNotice(usedGrok
        ? `Grok ha riconosciuto ${nextSurfaces.length} superfici e l’app ha agganciato gli angoli ai bordi della foto. Correggi solo se serve.`
        : `${grokError ? 'Grok non ha risposto: ' : ''}ho inserito una base locale. Puoi riprovare l’analisi IA o correggere i bordi.`);
    } catch {
      if (surfaces.length === 0) seedGuidedSurfaces();
      setIsCorrectingEdges(false);
      setNotice('Ho inserito una base automatica. Puoi continuare oppure correggere i bordi solo se serve.');
    } finally {
      setIsAutoFitting(false);
    }
  }

  function onRoomImageLoad(image: HTMLImageElement) {
    setRoomRatio(image.naturalWidth / image.naturalHeight);
    if (room?.sourceType === 'photo' && room.previewUrl && surfaces.length === 0 && autoFitPreviewRef.current !== room.previewUrl) {
      autoFitPreviewRef.current = room.previewUrl;
      window.setTimeout(() => void autoFitSurfaces(), 0);
    }
  }

  async function emptyRoom() {
    if (!room?.previewUrl || room.sourceType !== 'photo' || isEmptyingRoom) return;
    setIsEmptyingRoom(true); setError(null);
    setNotice('L’IA sta riconoscendo e rimuovendo i mobili. L’originale resta sempre disponibile.');
    try {
      const frozenSurfaces = surfaces.filter((surface) => surface.frozen);
      const { inputImage, mask } = await createMaskedInput({ frozenSurfaces });
      const form = new FormData();
      form.append('image', inputImage, room.file.name.replace(/\.(heic|heif)$/i, '.png'));
      form.append('mask', mask, 'freeze-mask.png');
      form.append('protectedAreas', frozenSurfaces.map((surface) => surface.name).join(', '));
      const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/empty-room'), { method: 'POST', body: form }, 180000);
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Immagine non disponibile.');
      const protectedPreview = await protectAiResult(result.image, { frozenSurfaces });
      setProcessedPreview(protectedPreview); setProcessedLabel('Stanza vuota'); setShowProcessedPreview(true);
      setNotice('Stanza vuota pronta. Le zone Freeze sono state ricopiate dalla foto originale.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito a svuotare la stanza.');
      setNotice(null);
    } finally {
      setIsEmptyingRoom(false);
    }
  }

  async function createFinalRender() {
    if (!room?.previewUrl || room.sourceType !== 'photo' || isRendering) return;
    const frozenSurfaces = surfaces.filter((surface) => surface.frozen);
    const sourceUrl = showProcessedPreview && processedPreview ? processedPreview : room.previewUrl;
    const materialAssignments = surfaces.filter((surface) => surface.materialId).map((surface) => {
      const assigned = materialMap.get(surface.materialId!);
      return `${surface.name}: ${assigned?.brand ? `${assigned.brand} ` : ''}${assigned?.name ?? 'materiale scelto'} (${assigned?.description ?? 'mantieni il campione selezionato'}; ${assigned ? materialReferenceLabel(assigned) : 'riferimento non disponibile'})`;
    });

    setIsRendering(true); setError(null); setRenderSummaryOpen(false);
    setNotice('Grok sta creando il render fotografico. Le aree Freeze verranno ricopiate dall’originale.');
    try {
      const { inputImage, mask } = await createMaskedInput({ frozenSurfaces, sourceUrl });
      const form = new FormData();
      form.append('image', inputImage, room.file.name.replace(/\.(heic|heif)$/i, '.png'));
      form.append('mask', mask, 'freeze-mask.png');
      form.append('materials', materialAssignments.join('\n'));
      form.append('furniture', furniture.join(', '));
      form.append('requests', customRequests.join(', '));
      form.append('protectedAreas', frozenSurfaces.map((surface) => surface.name).join(', '));
      const referenceUrl = material?.textureUrl ?? material?.productImageUrl;
      if (referenceUrl && materialAssignments.length) form.append('imageUrl', referenceUrl);
      if (materialAssignments.length) form.append('referenceType', material?.referenceKind ?? 'metadata-only');
      const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/render-room'), { method: 'POST', body: form }, 240000);
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Render non disponibile.');
      const protectedPreview = await protectAiResult(result.image, { frozenSurfaces });
      setProcessedPreview(protectedPreview); setProcessedLabel('Render finale'); setShowProcessedPreview(true);
      setActiveStep(4);
      setNotice('Render finale pronto. Puoi confrontarlo con la foto originale; le zone Freeze sono identiche.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito a creare il render.');
      setNotice(null);
    } finally {
      setIsRendering(false);
    }
  }

  function loadDemoRoom() {
    if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
    processedBlobRef.current = null;
    const file = new File(['demo'], 'stanza-vuota-con-finestra.jpg', { type: 'image/jpeg' });
    const created = createDemoSurfaces();
    setRoom({ file, kind: 'image', canPreview: true, displaySize: 'esempio incluso', projectName: 'Stanza vuota con finestra', previewUrl: '/demo-room.jpg', sourceType: 'photo' });
    setRoomRatio(16 / 10); setSurfaces(created); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(created[0].id); setRenameDraft(created[0].name); setProcessedPreview(null); setShowProcessedPreview(false); setProcessedLabel('Stanza vuota'); setError(null);
    setIsCorrectingEdges(false);
    setNotice('Esempio pronto: finestra, soffitto, pavimento e tre muri sono già riconosciuti fino ai bordi reali.');
    setActiveStep(2);
  }

  function goToStep(step: number) {
    if (step > 1 && !room) return;
    if (step > 2 && surfaces.length === 0) {
      setNotice('Prima crea o disegna almeno una superficie.');
      return;
    }
    if (step !== 2) {
      setIsCorrectingEdges(false);
      shellRef.current?.classList.remove('is-moving-vertex');
    }
    setActiveStep(step);
    if (step === 4) setRenderSummaryOpen(true);
  }

  return (
    <main ref={shellRef} className={`app-shell simple-mode step-${activeStep}`}>
      <header className="topbar">
        <a href="/projects" className="brand-lockup" aria-label="Vai ai progetti"><div className="brand-mark" aria-hidden="true"><span /><span /></div><div><p className="eyebrow">Studio materiali</p><p className="brand-name">Materia</p></div></a>
        <div className="project-heading"><span className="status-dot" /><div><p>{projectName}</p><span>{room ? `${room.sourceType === 'floorplan' ? 'Planimetria' : 'Foto'} · originale protetto` : 'Nuovo progetto locale'}</span></div></div>
        <div className="top-actions"><span className={`ai-status ${aiStatus}`}><i />{aiStatus === 'ready' ? `${aiProviderLabel ?? 'IA'} attiva` : aiStatus === 'checking' ? 'Verifica IA' : 'IA non raggiungibile'}</span><button className="avatar" type="button" aria-label="Profilo locale">AG</button></div>
      </header>

      <nav className="simple-steps" aria-label="Passaggi del progetto">{[
        ['1', 'Foto'], ['2', 'Prepara'], ['3', 'Prodotti'], ['4', 'Render'],
      ].map(([number, label], index) => <button type="button" key={number} className={activeStep === index + 1 ? 'is-active' : activeStep > index + 1 ? 'is-done' : ''} onClick={() => goToStep(index + 1)} disabled={(index > 0 && !room) || (index > 1 && surfaces.length === 0)}><span>{activeStep > index + 1 ? '✓' : number}</span><strong>{label}</strong></button>)}</nav>

      <div className="workspace">
        <aside className="surface-panel" aria-label="Superfici della stanza">
          <div className="panel-heading"><div><p className="eyebrow">Aree riconosciute</p><h2>Tocca cosa vuoi mantenere</h2></div><span className="count-badge">{surfaces.length}</span></div>
          <button className="detect-button" type="button" onClick={() => void autoFitSurfaces()} disabled={!room || room.sourceType !== 'photo' || isAutoFitting}><span className="spark">✦</span>{isAutoFitting ? 'Sto adattando…' : 'Adatta automaticamente'}<span className="soon">Foto</span></button>
          {surfaces.length ? <div className="surface-list">{surfaces.map((surface) => <button className={`surface-item ${surface.id === selectedId ? 'is-active' : ''}`} key={surface.id} type="button" onClick={() => { setSelectedId(surface.id); setRenameDraft(surface.name); setDrawKind(null); setQuickDraw(false); setDraft([]); }}><span className="surface-swatch" style={{ background: kindColors[surface.kind] }} /><span className="surface-copy"><strong>{surface.name}</strong><small>{surface.frozen ? 'Freeze attivo' : surface.materialId ? 'Prodotto applicato' : 'Tocca per selezionare'}</small></span><span className="lock-state" aria-label={surface.frozen ? 'Bloccata' : 'Modificabile'}>{surface.frozen ? '🔒' : '◇'}</span></button>)}</div> : <div className="surface-empty"><span>✦</span><strong>Riconoscimento automatico</strong><p>L’app divide la foto in pavimento, muri e soffitto.</p></div>}
          {selected && activeStep === 2 && <div className="simple-freeze-actions"><button type="button" className={selected.frozen ? 'is-frozen' : ''} onClick={toggleFreeze}>{selected.frozen ? `Consenti modifiche a ${selected.name}` : `Mantieni identico ${selected.name}`}</button><button type="button" onClick={freezeAllExceptSelected}>Mantieni tutto tranne questa</button><p>Freeze significa: questa zona non viene rigenerata dall’IA.</p></div>}
          <div className="panel-note"><span>i</span><p>Automatico per iniziare, manuale per rifinire: trascina i pallini direttamente sui bordi della foto.</p></div>
        </aside>

        <section className="stage" aria-labelledby="editor-title">
          <div className="editor-toolbar">
            <div className="tool-group"><button className={`tool-button ${!drawKind ? 'is-selected' : ''}`} type="button" onClick={cancelDrawing} aria-label="Seleziona">↖</button><button className="tool-button history-button" type="button" onClick={undo} disabled={!pastSurfaces.length} aria-label="Annulla ultima modifica">↶</button><button className="tool-button history-button" type="button" onClick={redo} disabled={!futureSurfaces.length} aria-label="Ripristina modifica">↷</button>{room?.sourceType === 'photo' && <button className="draw-button auto-fit-button" type="button" onClick={() => void autoFitSurfaces()} disabled={!room || isAutoFitting}>✦ {isAutoFitting ? 'Adatto…' : 'Adatta alla foto'}</button>}{room?.sourceType === 'floorplan' ? <button className={`draw-button easy-draw-button ${lineWallDraw ? 'is-selected' : ''}`} type="button" onClick={startFloorplanWall}>＋ Parete con 2 tocchi</button> : <button className={`draw-button easy-draw-button ${quickDraw ? 'is-selected' : ''}`} type="button" onClick={() => startDrawing('wall', true)} disabled={!room}>＋ Aggiungi muro</button>}</div>
            {drawKind ? <div className="drawing-actions"><span>{lineWallDraw ? `${draft.length}/2 punti` : `${draft.length}/4 angoli`}</span><button type="button" onClick={cancelDrawing}>Annulla</button></div> : <span className="mode-label">{selected ? `Trascina i pallini di ${selected.name}` : room?.sourceType === 'floorplan' ? 'Aggiungi le pareti interne con due tocchi' : room ? 'Adatta automaticamente o trascina i pallini a mano' : 'Carica una foto o una planimetria per iniziare'}</span>}
          </div>

          <div className="canvas-wrap"><div className={`canvas ${isDraggingFile ? 'is-dragging' : ''}`} id="editor-title" style={room ? { aspectRatio: roomRatio } : undefined} onDragEnter={() => setIsDraggingFile(true)} onDragLeave={() => setIsDraggingFile(false)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            {room?.previewUrl ? <div className="editor-media">
              <img ref={roomImageRef} src={showProcessedPreview && processedPreview ? processedPreview : room.previewUrl} alt={showProcessedPreview ? `Anteprima elaborata: ${processedLabel}` : `Originale importato: ${room.file.name}`} onLoad={(event) => onRoomImageLoad(event.currentTarget)} />
              <svg className={`surface-overlay ${drawKind ? 'is-drawing' : ''} ${isCorrectingEdges ? 'is-correcting' : ''}`} viewBox="0 0 1000 625" preserveAspectRatio="none" onPointerDown={addDraftPoint} onPointerMove={moveDraggedVertex} onPointerUp={endVertexDrag} onPointerCancel={endVertexDrag}>
                <defs>
                  {catalogMaterials.filter((item) => item.pattern).map((item) => <pattern id={`catalog-material-${item.id}`} key={item.id} width={item.pattern === 'wood' ? 180 : 120} height={item.pattern === 'wood' ? 42 : 120} patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill={item.color} /><path d={item.pattern === 'wood' ? 'M0 2H180 M0 40H180 M45 2V40 M135 2V40' : 'M0 1H120 M1 0V120'} stroke="rgba(67,55,43,.22)" strokeWidth="3" /><path d={item.pattern === 'stone' ? 'M8 38 C38 17 64 55 110 25 M14 92 C45 68 77 106 116 74' : ''} fill="none" stroke="rgba(255,255,255,.24)" strokeWidth="5" /></pattern>)}
                  {material?.previewUrl && <pattern id={`uploaded-material-${material.id}`} width="140" height="140" patternUnits="userSpaceOnUse"><image href={material.previewUrl} width="140" height="140" preserveAspectRatio="xMidYMid slice" /></pattern>}
                </defs>
                {surfaces.map((surface) => {
                  const labelPoint = surfaceLabelPoint(surface);
                  const showLabel = surface.kind === 'window' || surface.kind === 'door';
                  return <g key={surface.id} className={`surface-kind-${surface.kind} ${surface.frozen ? 'is-frozen ' : ''}${surface.id === selectedId ? 'is-selected-surface' : ''}`}><polygon points={pointsToSvg(surface.points)} fill={materialFill(surface)} stroke={surface.id === selectedId ? '#d7f05c' : kindColors[surface.kind]} strokeWidth={surface.id === selectedId ? 6 : 3} vectorEffect="non-scaling-stroke" onPointerDown={(event) => { if (!drawKind) { event.stopPropagation(); setSelectedId(surface.id); setRenameDraft(surface.name); setQuickDraw(false); } }} />{showLabel && <text className="surface-name" x={labelPoint.x * 1000} y={labelPoint.y * 625}>{surface.name}</text>}{isCorrectingEdges && !surface.frozen && surface.id === selectedId && surface.points.map((point, index) => <g key={`${surface.id}-${index}`}><circle cx={point.x * 1000} cy={point.y * 625} r="32" className="surface-vertex-hit" onPointerDown={(event) => beginVertexDrag(event, surface.id, index)} /><circle cx={point.x * 1000} cy={point.y * 625} r="14" className="surface-vertex" aria-hidden="true" /></g>)}</g>;
                })}
                {draft.length > 0 && <><polyline points={pointsToSvg(draft)} fill="none" stroke="#d7f05c" strokeWidth="5" vectorEffect="non-scaling-stroke" />{draft.map((point, index) => <circle key={index} cx={point.x * 1000} cy={point.y * 625} r="9" className="draft-vertex" />)}</>}
              </svg><div className="import-status"><span className="status-dot" /><div><strong>{showProcessedPreview ? processedLabel : 'Originale intatto'}</strong><small>{showProcessedPreview ? 'Elaborazione IA · originale sempre disponibile' : importedCaption}</small></div></div>
              {processedPreview && <div className="before-after-toggle" aria-label="Confronta originale e risultato"><button type="button" className={!showProcessedPreview ? 'is-active' : ''} onClick={() => setShowProcessedPreview(false)}>Originale</button><button type="button" className={showProcessedPreview ? 'is-active' : ''} onClick={() => setShowProcessedPreview(true)}>{processedLabel}</button></div>}
            </div> : <><div className="room-demo" aria-label="Anteprima schematica della stanza"><div className="room-ceiling"><span>Soffitto</span></div><div className="room-wall left"><span>Muro 2</span></div><div className="room-wall center"><span>Muro 1</span></div><div className="room-wall right"><span>Muro 3</span></div><div className="room-floor"><span>Pavimento</span></div></div><div className="upload-card"><div className="upload-icon">↑</div><p className="eyebrow">Inizia da ciò che hai</p><h1>Cosa vuoi caricare?</h1><p>Scegli una foto della stanza oppure una planimetria. L’originale resterà sempre intatto.</p><div className="source-actions"><label className="source-card is-primary" htmlFor="room-file"><span>▣</span><strong>Foto stanza</strong><small>Apri direttamente Foto su iPhone e iPad</small></label><label className="source-card" htmlFor="floorplan-file"><span>⌗</span><strong>Planimetria</strong><small>Ricalca perimetro e pareti interne</small></label></div><button className="demo-button" type="button" onClick={loadDemoRoom}>Prova con la stanza esempio</button><small>JPG, PNG o HEIC · massimo 20 MB</small></div></>}
            {isDraggingFile && <div className="drop-overlay"><strong>Rilascia per importare</strong><span>La foto resterà nel browser.</span></div>}
            {isImportingRoom && <div className="processing-overlay" role="status"><span className="processing-spinner" /><strong>Preparo la foto…</strong><small>Le immagini grandi vengono ottimizzate per evitare blocchi.</small></div>}
          </div>{error && <div className="file-error" role="alert"><strong>Operazione non completata</strong><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Chiudi errore">×</button></div>}</div>
          <input ref={roomInputRef} id="room-file" className="visually-hidden" type="file" accept="image/*,.heic,.heif" onChange={onRoomInput} /><input ref={floorplanInputRef} id="floorplan-file" className="visually-hidden" type="file" accept="image/*,.heic,.heif" onChange={onFloorplanInput} /><input ref={materialInputRef} id="material-file" className="visually-hidden" type="file" accept="image/jpeg,image/png" onChange={onMaterialInput} />
          {room?.sourceType === 'photo' && activeStep === 2 && <section className="empty-room-choice" aria-label="Svuota la stanza"><div><strong>Vuoi svuotare la stanza?</strong><span>Opzionale: rimuove mobili e decorazioni lasciando intatta la struttura.</span></div><button className="empty-room-button" type="button" onClick={() => void emptyRoom()} disabled={isEmptyingRoom}>{isEmptyingRoom ? 'Svuoto la stanza…' : processedLabel === 'Stanza vuota' && processedPreview ? '↻ Rigenera stanza vuota' : '⌂ Svuota la stanza'}</button></section>}
          <div className={`status-bar ${activeStep === 2 ? 'prepare-status' : ''}`}><span className="status-icon">{notice ? '✓' : 'i'}</span><p>{notice ?? 'Carica la foto, scegli cosa mantenere e poi cerca il prodotto.'}</p>{room && activeStep === 2 && <button className={`edge-edit-button ${isCorrectingEdges ? 'is-active' : ''}`} type="button" onClick={toggleEdgeCorrection}>{isCorrectingEdges ? '✓ Fine correzione' : room.sourceType === 'floorplan' ? 'Correggi il perimetro' : 'Correggi i bordi'}</button>}{room?.sourceType === 'floorplan' && activeStep === 2 && !drawKind && <button type="button" onClick={startFloorplanWall}>Aggiungi parete interna</button>}{room && surfaces.length > 0 && activeStep === 4 && <button className="render-flow-button" type="button" aria-label="Prova flusso render" onClick={() => setRenderSummaryOpen(true)}>Controlla e crea render</button>}{activeStep === 2 && surfaces.length > 0 && <button className="continue-products-button" type="button" onClick={() => goToStep(3)}>Continua ai prodotti</button>}{activeStep === 3 && <button className="render-flow-button" type="button" aria-label="Prova flusso render" onClick={() => goToStep(4)}>Continua: crea render</button>}</div>
        </section>

        <aside className="properties-panel" aria-label="Proprietà">
          <div className="panel-heading"><div><p className="eyebrow">Controlli</p><h2>{selected?.name ?? (room ? 'Nessuna selezione' : 'Importa una stanza')}</h2></div>{selected && <span className="type-badge">{surfaceLabels[selected.kind]}</span>}</div>
          {room && <div className="asset-card"><span>{room.sourceType === 'floorplan' ? 'PLAN' : 'IMG'}</span><div><strong>{room.file.name}</strong><small>{room.sourceType === 'floorplan' ? 'Planimetria originale' : importedCaption}</small></div><label htmlFor={room.sourceType === 'floorplan' ? 'floorplan-file' : 'room-file'}>Sostituisci</label></div>}
          {selected ? <><div className="property-section"><div className="property-title"><span>Nome superficie</span><span className="editable-badge">Personalizzabile</span></div><div className="rename-control"><input aria-label="Nome superficie" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} /><button type="button" onClick={renameSelected} disabled={!renameDraft.trim() || renameDraft.trim() === selected.name}>Salva</button></div></div><div className="property-section"><div className="property-title"><span>Protezione superficie</span><span className={`editable-badge ${selected.frozen ? 'frozen' : ''}`}>{selected.frozen ? 'Frozen' : 'Modificabile'}</span></div><button className={`freeze-button ${selected.frozen ? 'is-active' : ''}`} type="button" aria-label={selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'} onClick={toggleFreeze}><span>{selected.frozen ? '◆' : '◇'}</span>{selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'}<small>{selected.frozen ? 'Protetta' : 'Attivo subito'}</small></button><button className="freeze-others-button" type="button" onClick={freezeAllExceptSelected}>Blocca tutto tranne {selected.name}</button></div>
            <div className="property-section product-search-section">
              <div className="property-title"><span>Cerca un prodotto preciso</span><button type="button" onClick={() => materialInputRef.current?.click()}>Carica campione</button></div>
              {aiStatus !== 'ready' && <div className="ai-setup-banner"><strong>IA momentaneamente non raggiungibile</strong><span>La chiave resta protetta sul server. Puoi comunque premere il comando: l’app riproverà il collegamento.</span></div>}
              <div className="online-search-control"><input className="material-search" aria-label="Cerca materiali, colori o mobili" value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchProductsOnline(); }} placeholder="Es. Intense Lea white materico" /><button type="button" onClick={() => void searchProductsOnline()} disabled={isSearchingProducts}>{isSearchingProducts ? 'Cerco…' : `Cerca con ${aiProviderLabel ?? 'IA'}`}</button></div>
              <div className="search-scope"><span>Materiali</span><span>Colori</span><span>Arredi</span><span className="internet-ready">Prodotti reali con fonte</span></div>
              {onlineMaterials.length > 0 && <div className="online-results"><strong>Risultati online</strong>{onlineMaterials.map((item) => <div className={`online-product ${material?.id === item.id ? 'is-selected' : ''}`} key={item.id}>{item.previewUrl ? <img src={item.previewUrl} alt={`Riferimento ${item.name}`} /> : <span className="catalog-swatch tile" /> }<button type="button" onClick={() => chooseMaterial(item)}><strong>{item.brand} · {item.name}</strong><span className={`reference-badge reference-${item.referenceKind ?? 'metadata-only'}`}>{materialReferenceLabel(item)}</span><small>{item.description}</small></button><a href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte</a></div>)}</div>}
              <div className="material-results">{filteredMaterials.map((item) => <button type="button" key={item.id} className={`material-result ${material?.id === item.id ? 'is-selected' : ''}`} onClick={() => chooseMaterial(item)}><span className={`catalog-swatch ${item.pattern ?? 'color'}`} style={{ '--swatch-color': item.color } as CSSProperties} /><span><strong>{item.name}</strong><small>{item.category} · {item.description}</small></span></button>)}{filteredFurniture.map((item) => <button type="button" key={item.name} className={`material-result furniture-result ${furniture.includes(item.name) ? 'is-selected' : ''}`} onClick={() => toggleFurniture(item.name)}><span className="furniture-icon">{furniture.includes(item.name) ? '✓' : '+'}</span><span><strong>{item.name}</strong><small>Mobili · {item.description}</small></span></button>)}{filteredMaterials.length === 0 && filteredFurniture.length === 0 && onlineMaterials.length === 0 && <div className="custom-search-result"><p>Nessun campione incluso corrisponde. Per trovare marca e prodotto esatti serve la ricerca IA attiva.</p><button type="button" onClick={addCustomRequest}>Aggiungi “{materialQuery.trim()}” alla richiesta</button></div>}</div>
              <div className="custom-color"><input type="color" aria-label="Scegli colore personalizzato" value={customColor} onChange={(event) => setCustomColor(event.target.value)} /><button type="button" onClick={chooseCustomColor}>Usa questo colore</button></div>
              {material && <div className="loaded-material">{material.previewUrl ? <img src={material.previewUrl} alt={`Campione ${material.name}`} /> : <span className="catalog-swatch tile" />}<div><strong>{material.name}</strong><small>{materialReferenceLabel(material)}</small></div></div>}
              <button className="auto-apply-product-button" type="button" onClick={() => void applyMaterialAutomatically()} disabled={!material || isApplyingProduct}>{isApplyingProduct ? 'Adatto il prodotto alla stanza…' : material?.referenceKind === 'metadata-only' ? `Prova resa indicativa di ${material.name}` : `Applica automaticamente ${material?.name ?? 'il prodotto'}`}</button>
              <button className="apply-button secondary-apply" type="button" aria-label={`Applica a ${selected.name}`} onClick={applyMaterial} disabled={!material || selected.frozen}>Oppure applica solo a {selected.name}</button>
              <p className="material-search-note">L’app sceglie pavimento o muro, corregge prospettiva e scala, e lascia identiche tutte le zone Freeze. La resa è fedele al prodotto solo quando compare “Texture ufficiale verificata” o usi un tuo campione.</p>
            </div>
            <div className="property-section"><div className="property-title"><span>Elementi nel render</span><span className="editable-badge">{furniture.length + customRequests.length} scelti</span></div>{furniture.length || customRequests.length ? <div className="selected-assets">{furniture.map((item) => <button type="button" key={item} onClick={() => toggleFurniture(item)}>{item}<span>×</span></button>)}{customRequests.map((item) => <button type="button" key={item} onClick={() => setCustomRequests((current) => current.filter((name) => name !== item))}>{item}<span>×</span></button>)}</div> : <p className="no-results">Cerca un mobile o scrivi liberamente ciò che vuoi inserire.</p>}<p className="material-search-note">Con il motore AI potrai caricare anche la foto esatta del mobile e indicarne la posizione.</p></div>
            <div className="property-section metrics"><div><span>Vertici</span><strong>{selected.points.length}</strong></div><div><span>Stato</span><strong>{selected.frozen ? 'Lock' : 'Edit'}</strong></div><div><span>Texture</span><strong>{selected.materialId ? 'Sì' : 'No'}</strong></div></div><button className="remove-button" type="button" onClick={deleteSelected} disabled={selected.frozen}>Elimina superficie</button></> : room ? <div className="empty-properties"><strong>Seleziona un contorno</strong><p>Tocca una superficie sulla foto o sceglila dall’elenco. Puoi anche disegnarne una nuova.</p></div> : null}
          {room && <button className="remove-room-button" type="button" onClick={removeRoom}>Chiudi progetto</button>}
          <div className="phase-card"><span className="phase-index">0.3</span><div><p className="eyebrow">Modalità prova</p><strong>IA e Freeze pronti</strong><p>Ricerca prodotti, stanza vuota e render vengono elaborati dal server senza mostrare chiavi nell’app.</p></div></div>
        </aside>
      </div>
      {renderSummaryOpen && <div className="render-modal" role="dialog" aria-modal="true" aria-labelledby="render-summary-title"><div className="render-modal-card"><button className="modal-close" type="button" onClick={() => setRenderSummaryOpen(false)} aria-label="Chiudi riepilogo">×</button><p className="eyebrow">Richiesta pronta</p><h2 id="render-summary-title">Crea il render reale</h2><div className="render-checks"><div><span>Superfici con materiale</span><strong>{surfaces.filter((surface) => surface.materialId).length}</strong></div><div><span>Zone protette</span><strong>{surfaces.filter((surface) => surface.frozen).length}</strong></div><div><span>Elementi richiesti</span><strong>{furniture.length + customRequests.length}</strong></div></div><div className="render-list"><strong>Il motore riceverà:</strong><p>{surfaces.filter((surface) => surface.materialId).map((surface) => `${surface.name}: ${materialMap.get(surface.materialId!)?.name ?? 'materiale'}`).join(' · ') || 'Nessun materiale ancora applicato'}</p><p>{furniture.length || customRequests.length ? `Da inserire: ${[...furniture, ...customRequests].join(', ')}` : 'Nessun arredo aggiunto'}</p></div><div className="engine-warning"><span>AI</span><p><strong>{aiStatus === 'ready' ? `${aiProviderLabel ?? 'IA'} attiva` : 'L’app riproverà il collegamento'}</strong>La foto sarà elaborata dal server; al termine le aree Freeze verranno ricopiate dall’originale.</p></div><button className="modal-primary" type="button" onClick={() => void createFinalRender()} disabled={isRendering}>{isRendering ? 'Creo il render…' : 'Crea render reale con IA'}</button><button className="modal-secondary" type="button" onClick={() => setRenderSummaryOpen(false)}>Torna alle modifiche</button></div></div>}
    </main>
  );
}
