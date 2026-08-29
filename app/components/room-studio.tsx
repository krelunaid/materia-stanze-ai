'use client';

/* eslint-disable @next/next/no-img-element -- room and material previews are local blob URLs */

import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { drawImageCover } from '../lib/canvas-draw';
import { AcceptedRoomFile, formatBytes, validateRoomFile } from '../lib/file-validation';
import { furnitureEditRect, hasCompatibleImageGeometry, rectPoints } from '../lib/render-geometry';
import { NormalizedProductBounds, removeConnectedProductBackground } from '../lib/product-cutout';
import { geometryForDerivedImage } from '../geometry/model';
import { buildStoredProject, loadProject, saveProject } from '../geometry/project-store';
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
type LinkedVertex = { surfaceId: string; vertexIndex: number };
type DragVertex = { surfaceId: string; vertexIndex: number; pointerId: number; origin: Point; linked: LinkedVertex[] };
type FurnitureFacing = 'front-wall' | 'left-wall' | 'right-wall';
type PlacedFurniture = {
  id: string;
  name: string;
  x: number;
  y: number;
  scale: number;
  autoScale: boolean;
  facing: FurnitureFacing;
  frozen: boolean;
  previewUrl?: string;
  sidePreviewUrl?: string;
  cutoutUrl?: string;
  description?: string;
};
type PendingFurniture = { name: string; previewUrl?: string; sidePreviewUrl?: string; cutoutUrl?: string; description?: string; file?: File };
type DragFurniture = { id: string; pointerId: number };
type CleanupRegion = { label: string; points: Point[]; confidence: number };
type AiStatus = 'checking' | 'ready' | 'missing' | 'unreachable';
type DetectedSurface = { name: string; kind: SurfaceKind; points: Point[]; confidence: number };
type ProductSearchCategory = '' | StudioMaterial['category'];

const HOSTED_SITE = 'https://materia-stanze-ai.andreagadducci.chatgpt.site';
const EMPTY_ROOM_FRAMING_MIN = .64;

const furnitureFacingLabels: Record<FurnitureFacing, string> = {
  'front-wall': 'Muro frontale',
  'left-wall': 'Muro sinistro',
  'right-wall': 'Muro destro',
};

const furnitureFacingInstructions: Record<FurnitureFacing, string> = {
  'front-wall': 'floor-plane yaw: back parallel to the front wall, front facing the camera; never roll or tilt',
  'left-wall': 'floor-plane yaw: back parallel to the left wall, front facing the room center; never roll or tilt',
  'right-wall': 'floor-plane yaw: back parallel to the right wall, front facing the room center; never roll or tilt',
};

function furnitureWidthHeightRatio(description?: string) {
  if (!description) return undefined;
  const width = description.match(/(?:^|[·\s])L\s*([\d.,]+)\s*cm/i);
  const height = description.match(/(?:^|[·\s])H\s*([\d.,]+)\s*cm/i);
  if (!width || !height) return undefined;
  const parsedWidth = Number(width[1].replace(',', '.'));
  const parsedHeight = Number(height[1].replace(',', '.'));
  const ratio = parsedWidth / parsedHeight;
  return Number.isFinite(ratio) && ratio > 1 && ratio < 12 ? ratio : undefined;
}

function furnitureBaseScale(name: string, description?: string) {
  const normalized = `${name} ${description ?? ''}`.toLocaleLowerCase('it');
  const width = description?.match(/(?:^|[·\s])L\s*([\d.,]+)\s*cm/i);
  if (width) {
    const measuredWidth = Number(width[1].replace(',', '.'));
    if (Number.isFinite(measuredWidth)) return Math.min(46, Math.max(14, measuredWidth / 6.2));
  }
  if (/divano|sofa/.test(normalized)) return 40;
  if (/letto/.test(normalized)) return 36;
  if (/tavolo/.test(normalized)) return 32;
  if (/tappeto|cucina/.test(normalized)) return 38;
  if (/armadio|mobile tv/.test(normalized)) return 28;
  if (/poltrona|sedia|sedie/.test(normalized)) return 20;
  if (/lampada/.test(normalized)) return 14;
  return 25;
}

function perspectiveFurnitureScale(name: string, description: string | undefined, y: number, floorContact: number) {
  const depth = Math.min(1, Math.max(0, (y - floorContact) / Math.max(.08, .96 - floorContact)));
  return Math.round(Math.min(55, Math.max(12, furnitureBaseScale(name, description) * (.84 + depth * .34))) * 10) / 10;
}

function isNativeApp() {
  return typeof window !== 'undefined' && window.location.protocol === 'capacitor:';
}

function isLocalPreview() {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function isAppleTouchDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function studioEndpoint(path: string) {
  return isNativeApp() ? `${HOSTED_SITE}${path}` : path;
}

const catalogMaterials: StudioMaterial[] = [
  { id: 'oak-natural', name: 'Rovere naturale', category: 'Pavimenti', description: 'Doghe grandi · effetto legno', color: '#b88d5f', pattern: 'wood' },
  { id: 'oak-light', name: 'Rovere chiaro', category: 'Pavimenti', description: '20 × 120 cm · poco giallo', color: '#d4b98f', pattern: 'wood' },
  { id: 'travertine', name: 'Travertino beige', category: 'Rivestimenti', description: '60 × 120 cm · opaco', color: '#d8c6aa', pattern: 'stone' },
  { id: 'concrete', name: 'Cemento grigio', category: 'Rivestimenti', description: '90 × 90 cm · materico', color: '#aaa9a3', pattern: 'tile' },
  { id: 'wall-sage', name: 'Verde salvia', category: 'Colori', description: 'Pittura murale opaca', color: '#9eab96' },
  { id: 'wall-linen', name: 'Bianco lino', category: 'Colori', description: 'Pittura murale calda', color: '#e9e2d4' },
  { id: 'wall-clay', name: 'Terra rosata', category: 'Colori', description: 'Pittura minerale', color: '#c9957f' },
];

const furnitureCatalog: Array<{ name: string; description: string; previewUrl?: string; sidePreviewUrl?: string }> = [
  { name: 'Divano chiaro', description: 'Soggiorno · tessuto', previewUrl: '/demo-sofa.png', sidePreviewUrl: '/demo-sofa-side.png' },
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
  if (item.category === 'Arredi' && !item.previewUrl) return 'Foto prodotto non disponibile';
  if (item.referenceKind === 'verified-texture') return 'Texture ufficiale verificata';
  if (item.referenceKind === 'official-product-image') return item.official ? 'Foto prodotto ufficiale' : 'Foto prodotto verificata';
  if (item.referenceKind === 'uploaded-sample') return 'Campione caricato da te';
  return item.sourceUrl ? 'Prodotto verificato · serve una texture' : 'Campione incluso';
}

function requiresVerifiedSurfaceSample(item: StudioMaterial | null | undefined) {
  return Boolean(item
    && item.sourceUrl
    && item.category !== 'Arredi'
    && item.category !== 'Colori'
    && item.referenceKind !== 'verified-texture'
    && item.referenceKind !== 'uploaded-sample');
}

function surfaceLabelPoint(surface: Surface) {
  return surface.points.reduce((center, point) => ({ x: center.x + point.x / surface.points.length, y: center.y + point.y / surface.points.length }), { x: 0, y: 0 });
}

function surfaceCenter(surface: Surface) {
  return surfaceLabelPoint(surface);
}

function floorContactYAtX(surface: Surface | undefined, x: number) {
  if (!surface || surface.points.length < 3) return .58;
  const intersections: number[] = [];
  for (let index = 0; index < surface.points.length; index += 1) {
    const first = surface.points[index];
    const second = surface.points[(index + 1) % surface.points.length];
    if ((first.x <= x && second.x >= x) || (second.x <= x && first.x >= x)) {
      if (Math.abs(second.x - first.x) < .0001) continue;
      const ratio = (x - first.x) / (second.x - first.x);
      if (ratio >= 0 && ratio <= 1) intersections.push(first.y + (second.y - first.y) * ratio);
    }
  }
  return intersections.length ? Math.min(...intersections) : Math.min(...surface.points.map((point) => point.y));
}

function inheritSurfaceState(detected: Surface[], previous: Surface[]) {
  const unmatched = [...previous];
  return detected.map((surface) => {
    const exactIndex = unmatched.findIndex((candidate) => candidate.kind === surface.kind
      && candidate.name.toLocaleLowerCase('it') === surface.name.toLocaleLowerCase('it'));
    const center = surfaceCenter(surface);
    let matchIndex = exactIndex;
    if (matchIndex < 0) {
      let bestDistance = Number.POSITIVE_INFINITY;
      unmatched.forEach((candidate, index) => {
        if (candidate.kind !== surface.kind) return;
        const candidateCenter = surfaceCenter(candidate);
        const distance = Math.hypot(center.x - candidateCenter.x, center.y - candidateCenter.y);
        if (distance < bestDistance) { bestDistance = distance; matchIndex = index; }
      });
      if (bestDistance > .3) matchIndex = -1;
    }
    if (matchIndex < 0) return surface;
    const match = unmatched.splice(matchIndex, 1)[0];
    return { ...surface, id: match.id, frozen: match.frozen, materialId: match.materialId };
  });
}

export function mergeDetectedSurfaces(detected: Surface[], previous: Surface[]) {
  const frozenSurfaces = previous.filter((surface) => surface.frozen);
  const editableSurfaces = previous.filter((surface) => !surface.frozen);
  const editableDetected = detected.filter((surface) => !frozenSurfaces.some((frozen) => {
    if (surface.kind !== frozen.kind) return false;
    if (surface.name.toLocaleLowerCase('it') === frozen.name.toLocaleLowerCase('it')) return true;
    const center = surfaceCenter(surface);
    const frozenCenter = surfaceCenter(frozen);
    return Math.hypot(center.x - frozenCenter.x, center.y - frozenCenter.y) < .22;
  }));
  return [...inheritSurfaceState(editableDetected, editableSurfaces), ...frozenSurfaces];
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
    let bitmap: ImageBitmap | null = null;
    try {
      const maximumSide = isAppleTouchDevice() ? 1280 : 1800;
      if (typeof createImageBitmap === 'function') {
        try {
          // Decode camera photos already resized: decoding a full 12–48 MP
          // iPhone image before shrinking can terminate the iOS WebView.
          bitmap = await createImageBitmap(file, {
            resizeWidth: maximumSide,
            resizeQuality: 'high',
            imageOrientation: 'from-image',
          });
        } catch {
          bitmap = null;
        }
      }

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('encode');

      if (bitmap) {
        const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } else {
        const image = new Image();
        image.decoding = 'async';
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('timeout')), 15000);
          image.onload = () => { window.clearTimeout(timer); resolve(); };
          image.onerror = () => { window.clearTimeout(timer); reject(new Error('decode')); };
          image.src = sourceUrl;
        });
        const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }

      const optimized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .88));
      if (!optimized) throw new Error('encode');
      return URL.createObjectURL(optimized);
    } finally {
      bitmap?.close();
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

async function framingSimilarity(originalSource: string, generatedSource: string) {
  const [original, generated] = await Promise.all([
    loadImageSource(originalSource),
    loadImageSource(generatedSource),
  ]);
  const width = 96; const height = 64;
  const originalCanvas = document.createElement('canvas');
  const generatedCanvas = document.createElement('canvas');
  originalCanvas.width = generatedCanvas.width = width;
  originalCanvas.height = generatedCanvas.height = height;
  const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
  const generatedContext = generatedCanvas.getContext('2d', { willReadFrequently: true });
  if (!originalContext || !generatedContext) return 0;
  drawImageCover(originalContext, original, width, height);
  drawImageCover(generatedContext, generated, width, height);
  const originalPixels = originalContext.getImageData(0, 0, width, height).data;
  const generatedPixels = generatedContext.getImageData(0, 0, width, height).data;
  let difference = 0; let gradientDifference = 0; let samples = 0;
  const luminance = (pixels: Uint8ClampedArray, offset: number) => pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722;

  // Furniture usually occupies the lower centre. The top and outside borders
  // instead contain the architectural anchors that must not move or disappear.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (y >= height * .38 && x >= width * .1 && x <= width * .9) continue;
      const offset = (y * width + x) * 4;
      difference += (
        Math.abs(originalPixels[offset] - generatedPixels[offset])
        + Math.abs(originalPixels[offset + 1] - generatedPixels[offset + 1])
        + Math.abs(originalPixels[offset + 2] - generatedPixels[offset + 2])
      ) / (3 * 255);
      if (x + 1 < width && y + 1 < height) {
        const right = offset + 4; const below = offset + width * 4;
        const originalGradient = Math.hypot(luminance(originalPixels, right) - luminance(originalPixels, offset), luminance(originalPixels, below) - luminance(originalPixels, offset));
        const generatedGradient = Math.hypot(luminance(generatedPixels, right) - luminance(generatedPixels, offset), luminance(generatedPixels, below) - luminance(generatedPixels, offset));
        gradientDifference += Math.min(1, Math.abs(originalGradient - generatedGradient) / 96);
      }
      samples += 1;
    }
  }
  if (!samples) return 0;
  const colorSimilarity = 1 - difference / samples;
  const edgeSimilarity = 1 - gradientDifference / samples;
  return colorSimilarity * .42 + edgeSimilarity * .58;
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
    if (isNativeApp()) headers.set('X-Materia-Client', 'capacitor-ios');
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
  const [searchBrand, setSearchBrand] = useState('');
  const [searchModel, setSearchModel] = useState('');
  const [searchColor, setSearchColor] = useState('');
  const [searchCategory, setSearchCategory] = useState<ProductSearchCategory>('');
  const [searchSourceUrl, setSearchSourceUrl] = useState('');
  const [onlineMaterials, setOnlineMaterials] = useState<StudioMaterial[]>([]);
  const [placedFurniture, setPlacedFurniture] = useState<PlacedFurniture[]>([]);
  const [pendingFurniture, setPendingFurniture] = useState<PendingFurniture | null>(null);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  const [dragFurniture, setDragFurniture] = useState<DragFurniture | null>(null);
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
  const [isPickingCleanup, setIsPickingCleanup] = useState(false);
  const [isDetectingCleanup, setIsDetectingCleanup] = useState(false);
  const [isCleaningRegion, setIsCleaningRegion] = useState(false);
  const [cleanupRegion, setCleanupRegion] = useState<CleanupRegion | null>(null);
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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const floorplanInputRef = useRef<HTMLInputElement>(null);
  const materialInputRef = useRef<HTMLInputElement>(null);
  const furnitureInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const surfaceOverlayRef = useRef<SVGSVGElement>(null);
  const roomBlobRef = useRef<string | null>(null);
  const materialBlobRef = useRef<string | null>(null);
  const furnitureBlobUrlsRef = useRef<string[]>([]);
  const furnitureFilesRef = useRef<Map<string, File>>(new Map());
  const furnitureIdRef = useRef(0);
  const processedBlobRef = useRef<string | null>(null);
  const dragStartRef = useRef<Surface[] | null>(null);
  const roomImageRef = useRef<HTMLImageElement>(null);
  const autoFitPreviewRef = useRef<string | null>(null);
  const originalSurfacesRef = useRef<Surface[]>([]);
  const processedSurfacesRef = useRef<Surface[] | null>(null);
  const projectIdRef = useRef('draft');
  const skipAutosaveRef = useRef(false);

  useEffect(() => {
    shellRef.current?.setAttribute('data-hydrated', 'true');
    return () => {
      if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
      if (materialBlobRef.current) URL.revokeObjectURL(materialBlobRef.current);
      if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
      furnitureBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    void fetch(studioEndpoint('/api/capabilities'), { cache: 'no-store', signal: controller.signal })
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
    const params = new URLSearchParams(window.location.search);
    const id = params.get('project');
    if (!id) return;
    let cancelled = false;
    skipAutosaveRef.current = true;
    void loadProject(id)
      .then((project) => {
        if (cancelled || !project) return;
        projectIdRef.current = project.id;
        const previewUrl = URL.createObjectURL(project.original);
        if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
        roomBlobRef.current = previewUrl;
        const file = new File([project.original], project.fileName, { type: project.mime || 'image/jpeg' });
        setRoom({
          file,
          kind: 'image',
          canPreview: true,
          displaySize: formatBytes(project.original.size),
          projectName: project.title,
          previewUrl,
          sourceType: project.sourceType,
        });
        originalSurfacesRef.current = project.originalSurfaces;
        processedSurfacesRef.current = project.processedSurfaces;
        setSurfaces(project.geometry.surfaces);
        setPastSurfaces([]);
        setFutureSurfaces([]);
        const preferred = project.geometry.surfaces.find((surface) => surface.kind === 'floor')
          ?? project.geometry.surfaces[0]
          ?? null;
        setSelectedId(preferred?.id ?? null);
        setRenameDraft(preferred?.name ?? '');
        if (project.processed) {
          const processedUrl = URL.createObjectURL(project.processed);
          if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
          processedBlobRef.current = processedUrl;
          setProcessedPreview(processedUrl);
          setProcessedLabel(project.processedLabel);
          setShowProcessedPreview(Boolean(project.processedSurfaces?.length));
        }
        autoFitPreviewRef.current = previewUrl;
        setActiveStep(2);
        setNotice('Progetto ripristinato. I contorni approvati non sono stati ricalcolati.');
      })
      .catch(() => {
        if (!cancelled) setError('Non sono riuscito a riaprire il progetto salvato in locale.');
      })
      .finally(() => {
        skipAutosaveRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!room || skipAutosaveRef.current || surfaces.length === 0) return;
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const original = room.file.size > 0
            ? room.file
            : await (await fetch(room.previewUrl ?? '/demo-room.jpg')).blob();
          const processed = processedPreview
            ? await (await fetch(processedPreview)).blob()
            : null;
          if (projectIdRef.current === 'draft') projectIdRef.current = crypto.randomUUID();
          await saveProject(buildStoredProject({
            id: projectIdRef.current,
            title: room.projectName,
            sourceType: room.sourceType,
            fileName: room.file.name,
            mime: room.file.type || original.type || 'image/jpeg',
            original,
            processed,
            processedLabel,
            surfaces,
            originalSurfaces: originalSurfacesRef.current.length ? originalSurfacesRef.current : surfaces,
            processedSurfaces: processedSurfacesRef.current,
            source: 'manual',
          }));
        } catch {
          // Local persistence is best-effort; the editor stays usable.
        }
      })();
    }, 500);
    return () => window.clearTimeout(handle);
  }, [processedLabel, processedPreview, room, surfaces]);

  useEffect(() => {
    if (!room || room.sourceType !== 'photo') return;
    if (showProcessedPreview && processedPreview) processedSurfacesRef.current = surfaces;
    else originalSurfacesRef.current = surfaces;
  }, [processedPreview, room, showProcessedPreview, surfaces]);

  useEffect(() => {
    if (!dragVertex) return;
    const preventTouchScroll = (event: TouchEvent) => event.preventDefault();
    const moveDraggedVertexAt = (clientX: number, clientY: number) => {
      if (!surfaceOverlayRef.current) return;
      const rect = surfaceOverlayRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const point = {
        x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      };
      setSurfaces((current) => {
        const next = current.map((surface) => {
        if (surface.frozen) return surface;
        const linkedPoints = surface.points.map((candidate, index) => {
          const isLinked = dragVertex.linked.some((linked) => linked.surfaceId === surface.id && linked.vertexIndex === index);
          return isLinked ? point : candidate;
        });
        return { ...surface, points: linkedPoints };
        });
        return next.every((surface) => isValidPolygon(surface.points)) ? next : current;
      });
    };
    const finishVertexDrag = (pointerId: number) => {
      if (pointerId !== dragVertex.pointerId) return;
      if (dragStartRef.current) {
        setPastSurfaces((history) => [...history, dragStartRef.current as Surface[]].slice(-40));
        setFutureSurfaces([]);
      }
      dragStartRef.current = null;
      setDragVertex(null);
      shellRef.current?.classList.remove('is-moving-vertex');
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== dragVertex.pointerId) return;
      event.preventDefault();
      moveDraggedVertexAt(event.clientX, event.clientY);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId === dragVertex.pointerId) finishVertexDrag(event.pointerId);
    };
    document.addEventListener('touchmove', preventTouchScroll, { passive: false });
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      document.removeEventListener('touchmove', preventTouchScroll);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [dragVertex]);

  const selected = surfaces.find((surface) => surface.id === selectedId) ?? null;
  const materialNeedsSample = requiresVerifiedSurfaceSample(material);
  const selectedFurniture = placedFurniture.find((item) => item.id === selectedFurnitureId) ?? null;
  const projectName = room?.projectName ?? 'Progetto senza titolo';
  const importedCaption = useMemo(() => room ? `Immagine · ${room.displaySize}` : null, [room]);
  const filteredMaterials = useMemo(() => {
    const query = [materialQuery, searchBrand, searchModel, searchColor].filter(Boolean).join(' ').trim().toLocaleLowerCase('it');
    const byCategory = searchCategory ? catalogMaterials.filter((item) => item.category === searchCategory) : catalogMaterials;
    if (!query) return byCategory.slice(0, 4);
    const tokens = query.split(/\s+/).filter(Boolean);
    return byCategory.filter((item) => {
      const haystack = `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase('it');
      return tokens.every((token) => haystack.includes(token));
    });
  }, [materialQuery, searchBrand, searchModel, searchColor, searchCategory]);
  const filteredFurniture = useMemo(() => {
    if (searchCategory && searchCategory !== 'Arredi') return [];
    const query = [materialQuery, searchBrand, searchModel, searchColor].filter(Boolean).join(' ').trim().toLocaleLowerCase('it');
    if (!query) return [];
    return furnitureCatalog.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase('it').includes(query));
  }, [materialQuery, searchBrand, searchModel, searchColor, searchCategory]);
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
    const finishImport = (previewUrl: string) => {
      if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
      if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
      roomBlobRef.current = previewUrl;
      processedBlobRef.current = null;
      projectIdRef.current = crypto.randomUUID();
      const initialSurfaces = sourceType === 'floorplan' ? createFloorplanOutline() : [];
      setRoom({ ...result.value, previewUrl, sourceType });
      setProcessedPreview(null); setShowProcessedPreview(false); setProcessedLabel('Stanza vuota'); setOnlineMaterials([]);
      setPlacedFurniture([]); setPendingFurniture(null); setSelectedFurnitureId(null); furnitureFilesRef.current.clear();
      setCleanupRegion(null); setIsPickingCleanup(false);
      autoFitPreviewRef.current = null;
      originalSurfacesRef.current = initialSurfaces;
      processedSurfacesRef.current = null;
      setSurfaces(initialSurfaces); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(initialSurfaces[0]?.id ?? null); setRenameDraft(initialSurfaces[0]?.name ?? ''); setDraft([]); setDrawKind(null); setQuickDraw(false); setLineWallDraw(false); setError(null);
      setIsCorrectingEdges(false);
      setNotice(sourceType === 'floorplan'
        ? 'Planimetria riprodotta. Adatta il perimetro con i pallini e aggiungi le pareti interne con due tocchi.'
        : 'Foto pronta. Sto riconoscendo pavimento e muri: potrai correggere i pallini solo se serve.');
      setIsImportingRoom(false);
      setActiveStep(2);
    };
    const failImport = (reason?: unknown) => {
      const isApplePhoto = ['image/heic', 'image/heif'].includes(file.type) || /\.(heic|heif)$/i.test(file.name);
      setError(isApplePhoto
        ? 'Non riesco a leggere questo HEIC. Su iPhone apri Foto → Condividi → “Salva come JPEG”, oppure carica uno screenshot.'
        : reason instanceof Error && /timeout/i.test(reason.message)
          ? 'La foto sta impiegando troppo tempo a caricarsi. Riprova con un JPEG più piccolo.'
          : 'La foto non può essere letta. Su iPhone prova a condividerla come JPEG oppure scegli uno screenshot.');
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
    originalSurfacesRef.current = [];
    processedSurfacesRef.current = null;
    furnitureBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    furnitureBlobUrlsRef.current = [];
    furnitureFilesRef.current.clear();
    setRoom(null); setSurfaces([]); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(null); setDraft([]); setDrawKind(null); setQuickDraw(false); setLineWallDraw(false); setProcessedPreview(null); setShowProcessedPreview(false); setProcessedLabel('Stanza vuota'); setOnlineMaterials([]); setPlacedFurniture([]); setPendingFurniture(null); setSelectedFurnitureId(null); setCleanupRegion(null); setIsPickingCleanup(false); setNotice(null); setIsCorrectingEdges(false);
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
    const origin = surface.points[vertexIndex];
    const overlay = surfaceOverlayRef.current?.getBoundingClientRect();
    const width = overlay?.width || 1000; const height = overlay?.height || 625;
    const linked = surfaces.flatMap((candidate) => candidate.points.flatMap((point, index) => (
      Math.hypot((point.x - origin.x) * width, (point.y - origin.y) * height) <= 8
        ? [{ surfaceId: candidate.id, vertexIndex: index }]
        : []
    )));
    if (linked.some((item) => surfaces.find((candidate) => candidate.id === item.surfaceId)?.frozen)) {
      setNotice('Questo nodo tocca una superficie Freeze. Sbloccala prima di spostare il bordo condiviso.');
      return;
    }
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    shellRef.current?.classList.add('is-moving-vertex');
    dragStartRef.current = surfaces;
    setDragVertex({ surfaceId, vertexIndex, pointerId: event.pointerId, origin, linked });
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
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Il campione materiale deve essere JPG, PNG o WEBP.'); return; }
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
    if (requiresVerifiedSurfaceSample(material)) {
      setError('Questa pagina contiene foto ambientate, non una texture pulita. Carica un campione JPG o PNG prima di applicare il prodotto.');
      return;
    }
    commitSurfaces(surfaces.map((surface) => surface.id === selected.id ? { ...surface, materialId: material.id } : surface));
    setNotice(`${material.name} applicato a ${selected.name}. L’originale resta visibile fuori dal contorno.`);
  }

  function endpoint(path: string) {
    return studioEndpoint(path);
  }

  async function searchProductsOnline() {
    const criteria = {
      brand: searchBrand.trim(),
      model: searchModel.trim(),
      color: searchColor.trim(),
      category: searchCategory,
      sourceUrl: searchSourceUrl.trim(),
    };
    const query = materialQuery.trim();
    const readableSearch = [criteria.brand, criteria.model, criteria.color, criteria.category, query, criteria.sourceUrl].filter(Boolean).join(' · ');
    if (readableSearch.length < 3 || isSearchingProducts) {
      if (readableSearch.length < 3) setError('Inserisci almeno una marca, un modello, un colore oppure una descrizione.');
      return;
    }
    setIsSearchingProducts(true); setError(null); setNotice(`Cerco ${readableSearch} nei cataloghi ufficiali…`); setOnlineMaterials([]);
    try {
      const { response, result } = await requestJson<{ products?: Array<{ name: string; brand: string; collection?: string; category: StudioMaterial['category']; color?: string; effect?: string; format?: string; finish?: string; description: string; sourceUrl: string; productImageUrl?: string; textureImageUrl?: string; roomImageUrls?: string[]; confidence?: number; official?: boolean; correction?: string }>; message?: string }>(endpoint('/api/search-products'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, criteria }),
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
        // A catalog/product photograph may contain furniture, props and room
        // scenery. It is safe as a preview, never as a repeatable surface map.
        const referenceKind: MaterialReferenceKind = textureUrl
          ? 'verified-texture'
          : item.category === 'Arredi' && productImageUrl
            ? 'official-product-image'
            : 'metadata-only';
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

  function resetProductSearch() {
    setMaterialQuery(''); setSearchBrand(''); setSearchModel(''); setSearchColor(''); setSearchCategory(''); setSearchSourceUrl(''); setOnlineMaterials([]); setError(null);
    setNotice('Criteri di ricerca azzerati.');
  }

  function recommendedSurface(item: StudioMaterial) {
    const description = `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase('it');
    const preferredKind: SurfaceKind = item.category === 'Pavimenti' || /pavimento|parquet|rovere|piastrella|mattonell/.test(description) ? 'floor' : 'wall';
    return surfaces.find((surface) => !surface.frozen && surface.kind === preferredKind)
      ?? (selected && !selected.frozen ? selected : null)
      ?? surfaces.find((surface) => !surface.frozen)
      ?? null;
  }

  async function createMaskedInput(options: {
    editableSurface?: Surface;
    editableSurfaces?: Surface[];
    editableFurniture?: PlacedFurniture[];
    protectedSurfaces?: Surface[];
    frozenSurfaces?: Surface[];
    sourceUrl?: string;
  }) {
    const sourceUrl = options.sourceUrl ?? room?.previewUrl;
    if (!sourceUrl) throw new Error('La foto della stanza non è pronta.');
    const image = await loadImageSource(sourceUrl);
    const maxSide = isAppleTouchDevice() ? 1280 : 1536;
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

    const drawPoints = (points: Point[]) => {
      maskContext.beginPath();
      points.forEach((point, index) => {
        const x = point.x * width; const y = point.y * height;
        if (index === 0) maskContext.moveTo(x, y); else maskContext.lineTo(x, y);
      });
      maskContext.closePath(); maskContext.fill();
    };
    const drawPolygon = (surface: Surface) => drawPoints(surface.points);

    const editableSurfaces = options.editableSurfaces ?? (options.editableSurface ? [options.editableSurface] : []);
    const editableFurniture = options.editableFurniture ?? [];
    if (editableSurfaces.length || editableFurniture.length) {
      maskContext.fillStyle = '#ffffff'; maskContext.fillRect(0, 0, width, height);
      maskContext.globalCompositeOperation = 'destination-out';
      for (const surface of editableSurfaces) drawPolygon(surface);
      maskContext.globalCompositeOperation = 'source-over';
      maskContext.fillStyle = '#ffffff';
      for (const surface of options.protectedSurfaces ?? []) drawPolygon(surface);
      // A requested item is allowed to naturally occlude a protected wall.
      // Open its placement window after restoring the architectural mask.
      maskContext.globalCompositeOperation = 'destination-out';
      for (const item of editableFurniture) drawPoints(rectPoints(furnitureEditRect(item)));
      maskContext.globalCompositeOperation = 'source-over';
    } else {
      maskContext.clearRect(0, 0, width, height);
      maskContext.fillStyle = '#ffffff';
      for (const surface of options.frozenSurfaces ?? []) drawPolygon(surface);
    }

    const [inputImage, mask] = await Promise.all([
      // JPEG keeps the multipart request comfortably below mobile/edge body
      // limits; the lossless PNG is reserved for the technical mask.
      new Promise<Blob | null>((resolve) => imageCanvas.toBlob(resolve, 'image/jpeg', .92)),
      new Promise<Blob | null>((resolve) => maskCanvas.toBlob(resolve, 'image/png')),
    ]);
    if (!inputImage || !mask) throw new Error('Non posso preparare foto e maschera della superficie.');
    return { inputImage, mask };
  }

  async function protectAiResult(resultSource: string, options: {
    editableSurface?: Surface;
    editableSurfaces?: Surface[];
    editableFurniture?: PlacedFurniture[];
    protectedSurfaces?: Surface[];
    frozenSurfaces?: Surface[];
    sourceUrl?: string;
  }) {
    const sourceUrl = options.sourceUrl ?? room?.previewUrl;
    if (!sourceUrl) throw new Error('La fotografia originale non è disponibile.');
    const [original, generated] = await Promise.all([
      loadImageSource(sourceUrl),
      loadImageSource(resultSource),
    ]);
    if (!hasCompatibleImageGeometry(original.naturalWidth, original.naturalHeight, generated.naturalWidth, generated.naturalHeight)) {
      throw new Error('Il risultato IA ha cambiato taglio o proporzioni: è stato scartato e la stanza è rimasta intatta.');
    }
    const maxSide = isAppleTouchDevice() ? 1280 : 1536;
    const scale = Math.min(1, maxSide / Math.max(original.naturalWidth, original.naturalHeight));
    const width = Math.max(1, Math.round(original.naturalWidth * scale));
    const height = Math.max(1, Math.round(original.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Non posso proteggere le zone Freeze.');

    const clipPoints = (points: Point[]) => {
      context.beginPath();
      points.forEach((point, index) => {
        const x = point.x * width; const y = point.y * height;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.closePath();
      context.clip();
    };
    const clipTo = (surface: Surface) => clipPoints(surface.points);

    const editableSurfaces = options.editableSurfaces ?? (options.editableSurface ? [options.editableSurface] : []);
    const editableFurniture = options.editableFurniture ?? [];
    if (editableSurfaces.length || editableFurniture.length) {
      context.drawImage(original, 0, 0, width, height);
      for (const surface of editableSurfaces) {
        context.save(); clipTo(surface); drawImageCover(context, generated, width, height); context.restore();
      }
      for (const surface of options.protectedSurfaces ?? []) {
        context.save(); clipTo(surface); context.drawImage(original, 0, 0, width, height); context.restore();
      }
      // Furniture is the foreground layer and may cover a Freeze surface
      // without allowing the model to redesign that surface elsewhere.
      for (const item of editableFurniture) {
        context.save(); clipPoints(rectPoints(furnitureEditRect(item))); drawImageCover(context, generated, width, height); context.restore();
      }
    } else {
      drawImageCover(context, generated, width, height);
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

  async function createFurnitureCutout(
    previewUrl: string,
    productName: string,
    suppliedBounds?: NormalizedProductBounds,
    askAi = true,
    productDescription?: string,
  ) {
    let bounds = suppliedBounds;
    if (!bounds && askAi && previewUrl.startsWith('http')) {
      const { response, result } = await requestJson<{ bounds?: NormalizedProductBounds; message?: string }>(endpoint('/api/product-bounds'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: previewUrl, productName }),
      }, 60000);
      if (response.ok && result.bounds) bounds = result.bounds;
    }
    const source = previewUrl.startsWith('http')
      ? endpoint(`/api/product-image?url=${encodeURIComponent(previewUrl)}`)
      : previewUrl;
    const product = await loadImageSource(source);
    const productScale = Math.min(1, 1200 / Math.max(product.naturalWidth, product.naturalHeight));
    const width = Math.max(1, Math.round(product.naturalWidth * productScale));
    const height = Math.max(1, Math.round(product.naturalHeight * productScale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Non posso scontornare la foto del prodotto.');
    context.drawImage(product, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const cutout = removeConnectedProductBackground(
      pixels.data,
      width,
      height,
      bounds,
      furnitureWidthHeightRatio(productDescription),
    );
    pixels.data.set(cutout.data);
    context.putImageData(pixels, 0, 0);
    const cropWidth = Math.max(1, cutout.crop.right - cutout.crop.left);
    const cropHeight = Math.max(1, cutout.crop.bottom - cutout.crop.top);
    const cropped = document.createElement('canvas');
    cropped.width = cropWidth; cropped.height = cropHeight;
    const croppedContext = cropped.getContext('2d');
    if (!croppedContext) throw new Error('Non posso preparare la sagoma del prodotto.');
    croppedContext.drawImage(canvas, cutout.crop.left, cutout.crop.top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    return cropped.toDataURL('image/png');
  }

  async function createAiCleanedFurnitureCutout(previewUrl: string, productName: string, productDescription?: string) {
    const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/clean-product'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: previewUrl, productName }),
    }, 100000);
    if (!response.ok || !result.image) throw new Error(result.message ?? 'Pulizia Grok non disponibile.');
    return createFurnitureCutout(result.image, productName, undefined, false, productDescription);
  }

  async function createAiCleanedFurnitureFile(file: File, productName: string) {
    const form = new FormData();
    form.append('image', file, file.name || 'prodotto.jpg');
    const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/clean-product'), {
      method: 'POST', body: form,
    }, 100000);
    if (!response.ok || !result.image) throw new Error(result.message ?? 'Pulizia BRIA non disponibile.');
    return createFurnitureCutout(result.image, productName, undefined, false);
  }

  async function applyMaterialAutomatically() {
    if (!material || !room?.previewUrl || isApplyingProduct) return;
    if (material.category === 'Arredi') {
      startFurniturePlacement(material.name, material.previewUrl, material.description);
      return;
    }
    if (requiresVerifiedSurfaceSample(material)) {
      setError('Non applico la foto del catalogo: contiene arredi e sfondo. Carica un campione pulito del materiale per ottenere un render affidabile.');
      setNotice(null);
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
      form.append('image', inputImage, 'surface-input.jpg');
      form.append('mask', mask, 'surface-mask.png');
      form.append('productName', `${material.brand ? `${material.brand} ` : ''}${material.name}`);
      form.append('productDescription', `${material.description} · fonte: ${material.sourceUrl}`);
      form.append('targetName', target.name);
      form.append('protectedAreas', surfaces.filter((surface) => surface.frozen).map((surface) => surface.name).join(', '));
      // Only a verified flat texture (or an uploaded sample, stored as
      // textureUrl) may be sent as the visual surface reference.
      const referenceUrl = material.textureUrl;
      if (referenceUrl) form.append('imageUrl', referenceUrl);
      form.append('referenceType', material.referenceKind ?? 'metadata-only');
      const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/apply-product'), { method: 'POST', body: form }, 180000);
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Render non disponibile.');
      const protectedPreview = await protectAiResult(result.image, { editableSurface: target });
      const updatedSurfaces = surfaces.map((surface) => surface.id === target.id ? { ...surface, materialId: material.id } : surface);
      commitSurfaces(updatedSurfaces);
      processedSurfacesRef.current = updatedSurfaces;
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

  async function chooseOnlineProduct(next: StudioMaterial) {
    if (next.category === 'Arredi') {
      const name = `${next.brand ? `${next.brand} ` : ''}${next.name}`.trim();
      if (!next.previewUrl) {
        setError(`“${name}” non include una foto prodotto verificata. Apri la fonte oppure carica una foto del mobile.`);
        setNotice(null);
        return;
      }
      setError(null);
      setNotice(`Grok ripulisce “${name}” da sfondo, decorazioni e ombre…`);
      let cutoutUrl: string | undefined;
      try {
        if (next.previewUrl) cutoutUrl = await createAiCleanedFurnitureCutout(next.previewUrl, name, next.description);
      } catch {
        // Keep the deterministic local cleanup as a reliable fallback.
        try {
          if (next.previewUrl) cutoutUrl = await createFurnitureCutout(next.previewUrl, name, undefined, true, next.description);
        } catch { /* The exact product photo remains available to the render engine. */ }
      }
      startFurniturePlacement(name, next.previewUrl, next.description, undefined, cutoutUrl);
      return;
    }
    chooseMaterial(next);
  }

  function startFurniturePlacement(name: string, previewUrl?: string, description?: string, file?: File, cutoutUrl?: string, sidePreviewUrl?: string) {
    if (!room || room.sourceType !== 'photo') {
      setError('Per posizionare un mobile serve una foto della stanza.');
      return;
    }
    setPendingFurniture({ name, previewUrl, sidePreviewUrl, cutoutUrl, description, file });
    setSelectedFurnitureId(null);
    setNotice(`Tocca il punto del pavimento dove vuoi mettere “${name}”.`);
  }

  async function importFurniture(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('La foto del mobile deve essere JPG, PNG o WEBP.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('La foto del mobile supera il limite di 20 MB.'); return; }
    const previewUrl = URL.createObjectURL(file);
    furnitureBlobUrlsRef.current.push(previewUrl);
    const name = file.name.replace(/\.[^.]+$/, '');
    setNotice(`BRIA scontorna “${name}” e prepara la sagoma trasparente…`);
    let cutoutUrl: string | undefined;
    try { cutoutUrl = await createAiCleanedFurnitureFile(file, name); } catch {
      try { cutoutUrl = await createFurnitureCutout(previewUrl, name, undefined, false); } catch { /* keep original */ }
    }
    startFurniturePlacement(name, previewUrl, undefined, file, cutoutUrl);
    setError(null);
  }

  function onFurnitureInput(event: ChangeEvent<HTMLInputElement>) {
    void importFurniture(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  }

  function placePendingFurniture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!pendingFurniture || activeStep !== 3) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(.94, Math.max(.06, (event.clientX - rect.left) / rect.width));
    const requestedY = (event.clientY - rect.top) / rect.height;
    const floorContact = floorContactYAtX(surfaces.find((surface) => surface.kind === 'floor'), x);
    const y = Math.min(.94, Math.max(floorContact + .015, requestedY));
    furnitureIdRef.current += 1;
    const id = `furniture-${furnitureIdRef.current}`;
    const scale = perspectiveFurnitureScale(pendingFurniture.name, pendingFurniture.description, y, floorContact);
    const placed: PlacedFurniture = { id, name: pendingFurniture.name, x, y, scale, autoScale: true, facing: 'front-wall', frozen: false, previewUrl: pendingFurniture.previewUrl, sidePreviewUrl: pendingFurniture.sidePreviewUrl, cutoutUrl: pendingFurniture.cutoutUrl, description: pendingFurniture.description };
    if (pendingFurniture.file) furnitureFilesRef.current.set(id, pendingFurniture.file);
    setPlacedFurniture((current) => [...current, placed]);
    setSelectedFurnitureId(id);
    setPendingFurniture(null);
    setNotice(`${placed.name} posizionato con misura automatica ${Math.round(placed.scale)}%. Trascinalo avanti o indietro per adattarlo alla profondità.`);
  }

  function beginFurnitureDrag(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    const item = placedFurniture.find((candidate) => candidate.id === id);
    if (!item || item.frozen) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setSelectedFurnitureId(id);
    setDragFurniture({ id, pointerId: event.pointerId });
  }

  function moveFurniture(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragFurniture || dragFurniture.pointerId !== event.pointerId || !canvasRef.current) return;
    event.preventDefault(); event.stopPropagation();
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.min(.96, Math.max(.04, (event.clientX - rect.left) / rect.width));
    const requestedY = (event.clientY - rect.top) / rect.height;
    const floorContact = floorContactYAtX(surfaces.find((surface) => surface.kind === 'floor'), x);
    const y = Math.min(.96, Math.max(floorContact + .015, requestedY));
    setPlacedFurniture((current) => current.map((item) => item.id === dragFurniture.id ? { ...item, x, y, scale: item.autoScale ? perspectiveFurnitureScale(item.name, item.description, y, floorContact) : item.scale } : item));
  }

  function endFurnitureDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragFurniture?.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    setDragFurniture(null);
  }

  function updateSelectedFurniture(changes: Partial<PlacedFurniture>) {
    if (!selectedFurniture || selectedFurniture.frozen && changes.frozen !== false) return;
    setPlacedFurniture((current) => current.map((item) => item.id === selectedFurniture.id ? { ...item, ...changes } : item));
  }

  function orientSelectedFurniture(facing: FurnitureFacing) {
    updateSelectedFurniture({ facing });
    if (selectedFurniture) setNotice(`${selectedFurniture.name}: ${furnitureFacingLabels[facing].toLocaleLowerCase('it')}. L’anteprima mostra subito l’orientamento; Grok rifinisce prospettiva e ombre nel render.`);
  }

  function resizeSelectedFurniture(delta: number) {
    if (!selectedFurniture) return;
    updateSelectedFurniture({ scale: Math.min(55, Math.max(12, selectedFurniture.scale + delta)), autoScale: false });
  }

  function restoreAutomaticFurnitureScale() {
    if (!selectedFurniture) return;
    const floorContact = floorContactYAtX(surfaces.find((surface) => surface.kind === 'floor'), selectedFurniture.x);
    updateSelectedFurniture({ scale: perspectiveFurnitureScale(selectedFurniture.name, selectedFurniture.description, selectedFurniture.y, floorContact), autoScale: true });
    setNotice(`${selectedFurniture.name}: misura automatica adattata alla profondità della stanza.`);
  }

  function removeSelectedFurniture() {
    if (!selectedFurniture || selectedFurniture.frozen) return;
    furnitureFilesRef.current.delete(selectedFurniture.id);
    setPlacedFurniture((current) => current.filter((item) => item.id !== selectedFurniture.id));
    setSelectedFurnitureId(null);
    setNotice(`${selectedFurniture.name} rimosso dal render.`);
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

  async function detectSurfacesForPreview(source: string, fileName: string) {
    const inputImage = await createGeometryInput(source);
    const form = new FormData();
    form.append('image', inputImage, fileName.replace(/\.(heic|heif|png)$/i, '.jpg'));
    const { response, result } = await requestJson<{ surfaces?: DetectedSurface[]; message?: string }>(
      endpoint('/api/detect-surfaces'),
      { method: 'POST', body: form },
      150000,
    );
    if (!response.ok || !result.surfaces?.length) throw new Error(result.message ?? 'Grok non ha trovato superfici affidabili.');
    return result.surfaces.filter((surface) => isValidPolygon(surface.points)).map((surface, index) => ({
      id: `grok-${Date.now()}-${index}`,
      name: surface.name,
      kind: surface.kind,
      points: surface.points,
      frozen: false,
    }));
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
          detected = await detectSurfacesForPreview(room.previewUrl, room.file.name);
          usedGrok = detected.length > 0;
        } catch (caught) {
          grokError = caught instanceof Error ? caught : new Error('Grok non ha completato il riconoscimento.');
        }
      }

      if (!detected?.length) detected = createGuidedSurfaces(detectRoomBounds(roomImageRef.current));

      const frozenSurfaces = surfaces.filter((surface) => surface.frozen);
      const nextSurfaces = mergeDetectedSurfaces(detected, surfaces);
      const adjusted = nextSurfaces.filter((surface) => !surface.frozen);
      commitSurfaces(nextSurfaces);
      const first = adjusted[0] ?? frozenSurfaces[0] ?? null;
      setSelectedId(first?.id ?? null); setRenameDraft(first?.name ?? '');
      setIsCorrectingEdges(false);
      setNotice(usedGrok
        ? `Analisi ad alta precisione completata: ${nextSurfaces.length} superfici confrontate e bordi agganciati alla foto.`
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
    const baselineSurfaces = processedLabel === 'Stanza vuota' && processedPreview && originalSurfacesRef.current.length
      ? originalSurfacesRef.current
      : surfaces;
    setCleanupRegion(null); setIsPickingCleanup(false);
    setIsEmptyingRoom(true); setError(null);
    setShowProcessedPreview(false);
    setSurfaces(baselineSurfaces);
    setNotice('L’IA sta riconoscendo e rimuovendo i mobili. L’originale resta sempre disponibile.');
    try {
      const frozenSurfaces = baselineSurfaces.filter((surface) => surface.frozen);
      const { inputImage, mask } = await createMaskedInput({ frozenSurfaces });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) setNotice('La precedente elaborazione ha cambiato l’inquadratura: la scarto e riprovo mantenendo tutti i bordi originali.');
        const form = new FormData();
        form.append('image', inputImage, 'room-input.jpg');
        if (frozenSurfaces.length) form.append('mask', mask, 'freeze-mask.png');
        form.append('protectedAreas', frozenSurfaces.map((surface) => surface.name).join(', '));
        if (attempt > 0) form.append('strictRetry', 'true');
        const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/empty-room'), { method: 'POST', body: form }, 180000);
        if (!response.ok || !result.image) throw new Error(result.message ?? 'Immagine non disponibile.');
        const protectedPreview = await protectAiResult(result.image, { frozenSurfaces });
        const similarity = await framingSimilarity(room.previewUrl, protectedPreview);
        if (similarity < EMPTY_ROOM_FRAMING_MIN) {
          if (attempt < 2) continue;
          throw new Error('Grok ha cambiato l’inquadratura della foto: il risultato è stato scartato e l’originale è rimasto intatto. Riprova tra poco.');
        }

        const approved = geometryForDerivedImage(baselineSurfaces);
        originalSurfacesRef.current = geometryForDerivedImage(baselineSurfaces);
        processedSurfacesRef.current = approved;
        setSurfaces(approved); setPastSurfaces([]); setFutureSurfaces([]);
        const preferred = approved.find((surface) => surface.kind === 'floor') ?? approved[0] ?? null;
        setSelectedId(preferred?.id ?? null); setRenameDraft(preferred?.name ?? '');
        setProcessedPreview(protectedPreview); setProcessedLabel('Stanza vuota'); setShowProcessedPreview(true);
        setNotice('Stanza vuota pronta. I contorni approvati restano quelli della foto originale: l’IA non li ha ricalcolati.');
        return;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito a svuotare la stanza.');
      setNotice(null);
    } finally {
      setIsEmptyingRoom(false);
    }
  }

  async function detectCleanupRegion(event: ReactMouseEvent<HTMLDivElement>) {
    if (!isPickingCleanup || !room?.previewUrl || room.sourceType !== 'photo' || isDetectingCleanup) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
    const sourceUrl = showProcessedPreview && processedPreview ? processedPreview : room.previewUrl;
    setIsDetectingCleanup(true); setError(null); setNotice('Grok sta delimitando soltanto l’oggetto indicato…');
    try {
      const inputImage = await createGeometryInput(sourceUrl);
      const form = new FormData();
      form.append('image', inputImage, 'cleanup-detection.jpg');
      form.append('x', String(point.x)); form.append('y', String(point.y));
      const { response, result } = await requestJson<{ region?: CleanupRegion | null; message?: string }>(endpoint('/api/detect-object'), { method: 'POST', body: form }, 70000);
      if (!response.ok) throw new Error(result.message ?? 'Riconoscimento non disponibile.');
      if (!result.region || !isValidPolygon(result.region.points)) throw new Error('In quel punto non riconosco un oggetto mobile. Tocca il centro dell’oggetto rimasto.');
      setCleanupRegion(result.region); setIsPickingCleanup(false);
      setNotice(`${result.region.label} riconosciuto. Controlla il contorno evidenziato e premi “Pulisci selezione”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito a riconoscere l’oggetto.'); setNotice(null);
    } finally { setIsDetectingCleanup(false); }
  }

  async function cleanResidualRegion() {
    if (!cleanupRegion || !room?.previewUrl || isCleaningRegion) return;
    const sourceUrl = showProcessedPreview && processedPreview ? processedPreview : room.previewUrl;
    const localRegion: Surface = { id: 'cleanup-region', name: cleanupRegion.label, kind: 'other', frozen: false, points: cleanupRegion.points };
    setIsCleaningRegion(true); setError(null); setNotice(`Pulisco soltanto “${cleanupRegion.label}”. Tutto il resto viene ricopiato pixel per pixel.`);
    try {
      const { inputImage, mask } = await createMaskedInput({ editableSurface: localRegion, sourceUrl });
      const form = new FormData();
      form.append('image', inputImage, 'cleanup-input.jpg'); form.append('mask', mask, 'cleanup-mask.png');
      form.append('targetLabel', cleanupRegion.label); form.append('targetArea', JSON.stringify(cleanupRegion.points));
      const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/clean-room-region'), { method: 'POST', body: form }, 180000);
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Pulizia locale non disponibile.');
      const protectedPreview = await protectAiResult(result.image, { editableSurface: localRegion, sourceUrl });
      setProcessedPreview(protectedPreview); setProcessedLabel('Pulizia locale'); setShowProcessedPreview(true); setCleanupRegion(null);
      processedSurfacesRef.current = geometryForDerivedImage(surfaces);
      setNotice(`${cleanupRegion.label} rimosso. Fuori dal contorno selezionato la foto è rimasta identica.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito a pulire la zona selezionata.'); setNotice(null);
    } finally { setIsCleaningRegion(false); }
  }

  function handleCanvasClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (isPickingCleanup) { void detectCleanupRegion(event); return; }
    placePendingFurniture(event);
  }

  function showOriginalRoom() {
    if (showProcessedPreview) processedSurfacesRef.current = surfaces;
    const original = originalSurfacesRef.current;
    if (original.length) {
      setSurfaces(original); setPastSurfaces([]); setFutureSurfaces([]);
      const preferred = original.find((surface) => surface.kind === 'floor') ?? original[0];
      setSelectedId(preferred.id); setRenameDraft(preferred.name);
    }
    setShowProcessedPreview(false);
    setNotice('Foto originale e contorni originali ripristinati.');
  }

  function showProcessedRoom() {
    if (!processedPreview) return;
    if (!showProcessedPreview) originalSurfacesRef.current = surfaces;
    const processed = processedSurfacesRef.current;
    if (processed?.length) {
      setSurfaces(processed); setPastSurfaces([]); setFutureSurfaces([]);
      const preferred = processed.find((surface) => surface.kind === 'floor') ?? processed[0];
      setSelectedId(preferred.id); setRenameDraft(preferred.name);
    }
    setShowProcessedPreview(true);
    setNotice(`${processedLabel}: stessi contorni approvati sulla stanza svuotata.`);
  }

  async function createFinalRender() {
    if (!room?.previewUrl || room.sourceType !== 'photo' || isRendering) return;
    const frozenSurfaces = surfaces.filter((surface) => surface.frozen);
    const sourceUrl = showProcessedPreview && processedPreview ? processedPreview : room.previewUrl;
    const editableMaterialSurfaces = surfaces.filter((surface) => surface.materialId && !surface.frozen);
    const surfaceWithoutSample = editableMaterialSurfaces.find((surface) => requiresVerifiedSurfaceSample(materialMap.get(surface.materialId!)));
    if (surfaceWithoutSample) {
      const assigned = materialMap.get(surfaceWithoutSample.materialId!);
      setError(`“${assigned?.name ?? 'Il prodotto scelto'}” non ha una texture pulita verificata. Carica un campione prima di creare il render.`);
      setRenderSummaryOpen(false);
      return;
    }
    const protectedSurfaces = surfaces.filter((surface) => surface.frozen
      || ((surface.kind === 'door' || surface.kind === 'window') && !surface.materialId)
      || (surface.kind === 'ceiling' && !surface.materialId));
    const materialAssignments = surfaces.filter((surface) => surface.materialId).map((surface) => {
      const assigned = materialMap.get(surface.materialId!);
      return `${surface.name}: ${assigned?.brand ? `${assigned.brand} ` : ''}${assigned?.name ?? 'materiale scelto'} (${assigned?.description ?? 'mantieni il campione selezionato'}; ${assigned ? materialReferenceLabel(assigned) : 'riferimento non disponibile'})`;
    });
    const furnitureAssignments = placedFurniture.map((item) => [
      item.name,
      `anchor at x ${Math.round(item.x * 100)}%, y ${Math.round(item.y * 100)}% of the source image`,
      `approximate visible width ${Math.round(item.scale)}%`,
      furnitureFacingInstructions[item.facing],
      item.frozen ? 'placement locked by user' : 'placement confirmed by user',
    ].join('; '));

    setIsRendering(true); setError(null); setRenderSummaryOpen(false);
    setNotice('Grok modifica solo prodotti e mobili. Geometria, aperture e resto della foto sono bloccati pixel per pixel.');
    try {
      if (!editableMaterialSurfaces.length && !placedFurniture.length) {
        processedSurfacesRef.current = surfaces;
        setProcessedPreview(sourceUrl); setProcessedLabel('Render controllato'); setShowProcessedPreview(true); setActiveStep(4);
        setNotice('Nessuna modifica visiva richiesta: la fotografia è rimasta identica e non è stata inviata all’IA.');
        return;
      }
      const { inputImage, mask } = await createMaskedInput({
        editableSurfaces: editableMaterialSurfaces,
        editableFurniture: placedFurniture,
        protectedSurfaces,
        sourceUrl,
      });
      const form = new FormData();
      form.append('image', inputImage, 'render-input.jpg');
      form.append('mask', mask, 'controlled-edit-mask.png');
      form.append('materials', materialAssignments.join('\n'));
      form.append('furniture', furnitureAssignments.join('\n'));
      form.append('requests', customRequests.join(', '));
      form.append('protectedAreas', frozenSurfaces.map((surface) => surface.name).join(', '));
      const referenceUrl = material?.textureUrl;
      if (referenceUrl && materialAssignments.length) form.append('imageUrl', referenceUrl);
      if (materialAssignments.length) form.append('referenceType', material?.referenceKind ?? 'metadata-only');
      const furnitureWithPhoto = placedFurniture.find((item) => furnitureFilesRef.current.has(item.id));
      const furnitureReference = furnitureWithPhoto ? furnitureFilesRef.current.get(furnitureWithPhoto.id) : null;
      const furnitureWithCutout = placedFurniture.find((item) => item.cutoutUrl);
      if (furnitureWithCutout?.cutoutUrl) {
        const cutoutBlob = await fetch(furnitureWithCutout.cutoutUrl).then((response) => response.blob());
        form.append('furnitureReference', cutoutBlob, 'furniture-cutout.png');
        form.append('furnitureReferenceName', furnitureWithCutout.name);
      } else if (furnitureReference && furnitureWithPhoto) {
        form.append('furnitureReference', furnitureReference, furnitureReference.name);
        form.append('furnitureReferenceName', furnitureWithPhoto.name);
      }
      const furnitureWithRemotePhoto = placedFurniture.find((item) => item.previewUrl?.startsWith('http'));
      if (!furnitureWithCutout && !furnitureReference && furnitureWithRemotePhoto?.previewUrl) {
        form.append('furnitureReferenceUrl', furnitureWithRemotePhoto.previewUrl);
        form.append('furnitureReferenceName', furnitureWithRemotePhoto.name);
      }
      const { response, result } = await requestJson<{
        image?: string;
        message?: string;
        verification?: { visible: boolean; atRequestedAnchor: boolean; resemblesReference: boolean; confidence: number } | null;
      }>(endpoint('/api/render-room'), { method: 'POST', body: form }, 240000);
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Render non disponibile.');
      const protectedPreview = await protectAiResult(result.image, {
        editableSurfaces: editableMaterialSurfaces,
        editableFurniture: placedFurniture,
        protectedSurfaces,
        sourceUrl,
      });
      processedSurfacesRef.current = surfaces;
      setProcessedPreview(protectedPreview); setProcessedLabel('Render controllato'); setShowProcessedPreview(true);
      setActiveStep(4);
      setNotice(placedFurniture.length
        ? 'Render fotografico pronto: il mobile ha superato i controlli di presenza, posizione, appoggio, ombra di contatto e somiglianza.'
        : 'Render controllato pronto: fuori dalle aree autorizzate i pixel sono identici; porte, finestre, soffitto e Freeze sono stati ricopiati dalla foto di partenza.');
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
    originalSurfacesRef.current = created;
    processedSurfacesRef.current = null;
    setRoom({ file, kind: 'image', canPreview: true, displaySize: 'esempio incluso', projectName: 'Stanza vuota con finestra', previewUrl: '/demo-room.jpg', sourceType: 'photo' });
    setPlacedFurniture([]); setPendingFurniture(null); setSelectedFurnitureId(null); furnitureFilesRef.current.clear();
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
        <div className="top-actions"><span className={`ai-status ${aiStatus}`}><i />{aiStatus === 'ready' ? `${aiProviderLabel ?? 'IA'} attiva` : aiStatus === 'checking' ? 'Verifica IA' : isLocalPreview() ? 'Anteprima locale · Grok online' : 'IA non raggiungibile'}</span><button className="avatar" type="button" aria-label="Profilo locale">AG</button></div>
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

          <div className="canvas-wrap"><div ref={canvasRef} className={`canvas ${isDraggingFile ? 'is-dragging' : ''} ${pendingFurniture ? 'is-placing-furniture' : ''} ${isPickingCleanup ? 'is-picking-cleanup' : ''}`} id="editor-title" style={room ? { aspectRatio: roomRatio } : undefined} onClick={handleCanvasClick} onDragEnter={() => setIsDraggingFile(true)} onDragLeave={() => setIsDraggingFile(false)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            {room?.previewUrl ? <div className="editor-media">
              <img ref={roomImageRef} src={showProcessedPreview && processedPreview ? processedPreview : room.previewUrl} alt={showProcessedPreview ? `Anteprima elaborata: ${processedLabel}` : `Originale importato: ${room.file.name}`} onLoad={(event) => onRoomImageLoad(event.currentTarget)} />
              <svg ref={surfaceOverlayRef} className={`surface-overlay ${drawKind ? 'is-drawing' : ''} ${isCorrectingEdges ? 'is-correcting' : ''} ${isPickingCleanup ? 'is-cleanup-picking' : ''}`} viewBox="0 0 1000 625" preserveAspectRatio="none" onPointerDown={addDraftPoint}>
                <defs>
                  {catalogMaterials.filter((item) => item.pattern).map((item) => <pattern id={`catalog-material-${item.id}`} key={item.id} width={item.pattern === 'wood' ? 180 : 120} height={item.pattern === 'wood' ? 42 : 120} patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill={item.color} /><path d={item.pattern === 'wood' ? 'M0 2H180 M0 40H180 M45 2V40 M135 2V40' : 'M0 1H120 M1 0V120'} stroke="rgba(67,55,43,.22)" strokeWidth="3" /><path d={item.pattern === 'stone' ? 'M8 38 C38 17 64 55 110 25 M14 92 C45 68 77 106 116 74' : ''} fill="none" stroke="rgba(255,255,255,.24)" strokeWidth="5" /></pattern>)}
                  {material?.previewUrl && <pattern id={`uploaded-material-${material.id}`} width="140" height="140" patternUnits="userSpaceOnUse"><image href={material.previewUrl} width="140" height="140" preserveAspectRatio="xMidYMid slice" /></pattern>}
                </defs>
                {surfaces.map((surface) => {
                  const labelPoint = surfaceLabelPoint(surface);
                  const showLabel = surface.kind === 'window' || surface.kind === 'door';
                  return <g key={surface.id} className={`surface-kind-${surface.kind} ${surface.frozen ? 'is-frozen ' : ''}${surface.id === selectedId ? 'is-selected-surface' : ''}`}><polygon points={pointsToSvg(surface.points)} fill={materialFill(surface)} stroke={surface.id === selectedId ? '#d7f05c' : kindColors[surface.kind]} strokeWidth={surface.id === selectedId ? 6 : 3} vectorEffect="non-scaling-stroke" onPointerDown={(event) => { if (!drawKind) { event.stopPropagation(); setSelectedId(surface.id); setRenameDraft(surface.name); setQuickDraw(false); } }} />{showLabel && <text className="surface-name" x={labelPoint.x * 1000} y={labelPoint.y * 625}>{surface.name}</text>}{isCorrectingEdges && !surface.frozen && surface.id === selectedId && surface.points.map((point, index) => <g key={`${surface.id}-${index}`}><circle cx={point.x * 1000} cy={point.y * 625} r="34" className="surface-vertex-hit" aria-label={`Sposta punto ${index + 1} di ${surface.name}`} onPointerDown={(event) => beginVertexDrag(event, surface.id, index)} /><circle cx={point.x * 1000} cy={point.y * 625} r="16" className="surface-vertex" aria-hidden="true" /></g>)}</g>;
                })}
                {draft.length > 0 && <><polyline points={pointsToSvg(draft)} fill="none" stroke="#d7f05c" strokeWidth="5" vectorEffect="non-scaling-stroke" />{draft.map((point, index) => <circle key={index} cx={point.x * 1000} cy={point.y * 625} r="9" className="draft-vertex" />)}</>}
                {cleanupRegion && <polygon className="cleanup-region" points={pointsToSvg(cleanupRegion.points)} aria-label={`Zona da pulire: ${cleanupRegion.label}`} />}
              </svg>
              {activeStep === 3 && <div className="furniture-placement-layer" aria-label="Mobili posizionati">{placedFurniture.map((item) => {
                const usesSideAsset = item.facing !== 'front-wall' && Boolean(item.sidePreviewUrl);
                const imageUrl = usesSideAsset ? item.sidePreviewUrl : item.cutoutUrl ?? item.previewUrl;
                return <button key={item.id} type="button" className={`placed-furniture facing-${item.facing} ${usesSideAsset ? 'has-side-preview' : ''} ${selectedFurnitureId === item.id ? 'is-selected' : ''} ${item.frozen ? 'is-frozen' : ''}`} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.scale}%`, transform: 'translate(-50%,-100%)' }} aria-label={`Sposta ${item.name}`} onClick={(event) => { event.stopPropagation(); setSelectedFurnitureId(item.id); }} onPointerDown={(event) => beginFurnitureDrag(event, item.id)} onPointerMove={moveFurniture} onPointerUp={endFurnitureDrag} onPointerCancel={endFurnitureDrag}>{imageUrl ? <img src={imageUrl} alt="" /> : <span className="placed-furniture-placeholder">▰</span>}<strong>{item.name}</strong><span className="furniture-facing-badge">{furnitureFacingLabels[item.facing]}</span><i aria-hidden="true" /></button>;
              })}{selectedFurniture && !selectedFurniture.frozen && <><div className="canvas-facing-controls" role="group" aria-label="Gira il mobile" style={{ left: `${selectedFurniture.x * 100}%`, top: `${selectedFurniture.y * 100}%` }} onClick={(event) => event.stopPropagation()}>{(Object.keys(furnitureFacingLabels) as FurnitureFacing[]).map((facing) => <button type="button" key={facing} aria-label={`Orienta ${selectedFurniture.name}: ${furnitureFacingLabels[facing]}`} className={selectedFurniture.facing === facing ? 'is-active' : ''} onClick={() => orientSelectedFurniture(facing)}>{facing === 'front-wall' ? '↑ Frontale' : facing === 'left-wall' ? '↙ Sinistra' : '↘ Destra'}</button>)}</div><div className="canvas-size-controls" role="group" aria-label="Dimensione del mobile" style={{ left: `${selectedFurniture.x * 100}%`, top: `${selectedFurniture.y * 100}%` }} onClick={(event) => event.stopPropagation()}><button type="button" aria-label={`Rimpicciolisci ${selectedFurniture.name}`} onClick={() => resizeSelectedFurniture(-3)}>−</button><button type="button" className={selectedFurniture.autoScale ? 'is-active' : ''} aria-label={selectedFurniture.autoScale ? `Misura automatica attiva per ${selectedFurniture.name}` : `Ripristina misura automatica per ${selectedFurniture.name}`} onClick={restoreAutomaticFurnitureScale} disabled={selectedFurniture.autoScale}>{selectedFurniture.autoScale ? `Auto attivo ${Math.round(selectedFurniture.scale)}%` : 'Ripristina Auto'}</button><button type="button" aria-label={`Ingrandisci ${selectedFurniture.name}`} onClick={() => resizeSelectedFurniture(3)}>＋</button></div></>}</div>}
              {pendingFurniture && <div className="placement-hint" role="status"><strong>Tocca il punto sul pavimento</strong><span>Posiziona “{pendingFurniture.name}”</span><button type="button" onClick={(event) => { event.stopPropagation(); setPendingFurniture(null); setNotice('Inserimento mobile annullato.'); }}>Annulla</button></div>}
              <div className="import-status"><span className="status-dot" /><div><strong>{showProcessedPreview ? processedLabel : 'Originale intatto'}</strong><small>{showProcessedPreview ? 'Elaborazione IA · originale sempre disponibile' : importedCaption}</small></div></div>
              <button className="replace-button" type="button" onClick={() => roomInputRef.current?.click()}>↑ Carica la tua foto</button>
              {processedPreview && <div className="before-after-toggle" aria-label="Confronta originale e risultato"><button type="button" className={!showProcessedPreview ? 'is-active' : ''} onClick={showOriginalRoom}>Originale</button><button type="button" className={showProcessedPreview ? 'is-active' : ''} onClick={showProcessedRoom}>{processedLabel}</button></div>}
            </div> : <><div className="room-demo" aria-label="Anteprima schematica della stanza"><div className="room-ceiling"><span>Soffitto</span></div><div className="room-wall left"><span>Muro 2</span></div><div className="room-wall center"><span>Muro 1</span></div><div className="room-wall right"><span>Muro 3</span></div><div className="room-floor"><span>Pavimento</span></div></div><div className="upload-card"><div className="upload-icon">↑</div><p className="eyebrow">Inizia da ciò che hai</p><h1>Cosa vuoi caricare?</h1><p>Scegli una foto della stanza oppure una planimetria. L’originale resterà sempre intatto.</p><div className="source-actions"><label className="source-card is-primary" htmlFor="room-file"><span>▣</span><strong>Libreria foto</strong><small>Scegli una foto già presente su iPhone o iPad</small></label><label className="source-card" htmlFor="camera-file"><span>●</span><strong>Scatta foto</strong><small>Usa direttamente la fotocamera posteriore</small></label><label className="source-card" htmlFor="floorplan-file"><span>⌗</span><strong>Planimetria</strong><small>Ricalca perimetro e pareti interne</small></label></div><button className="demo-button" type="button" onClick={loadDemoRoom}>Prova con la stanza esempio</button><small>JPG, PNG o HEIC · massimo 20 MB</small></div></>}
            {isDraggingFile && <div className="drop-overlay"><strong>Rilascia per importare</strong><span>La foto resterà nel browser.</span></div>}
            {isImportingRoom && <div className="processing-overlay" role="status"><span className="processing-spinner" /><strong>Preparo la foto…</strong><small>Le immagini grandi vengono ottimizzate per evitare blocchi.</small></div>}
          </div>{error && <div className="file-error" role="alert"><strong>Operazione non completata</strong><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Chiudi errore">×</button></div>}</div>
          <input ref={roomInputRef} id="room-file" className="visually-hidden" type="file" accept="image/*,.heic,.heif" onChange={onRoomInput} /><input ref={cameraInputRef} id="camera-file" className="visually-hidden" type="file" accept="image/jpeg,image/png" capture="environment" onChange={onRoomInput} /><input ref={floorplanInputRef} id="floorplan-file" className="visually-hidden" type="file" accept="image/*,.heic,.heif" onChange={onFloorplanInput} /><input ref={materialInputRef} id="material-file" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={onMaterialInput} /><input ref={furnitureInputRef} id="furniture-file" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={onFurnitureInput} />
          {room?.sourceType === 'photo' && activeStep === 2 && <section className="empty-room-choice" aria-label="Svuota la stanza"><div><strong>Vuoi svuotare la stanza?</strong><span>Rimuovi tutto oppure indica un oggetto rimasto: fuori dalla selezione i pixel restano identici.</span></div><div className="empty-room-actions"><button className="empty-room-button" type="button" onClick={() => void emptyRoom()} disabled={isEmptyingRoom || isCleaningRegion}>{isEmptyingRoom ? 'Svuoto la stanza…' : processedLabel === 'Stanza vuota' && processedPreview ? '↻ Rigenera stanza vuota' : '⌂ Svuota la stanza'}</button>{processedPreview && !cleanupRegion && <button type="button" className={isPickingCleanup ? 'is-active' : ''} onClick={() => { setIsPickingCleanup((current) => !current); setError(null); setNotice(isPickingCleanup ? 'Selezione annullata.' : 'Tocca il centro dell’oggetto rimasto nella foto.'); }} disabled={isDetectingCleanup || isCleaningRegion}>{isDetectingCleanup ? 'Riconosco…' : isPickingCleanup ? 'Annulla selezione' : '◎ Pulisci un residuo'}</button>}{cleanupRegion && <><button type="button" className="cleanup-confirm" onClick={() => void cleanResidualRegion()} disabled={isCleaningRegion}>{isCleaningRegion ? 'Pulisco…' : 'Pulisci selezione'}</button><button type="button" onClick={() => setCleanupRegion(null)} disabled={isCleaningRegion}>Annulla</button></>}</div></section>}
          <div className={`status-bar ${activeStep === 2 ? 'prepare-status' : ''}`}><span className="status-icon">{notice ? '✓' : 'i'}</span><p>{notice ?? 'Carica la foto, scegli cosa mantenere e poi cerca il prodotto.'}</p>{room && activeStep === 2 && <button className={`edge-edit-button ${isCorrectingEdges ? 'is-active' : ''}`} type="button" onClick={toggleEdgeCorrection}>{isCorrectingEdges ? '✓ Fine correzione' : room.sourceType === 'floorplan' ? 'Correggi il perimetro' : 'Correggi i bordi'}</button>}{room?.sourceType === 'floorplan' && activeStep === 2 && !drawKind && <button type="button" onClick={startFloorplanWall}>Aggiungi parete interna</button>}{room && surfaces.length > 0 && activeStep === 4 && <button className="render-flow-button" type="button" aria-label="Prova flusso render" onClick={() => setRenderSummaryOpen(true)}>Controlla e crea render</button>}{activeStep === 2 && surfaces.length > 0 && <button className="continue-products-button" type="button" onClick={() => goToStep(3)}>Continua ai prodotti</button>}{activeStep === 3 && <button className="render-flow-button" type="button" aria-label="Prova flusso render" onClick={() => goToStep(4)}>Continua: crea render</button>}</div>
        </section>

        <aside className="properties-panel" aria-label="Proprietà">
          <div className="panel-heading"><div><p className="eyebrow">Controlli</p><h2>{selected?.name ?? (room ? 'Nessuna selezione' : 'Importa una stanza')}</h2></div>{selected && <span className="type-badge">{surfaceLabels[selected.kind]}</span>}</div>
          {room && <div className="asset-card"><span>{room.sourceType === 'floorplan' ? 'PLAN' : 'IMG'}</span><div><strong>{room.file.name}</strong><small>{room.sourceType === 'floorplan' ? 'Planimetria originale' : importedCaption}</small></div><label htmlFor={room.sourceType === 'floorplan' ? 'floorplan-file' : 'room-file'}>Sostituisci</label></div>}
          {selected ? <><div className="property-section"><div className="property-title"><span>Nome superficie</span><span className="editable-badge">Personalizzabile</span></div><div className="rename-control"><input aria-label="Nome superficie" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} /><button type="button" onClick={renameSelected} disabled={!renameDraft.trim() || renameDraft.trim() === selected.name}>Salva</button></div></div><div className="property-section"><div className="property-title"><span>Protezione superficie</span><span className={`editable-badge ${selected.frozen ? 'frozen' : ''}`}>{selected.frozen ? 'Frozen' : 'Modificabile'}</span></div><button className={`freeze-button ${selected.frozen ? 'is-active' : ''}`} type="button" aria-label={selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'} onClick={toggleFreeze}><span>{selected.frozen ? '◆' : '◇'}</span>{selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'}<small>{selected.frozen ? 'Protetta' : 'Attivo subito'}</small></button><button className="freeze-others-button" type="button" onClick={freezeAllExceptSelected}>Blocca tutto tranne {selected.name}</button></div>
            <div className="property-section product-search-section">
              <div className="property-title"><span>Come vuoi inserire il prodotto?</span></div>
              <div className="product-entry-cards" aria-label="Modalità inserimento prodotto">
                <button type="button" className="product-entry-card is-primary" onClick={() => document.querySelector<HTMLInputElement>('.guided-search input')?.focus()}><span>⌕</span><strong>Cerca online</strong><small>Marca, modello, colore o link</small></button>
                <button type="button" className="product-entry-card" onClick={() => furnitureInputRef.current?.click()}><span>▣</span><strong>Foto prodotto</strong><small>BRIA rimuove lo sfondo</small></button>
                <button type="button" className="product-entry-card" onClick={() => materialInputRef.current?.click()}><span>▦</span><strong>Campione materiale</strong><small>Per pavimenti e pareti</small></button>
              </div>
              <div className="product-search-heading"><strong>Ricerca normale</strong><span>oppure incolla il link del prodotto</span></div>
              {aiStatus !== 'ready' && <div className="ai-setup-banner"><strong>{isLocalPreview() ? 'Anteprima locale' : aiStatus === 'missing' ? 'IA non configurata sul server' : 'IA momentaneamente non raggiungibile'}</strong><span>{isLocalPreview() ? 'Grok è configurata sul sito online; qui verifichi interfaccia e posizionamento senza usare credenziali.' : 'La chiave resta protetta sul server. Puoi comunque premere il comando: l’app riproverà il collegamento.'}</span></div>}
              <div className="guided-search" aria-label="Criteri di ricerca prodotto"><label><span>Marca o produttore</span><input aria-label="Marca o produttore" value={searchBrand} onChange={(event) => setSearchBrand(event.target.value)} placeholder="Es. Lea Ceramiche" /></label><label><span>Modello o collezione</span><input aria-label="Modello o collezione" value={searchModel} onChange={(event) => setSearchModel(event.target.value)} placeholder="Es. Intense" /></label><label><span>Colore</span><input aria-label="Colore prodotto" value={searchColor} onChange={(event) => setSearchColor(event.target.value)} placeholder="Es. Clair" /></label><label><span>Tipo prodotto</span><select aria-label="Tipo prodotto" value={searchCategory} onChange={(event) => setSearchCategory(event.target.value as ProductSearchCategory)}><option value="">Tutti</option><option value="Pavimenti">Pavimenti</option><option value="Rivestimenti">Rivestimenti</option><option value="Colori">Colori parete</option><option value="Arredi">Mobili e arredi</option></select></label></div>
              <label className="free-search-label"><span>Altri dettagli facoltativi</span><input className="material-search" aria-label="Cerca materiali, colori o mobili" value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchProductsOnline(); }} placeholder="Es. effetto pietra, 60 × 120, opaco" /></label>
              <label className="free-search-label"><span>Link prodotto facoltativo · ricerca più veloce</span><input className="material-search" type="url" inputMode="url" aria-label="Link prodotto" value={searchSourceUrl} onChange={(event) => setSearchSourceUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchProductsOnline(); }} placeholder="https://sito-produttore.it/prodotto" /></label>
              <div className="guided-search-actions"><button type="button" className="reset-search-button" onClick={resetProductSearch}>Azzera</button><button type="button" className="guided-search-button" onClick={() => void searchProductsOnline()} disabled={isSearchingProducts}>{isSearchingProducts ? 'Cerco nei cataloghi…' : `Cerca con ${aiProviderLabel ?? 'IA'}`}</button></div>
              <div className="search-scope"><span>Materiali</span><span>Colori</span><span>Arredi</span><span className="internet-ready">Prodotti reali con fonte</span></div>
              {onlineMaterials.length > 0 && <div className="online-results"><strong>Risultati online</strong>{onlineMaterials.map((item) => { const missingFurnitureImage = item.category === 'Arredi' && !item.previewUrl; return <div className={`online-product ${material?.id === item.id ? 'is-selected' : ''}`} key={item.id}>{item.previewUrl ? <img src={item.previewUrl} alt={`Riferimento ${item.name}`} /> : <span className="catalog-swatch tile" /> }<button type="button" onClick={() => void chooseOnlineProduct(item)} disabled={missingFurnitureImage} title={missingFurnitureImage ? 'Serve una foto prodotto prima di inserire questo mobile' : undefined}><strong>{item.brand} · {item.name}</strong><span className={`reference-badge reference-${item.referenceKind ?? 'metadata-only'}`}>{materialReferenceLabel(item)}</span><small>{item.description}</small></button><a href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte</a></div>; })}</div>}
              <div className="material-results">{filteredMaterials.map((item) => <button type="button" key={item.id} className={`material-result ${material?.id === item.id ? 'is-selected' : ''}`} onClick={() => chooseMaterial(item)}><span className={`catalog-swatch ${item.pattern ?? 'color'}`} style={{ '--swatch-color': item.color } as CSSProperties} /><span><strong>{item.name}</strong><small>{item.category} · {item.description}</small></span></button>)}{filteredFurniture.map((item) => <button type="button" key={item.name} className={`material-result furniture-result ${pendingFurniture?.name === item.name ? 'is-selected' : ''}`} onClick={() => startFurniturePlacement(item.name, item.previewUrl, item.description, undefined, item.previewUrl, item.sidePreviewUrl)}>{item.previewUrl ? <img className="furniture-result-preview" src={item.previewUrl} alt="" /> : <span className="furniture-icon">＋</span>}<span><strong>{item.name}</strong><small>Tocca e poi scegli il punto nella stanza · {item.description}</small></span></button>)}{filteredMaterials.length === 0 && filteredFurniture.length === 0 && onlineMaterials.length === 0 && <div className="custom-search-result"><p>Nessun campione incluso corrisponde. Per trovare marca e prodotto esatti serve la ricerca IA attiva.</p><button type="button" onClick={addCustomRequest}>Aggiungi “{materialQuery.trim()}” alla richiesta</button></div>}</div>
              <div className="custom-color"><input type="color" aria-label="Scegli colore personalizzato" value={customColor} onChange={(event) => setCustomColor(event.target.value)} /><button type="button" onClick={chooseCustomColor}>Usa questo colore</button></div>
              {material && <div className="loaded-material">{material.previewUrl ? <img src={material.previewUrl} alt={`Campione ${material.name}`} /> : <span className="catalog-swatch tile" />}<div><strong>{material.name}</strong><small>{materialReferenceLabel(material)}</small></div></div>}
              {materialNeedsSample && <p className="material-search-note"><strong>Serve una texture pulita.</strong> La foto del catalogo contiene elementi della stanza e non verrà usata sul pavimento. Premi “Carica campione”.</p>}
              <button className="auto-apply-product-button" type="button" onClick={() => void applyMaterialAutomatically()} disabled={!material || isApplyingProduct || materialNeedsSample}>{isApplyingProduct ? 'Adatto il prodotto alla stanza…' : materialNeedsSample ? 'Carica un campione per applicarlo' : material?.referenceKind === 'metadata-only' ? `Prova resa indicativa di ${material.name}` : `Applica automaticamente ${material?.name ?? 'il prodotto'}`}</button>
              <button className="apply-button secondary-apply" type="button" aria-label={`Applica a ${selected.name}`} onClick={applyMaterial} disabled={!material || selected.frozen || materialNeedsSample}>Oppure applica solo a {selected.name}</button>
              <p className="material-search-note">L’app sceglie pavimento o muro, corregge prospettiva e scala, e lascia identiche tutte le zone Freeze. La resa è fedele al prodotto solo quando compare “Texture ufficiale verificata” o usi un tuo campione.</p>
            </div>
            <div className="property-section furniture-section"><div className="property-title"><span>Mobili nella stanza</span><span className="editable-badge">{placedFurniture.length + customRequests.length} scelti</span></div><button className="upload-furniture-button" type="button" onClick={() => furnitureInputRef.current?.click()}>＋ Carica la foto di un mobile</button>{placedFurniture.length || customRequests.length ? <div className="selected-assets">{placedFurniture.map((item, index) => <button type="button" className={selectedFurnitureId === item.id ? 'is-selected' : ''} key={item.id} onClick={() => setSelectedFurnitureId(item.id)}>{item.name} {placedFurniture.filter((candidate) => candidate.name === item.name).length > 1 ? index + 1 : ''}<span>{item.frozen ? '◆' : '›'}</span></button>)}{customRequests.map((item) => <button type="button" key={item} onClick={() => setCustomRequests((current) => current.filter((name) => name !== item))}>{item}<span>×</span></button>)}</div> : <p className="no-results">Cerca un mobile, toccalo e poi indica direttamente il punto sul pavimento.</p>}{selectedFurniture && <div className="furniture-controls"><div><strong>{selectedFurniture.name}</strong><span>{selectedFurniture.frozen ? 'Posizione bloccata' : selectedFurniture.autoScale ? 'Auto attivo: trascinalo avanti o indietro e la misura cambia' : 'Misura manuale: premi Ripristina Auto per riadattarla'}</span></div><div className="furniture-facing-controls" aria-label="Parete di orientamento"><span>Schienale verso</span>{(Object.keys(furnitureFacingLabels) as FurnitureFacing[]).map((facing) => <button type="button" key={facing} className={selectedFurniture.facing === facing ? 'is-active' : ''} onClick={() => orientSelectedFurniture(facing)} disabled={selectedFurniture.frozen}>{furnitureFacingLabels[facing]}</button>)}</div><div className="furniture-control-grid"><button type="button" onClick={() => resizeSelectedFurniture(-3)} disabled={selectedFurniture.frozen} aria-label="Rimpicciolisci mobile">− Piccolo</button><button type="button" onClick={() => resizeSelectedFurniture(3)} disabled={selectedFurniture.frozen} aria-label="Ingrandisci mobile">＋ Grande</button></div><button className={`auto-size-furniture-button ${selectedFurniture.autoScale ? 'is-active' : ''}`} type="button" onClick={restoreAutomaticFurnitureScale} disabled={selectedFurniture.frozen || selectedFurniture.autoScale}>{selectedFurniture.autoScale ? `✓ Auto attivo · ${Math.round(selectedFurniture.scale)}%` : '◎ Ripristina misura automatica'}</button><button className={`freeze-furniture-button ${selectedFurniture.frozen ? 'is-active' : ''}`} type="button" onClick={() => updateSelectedFurniture({ frozen: !selectedFurniture.frozen })}>{selectedFurniture.frozen ? '◇ Sblocca posizione' : '◆ Blocca posizione'}</button><button className="remove-furniture-button" type="button" onClick={removeSelectedFurniture} disabled={selectedFurniture.frozen}>Rimuovi mobile</button></div>}<p className="material-search-note">La scala automatica considera tipo di mobile e profondità sul pavimento. Grok rifinisce proporzioni, prospettiva, luci e ombre nel render.</p></div>
            <div className="property-section metrics"><div><span>Vertici</span><strong>{selected.points.length}</strong></div><div><span>Stato</span><strong>{selected.frozen ? 'Lock' : 'Edit'}</strong></div><div><span>Texture</span><strong>{selected.materialId ? 'Sì' : 'No'}</strong></div></div><button className="remove-button" type="button" onClick={deleteSelected} disabled={selected.frozen}>Elimina superficie</button></> : room ? <div className="empty-properties"><strong>Seleziona un contorno</strong><p>Tocca una superficie sulla foto o sceglila dall’elenco. Puoi anche disegnarne una nuova.</p></div> : null}
          {room && <button className="remove-room-button" type="button" onClick={removeRoom}>Chiudi progetto</button>}
          <div className="phase-card"><span className="phase-index">0.3</span><div><p className="eyebrow">Modalità prova</p><strong>IA e Freeze pronti</strong><p>Ricerca prodotti, stanza vuota e render vengono elaborati dal server senza mostrare chiavi nell’app.</p></div></div>
        </aside>
      </div>
      {renderSummaryOpen && <div className="render-modal" role="dialog" aria-modal="true" aria-labelledby="render-summary-title"><div className="render-modal-card"><button className="modal-close" type="button" onClick={() => setRenderSummaryOpen(false)} aria-label="Chiudi riepilogo">×</button><p className="eyebrow">Richiesta pronta</p><h2 id="render-summary-title">Crea il render reale</h2><div className="render-checks"><div><span>Superfici con materiale</span><strong>{surfaces.filter((surface) => surface.materialId).length}</strong></div><div><span>Zone protette</span><strong>{surfaces.filter((surface) => surface.frozen).length}</strong></div><div><span>Mobili posizionati</span><strong>{placedFurniture.length}</strong></div></div><div className="render-list"><strong>Il motore riceverà:</strong><p>{surfaces.filter((surface) => surface.materialId).map((surface) => `${surface.name}: ${materialMap.get(surface.materialId!)?.name ?? 'materiale'}`).join(' · ') || 'Nessun materiale ancora applicato'}</p><p>{placedFurniture.length || customRequests.length ? `Da inserire: ${[...placedFurniture.map((item) => `${item.name} nel punto scelto`), ...customRequests].join(', ')}` : 'Nessun arredo aggiunto'}</p></div><div className="engine-warning"><span>AI</span><p><strong>{aiStatus === 'ready' ? `${aiProviderLabel ?? 'IA'} attiva` : 'L’app riproverà il collegamento'}</strong>L’IA riceve una maschera limitata a prodotti e mobili. Il resto della stanza, incluse aperture e Freeze, viene ricopiato pixel per pixel.</p></div><button className="modal-primary" type="button" onClick={() => void createFinalRender()} disabled={isRendering}>{isRendering ? 'Creo il render…' : 'Crea render reale con IA'}</button><button className="modal-secondary" type="button" onClick={() => setRenderSummaryOpen(false)}>Torna alle modifiche</button></div></div>}
    </main>
  );
}
