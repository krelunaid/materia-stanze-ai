'use client';

/* eslint-disable @next/next/no-img-element -- room and material previews are local blob URLs */

import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { drawImageCover } from '../lib/canvas-draw';
import {
  cleanupTileBoundsFromRect,
  cleanupTileEdgeIsInternal,
  cleanupTileMaskEnvelope,
  cleanupProtectionMode,
  cleanupTileRatioMatches,
  CleanupTileBounds,
  CleanupTileImageSize,
  CleanupTileMaskEnvelope,
  CleanupTilePixelRect,
  CleanupTilePlan,
  CleanupTileSplitEdge,
  planCleanupTiles,
  planRoomCleanupPass,
  pointInCleanupTile,
  snapCleanupTileRect,
} from '../lib/cleanup-tiles';
import { AcceptedRoomFile, formatBytes, validateRoomFile } from '../lib/file-validation';
import { MaterialReferenceKind, requiresVerifiedSurfaceSample } from '../lib/material-reference';
import { furnitureEditRect, hasCompatibleImageGeometry, rectPoints } from '../lib/render-geometry';
import { NormalizedProductBounds, removeConnectedProductBackground } from '../lib/product-cutout';
import { assessVisibleSurfaceEdit } from '../lib/surface-edit-difference';
import { geometryForDerivedImage, geometrySnapshotsAfterEdit } from '../geometry/model';
import { inferRoomMeasurement, measuredFurnitureScale, productWidthMeters, RoomMeasurement } from '../geometry/measurement';
import { buildStoredProject, loadProject, saveProject } from '../geometry/project-store';
import { openingCoverageInWall, validateRoomGeometry } from '../geometry/validate';
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
type DragVertex = { kind: 'vertex'; surfaceId: string; vertexIndex: number; pointerId: number; origin: Point; linked: LinkedVertex[] };
type DragEdgeEndpoint = { origin: Point; linked: LinkedVertex[] };
type DragEdge = { kind: 'edge'; surfaceId: string; edgeIndex: number; pointerId: number; start: Point; endpoints: [DragEdgeEndpoint, DragEdgeEndpoint] };
type GeometryDrag = DragVertex | DragEdge;
type FurnitureFacing = 'front-wall' | 'left-wall' | 'right-wall';
type PlacedFurniture = {
  id: string;
  name: string;
  x: number;
  y: number;
  scale: number;
  autoScale: boolean;
  facing: FurnitureFacing;
  rotation: number;
  frozen: boolean;
  previewUrl?: string;
  sidePreviewUrl?: string;
  cutoutUrl?: string;
  preparedViews?: Partial<Record<FurnitureFacing, string>>;
  description?: string;
};
type PendingFurniture = { name: string; previewUrl?: string; sidePreviewUrl?: string; cutoutUrl?: string; preparedViews?: Partial<Record<FurnitureFacing, string>>; description?: string; file?: File };
type DragFurniture = { id: string; pointerId: number; offsetX: number; offsetY: number; previous: PlacedFurniture[] };
type CleanupRegion = { label: string; points: Point[]; confidence: number; internalEdges?: CleanupTileSplitEdge[] };
type CleanupTileResult = {
  bounds: CleanupTileBounds;
  pixelRect: CleanupTilePixelRect;
  sourceSize: CleanupTileImageSize;
  envelope: CleanupTileMaskEnvelope;
  regions: CleanupRegion[];
  image: string;
};
type AiStatus = 'checking' | 'ready' | 'missing' | 'unreachable';
type GeometryDetectionStatus = 'ai' | 'fallback' | 'opening-invalid' | 'shell-invalid' | 'opening-shell-invalid' | null;
type ManualOpeningMode = 'rectangle' | 'arch' | null;
type DetectedSurface = {
  id?: string;
  name: string;
  kind: SurfaceKind;
  points: Point[];
  confidence: number;
  slot?: Surface['slot'];
  parentId?: string;
  audited?: boolean;
  thresholdInferred?: boolean;
};
type ProductSearchCategory = '' | StudioMaterial['category'];
type ProductPhotoClassification = {
  kind: 'furniture' | 'surface-material' | 'unknown';
  category: 'Pavimenti' | 'Rivestimenti' | 'Arredi';
  confidence: number;
  usableSample: boolean;
  sampleBounds: NormalizedProductBounds;
  label: string;
  reason: string;
  message?: string;
};

function clientValidatedSurfaces(input: DetectedSurface[], idPrefix: string): Surface[] {
  const candidates = input.filter((surface) => !surface.id?.startsWith('demo-')).map((surface, index) => ({
    ...surface,
    id: surface.id ?? `${idPrefix}-${index}`,
    confidence: Number.isFinite(surface.confidence) ? surface.confidence : 0,
  }));
  return validateRoomGeometry(candidates, { source: 'user' }).surfaces.map((surface) => ({
    ...surface,
    frozen: false,
    source: 'ai' as const,
  }));
}

const HOSTED_SITE = 'https://materia-stanze-ai.andreagadducci.chatgpt.site';

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
  const measuredWidth = productWidthMeters(name, description);
  if (measuredWidth) return Math.min(46, Math.max(14, measuredWidth * 100 / 6.2));
  if (/divano|sofa/.test(normalized)) return 40;
  if (/letto/.test(normalized)) return 36;
  if (/tavolo/.test(normalized)) return 32;
  if (/tappeto|cucina/.test(normalized)) return 38;
  if (/armadio|mobile tv/.test(normalized)) return 28;
  if (/poltrona|sedia|sedie/.test(normalized)) return 20;
  if (/lampada/.test(normalized)) return 14;
  return 25;
}

function perspectiveFurnitureScale(name: string, description: string | undefined, y: number, floorContact: number, floor: Surface | undefined, roomMeasurement: RoomMeasurement) {
  const depth = Math.min(1, Math.max(0, (y - floorContact) / Math.max(.08, .96 - floorContact)));
  const fallback = Math.round(Math.min(55, Math.max(12, furnitureBaseScale(name, description) * (.84 + depth * .34))) * 10) / 10;
  return measuredFurnitureScale({ name, description, y, floor, room: roomMeasurement, fallback });
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

function normalizeProductSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('it')
    .replace(/\b(?:parquel|parqet|parket|parke|parche|parquetto)\b/g, 'parquet')
    .replace(/\bpavimenti\b/g, 'pavimento')
    .replace(/\blegni\b/g, 'legno')
    .replace(/\broveri\b/g, 'rovere')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function correctedOnlineCategory(item: { name: string; collection?: string; category: StudioMaterial['category']; effect?: string; description?: string }) {
  const text = normalizeProductSearch(`${item.name} ${item.collection ?? ''} ${item.effect ?? ''} ${item.description ?? ''}`);
  if (/\b(?:carta da parati|wallpaper|wallcovering|tappezzeria|rivestimento murale)\b/.test(text)) return 'Rivestimenti' as const;
  if (/\b(?:parquet|pavimento|flooring|doghe)\b/.test(text)) return 'Pavimenti' as const;
  if (/\b(?:pittura murale|vernice murale|wall paint)\b/.test(text)) return 'Colori' as const;
  return item.category;
}

function catalogSearchText(item: StudioMaterial) {
  const aliases = item.category === 'Pavimenti'
    ? 'pavimento pavimenti parquet legno rovere doghe posa suolo'
    : item.id === 'travertine'
      ? 'pietra marmo beige lastra'
      : item.id === 'concrete'
        ? 'cemento calcestruzzo grigio materico piastrella'
        : item.category === 'Colori'
          ? 'parete muro pittura vernice colore'
          : 'rivestimento parete muro piastrella';
  return normalizeProductSearch(`${item.name} ${item.category} ${item.description} ${aliases}`);
}

function catalogSuggestions(rawQuery: string, requestedCategory: ProductSearchCategory) {
  const query = normalizeProductSearch(rawQuery);
  const flooringIntent = /\b(?:pavimento|parquet|legno|rovere|doghe)\b/.test(query);
  const effectiveCategory = requestedCategory || (flooringIntent ? 'Pavimenti' : '');
  const candidates = effectiveCategory
    ? catalogMaterials.filter((item) => item.category === effectiveCategory)
    : catalogMaterials;
  if (!query) return candidates.slice(0, 4);
  const tokens = query.split(/\s+/).filter((token) => token.length > 1);
  const ranked = candidates.map((item, index) => {
    const haystack = catalogSearchText(item);
    const matched = tokens.filter((token) => haystack.includes(token)).length;
    const intentBonus = flooringIntent && item.category === 'Pavimenti' ? 4 : 0;
    const woodBonus = /\b(?:parquet|legno|rovere|doghe)\b/.test(query) && item.pattern === 'wood' ? 3 : 0;
    return { item, score: matched * 3 + intentBonus + woodBonus, index };
  }).filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
  return ranked.length ? ranked.slice(0, 4) : effectiveCategory ? candidates.slice(0, 4) : [];
}

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

function surfaceLabelPoint(surface: Surface) {
  return surface.points.reduce((center, point) => ({ x: center.x + point.x / surface.points.length, y: center.y + point.y / surface.points.length }), { x: 0, y: 0 });
}

function surfaceCenter(surface: Surface) {
  return surfaceLabelPoint(surface);
}

function pointInsidePolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function openingSlot(points: Point[]): Surface['slot'] {
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  return x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center';
}

function snapOpeningExtrema(points: Point[]) {
  const result = points.map((point) => ({ ...point }));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return result.map((point) => ({
    x: minX <= .04 && Math.abs(point.x - minX) < .012 ? 0
      : maxX >= .96 && Math.abs(point.x - maxX) < .012 ? 1 : point.x,
    y: minY <= .04 && Math.abs(point.y - minY) < .012 ? 0
      : maxY >= .96 && Math.abs(point.y - maxY) < .012 ? 1 : point.y,
  }));
}

function orderManualOpeningQuad(points: Point[]) {
  if (points.length !== 4) return points;
  const center = points.reduce((result, point) => ({
    x: result.x + point.x / points.length,
    y: result.y + point.y / points.length,
  }), { x: 0, y: 0 });
  const ordered = [...points].sort((left, right) => (
    Math.atan2(left.y - center.y, left.x - center.x)
    - Math.atan2(right.y - center.y, right.x - center.x)
  ));
  const start = ordered.reduce((best, point, index) => (
    point.x + point.y < ordered[best].x + ordered[best].y ? index : best
  ), 0);
  return [...ordered.slice(start), ...ordered.slice(0, start)];
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

function floorBoundsAtY(surface: Surface | undefined, y: number) {
  if (!surface || surface.points.length < 3) return { left: .04, right: .96 };
  const intersections: number[] = [];
  for (let index = 0; index < surface.points.length; index += 1) {
    const first = surface.points[index];
    const second = surface.points[(index + 1) % surface.points.length];
    if ((first.y <= y && second.y >= y) || (second.y <= y && first.y >= y)) {
      if (Math.abs(second.y - first.y) < .0001) continue;
      const ratio = (y - first.y) / (second.y - first.y);
      if (ratio >= 0 && ratio <= 1) intersections.push(first.x + (second.x - first.x) * ratio);
    }
  }
  return intersections.length >= 2
    ? { left: Math.min(...intersections), right: Math.max(...intersections) }
    : { left: Math.min(...surface.points.map((point) => point.x)), right: Math.max(...surface.points.map((point) => point.x)) };
}

function snapFurnitureToWall(item: PlacedFurniture, facing: FurnitureFacing, floor: Surface | undefined) {
  if (facing === 'front-wall') {
    const y = Math.min(.94, Math.max(.08, floorContactYAtX(floor, item.x) + .025));
    return { ...item, facing, y };
  }
  const floorContact = floorContactYAtX(floor, item.x);
  const y = Math.min(.94, Math.max(floorContact + .04, item.y));
  const bounds = floorBoundsAtY(floor, y);
  const wallOffset = Math.min(.11, Math.max(.025, item.scale / 420));
  const x = facing === 'left-wall'
    ? Math.min(.94, Math.max(.04, bounds.left + wallOffset))
    : Math.min(.96, Math.max(.06, bounds.right - wallOffset));
  return { ...item, facing, x, y };
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
  const frozenMatch = (surface: Surface) => frozenSurfaces.find((frozen) => {
    if (surface.kind !== frozen.kind) return false;
    if (surface.name.toLocaleLowerCase('it') === frozen.name.toLocaleLowerCase('it')) return true;
    const center = surfaceCenter(surface);
    const frozenCenter = surfaceCenter(frozen);
    return Math.hypot(center.x - frozenCenter.x, center.y - frozenCenter.y) < .22;
  });
  const editableDetected = detected.filter((surface) => !frozenMatch(surface));
  const inherited = inheritSurfaceState(editableDetected, editableSurfaces);
  const inheritedIds = new Map<string, string>();
  editableDetected.forEach((surface, index) => {
    if (surface.id) inheritedIds.set(surface.id, inherited[index]?.id ?? surface.id);
  });
  detected.filter((surface) => frozenMatch(surface)).forEach((surface) => {
    const frozen = frozenMatch(surface);
    if (surface.id && frozen) inheritedIds.set(surface.id, frozen.id);
  });
  const remapped = inherited.map((surface) => surface.parentId && inheritedIds.has(surface.parentId)
    ? { ...surface, parentId: inheritedIds.get(surface.parentId) }
    : surface);
  return [...remapped, ...frozenSurfaces];
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
    // The skirting belongs to the vertical planes.  Their lower boundary and
    // the floor upper boundary meet at the skirting-floor contact, not at the
    // visually stronger upper trim edge.
    { name: 'Muro 1', kind: 'wall', frozen: false, points: [{ x: .218, y: .13 }, { x: .785, y: .13 }, { x: .785, y: .714 }, { x: .218, y: .714 }] },
    { name: 'Muro 2', kind: 'wall', frozen: false, points: [{ x: 0, y: 0 }, { x: .218, y: .13 }, { x: .218, y: .714 }, { x: 0, y: .8885 }] },
    { name: 'Muro 3', kind: 'wall', frozen: false, points: [{ x: .785, y: .13 }, { x: 1, y: 0 }, { x: 1, y: .8885 }, { x: .785, y: .714 }] },
    { name: 'Pavimento', kind: 'floor', frozen: false, points: [{ x: .218, y: .714 }, { x: .785, y: .714 }, { x: 1, y: .8885 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: .8885 }] },
    { name: 'Soffitto', kind: 'ceiling', frozen: false, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .785, y: .13 }, { x: .218, y: .13 }] },
    { name: 'Finestra', kind: 'window', frozen: false, points: [{ x: .334, y: .18 }, { x: .667, y: .18 }, { x: .667, y: .552 }, { x: .334, y: .552 }] },
  ];
  return presets.map((surface, index) => ({ ...surface, id: `demo-${Date.now()}-${index}` }));
}

function strongestEdge(scores: number[], start: number, end: number, fallback: number) {
  let bestIndex = Math.round(scores.length * fallback);
  let bestScore = 0;
  const from = Math.max(1, Math.round(scores.length * start));
  const to = Math.min(scores.length - 2, Math.round(scores.length * end));
  const smoothed: Array<{ index: number; raw: number; weighted: number }> = [];
  for (let index = from; index <= to; index += 1) {
    const raw = (scores[index - 1] + scores[index] * 2 + scores[index + 1]) / 4;
    const distance = Math.abs(index / scores.length - fallback);
    const perspectivePrior = .72 + .28 * Math.exp(-Math.pow(distance / .18, 2));
    const weighted = raw * perspectivePrior;
    smoothed.push({ index, raw, weighted });
    if (weighted > bestScore) { bestScore = weighted; bestIndex = index; }
  }
  const rawScores = smoothed.map((candidate) => candidate.raw).sort((a, b) => a - b);
  const median = rawScores[Math.floor(rawScores.length / 2)] ?? 0;
  const average = rawScores.reduce((sum, score) => sum + score, 0) / Math.max(1, rawScores.length);
  const selected = smoothed.find((candidate) => candidate.index === bestIndex);
  const prominenceBase = Math.max(1, median * 1.3, average * 1.12);
  if (!selected || selected.raw < prominenceBase) return fallback;
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

async function cropMaterialSample(source: string, bounds: NormalizedProductBounds) {
  const image = await loadImageSource(source);
  const left = Math.min(1, Math.max(0, bounds.left));
  const top = Math.min(1, Math.max(0, bounds.top));
  const right = Math.min(1, Math.max(left, bounds.right));
  const bottom = Math.min(1, Math.max(top, bounds.bottom));
  const sourceWidth = Math.max(1, Math.round((right - left) * image.naturalWidth));
  const sourceHeight = Math.max(1, Math.round((bottom - top) * image.naturalHeight));
  const scale = Math.min(1, 1024 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Non posso preparare il campione del materiale.');
  context.drawImage(
    image,
    Math.round(left * image.naturalWidth),
    Math.round(top * image.naturalHeight),
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Non posso preparare il campione del materiale.');
  return blob;
}

async function createCombinedRenderReference(
  materialSample: Blob,
  furnitureReference: Blob,
  materialName: string,
  furnitureName: string,
) {
  const materialUrl = URL.createObjectURL(materialSample);
  const furnitureUrl = URL.createObjectURL(furnitureReference);
  try {
    const [materialImage, furnitureImage] = await Promise.all([
      loadImageSource(materialUrl),
      loadImageSource(furnitureUrl),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 700;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Non posso preparare i riferimenti del render.');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#d8f3ea';
    context.fillRect(0, 0, canvas.width / 2, 86);
    context.fillStyle = '#f5ead2';
    context.fillRect(canvas.width / 2, 0, canvas.width / 2, 86);
    context.fillStyle = '#10211e';
    context.font = '700 28px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`MATERIALE · ${materialName.slice(0, 28)}`, canvas.width / 4, 43);
    context.fillText(`MOBILE · ${furnitureName.slice(0, 28)}`, canvas.width * .75, 43);

    const drawContained = (image: HTMLImageElement, left: number, top: number, width: number, height: number, cover = false) => {
      const scale = cover
        ? Math.max(width / image.naturalWidth, height / image.naturalHeight)
        : Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      context.save();
      context.beginPath();
      context.rect(left, top, width, height);
      context.clip();
      context.drawImage(image, left + (width - drawWidth) / 2, top + (height - drawHeight) / 2, drawWidth, drawHeight);
      context.restore();
    };

    drawContained(materialImage, 18, 104, 564, 578, true);
    drawContained(furnitureImage, 618, 104, 564, 578);
    context.strokeStyle = '#9eb7af';
    context.lineWidth = 3;
    context.strokeRect(18, 104, 564, 578);
    context.strokeRect(618, 104, 564, 578);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Non posso preparare i riferimenti del render.');
    return blob;
  } finally {
    URL.revokeObjectURL(materialUrl);
    URL.revokeObjectURL(furnitureUrl);
  }
}

export function friendlyRequestError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught ?? '');
  if (/the network connection was lost|failed to fetch|load failed|network request failed|not connected|offline|internet connection appears to be offline/i.test(message)) {
    return new Error('Connessione interrotta. La stanza resta aperta: controlla la rete e riprova l’operazione.');
  }
  return caught instanceof Error ? caught : new Error('Il servizio non è raggiungibile. Controlla la connessione e riprova.');
}

function colorStabilizedRoomLayer(
  original: CanvasImageSource & { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number },
  generated: CanvasImageSource & { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number },
  width: number,
  height: number,
) {
  const originalCanvas = document.createElement('canvas');
  const generatedCanvas = document.createElement('canvas');
  originalCanvas.width = generatedCanvas.width = width;
  originalCanvas.height = generatedCanvas.height = height;
  const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
  const generatedContext = generatedCanvas.getContext('2d', { willReadFrequently: true });
  if (!originalContext || !generatedContext) return generatedCanvas;
  drawImageCover(originalContext, original, width, height);
  drawImageCover(generatedContext, generated, width, height);
  const originalImage = originalContext.getImageData(0, 0, width, height);
  const generatedImage = generatedContext.getImageData(0, 0, width, height);
  const sourceSum = [0, 0, 0]; const sourceSquare = [0, 0, 0];
  const generatedSum = [0, 0, 0]; const generatedSquare = [0, 0, 0];
  let samples = 0;

  // Furniture normally occupies the lower centre. Calibrate against the top
  // and outer architectural bands, which should retain the camera's original
  // exposure and white balance after an empty-room edit.
  const stride = Math.max(1, Math.round(Math.max(width, height) / 420));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (y >= height * .42 && x >= width * .1 && x <= width * .9) continue;
      const offset = (y * width + x) * 4;
      const sourceLuma = originalImage.data[offset] * .2126 + originalImage.data[offset + 1] * .7152 + originalImage.data[offset + 2] * .0722;
      const generatedLuma = generatedImage.data[offset] * .2126 + generatedImage.data[offset + 1] * .7152 + generatedImage.data[offset + 2] * .0722;
      if (Math.abs(sourceLuma - generatedLuma) > 72) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const source = originalImage.data[offset + channel];
        const result = generatedImage.data[offset + channel];
        sourceSum[channel] += source; sourceSquare[channel] += source * source;
        generatedSum[channel] += result; generatedSquare[channel] += result * result;
      }
      samples += 1;
    }
  }
  if (samples < 128) return generatedCanvas;
  const correction = [0, 1, 2].map((channel) => {
    const sourceMean = sourceSum[channel] / samples;
    const resultMean = generatedSum[channel] / samples;
    const sourceDeviation = Math.sqrt(Math.max(1, sourceSquare[channel] / samples - sourceMean * sourceMean));
    const resultDeviation = Math.sqrt(Math.max(1, generatedSquare[channel] / samples - resultMean * resultMean));
    const gain = Math.min(1.12, Math.max(.88, sourceDeviation / resultDeviation));
    return { gain, offset: sourceMean - resultMean * gain };
  });
  for (let offset = 0; offset < generatedImage.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      generatedImage.data[offset + channel] = Math.min(255, Math.max(0, Math.round(
        generatedImage.data[offset + channel] * correction[channel].gain + correction[channel].offset,
      )));
    }
  }
  generatedContext.putImageData(generatedImage, 0, 0);
  return generatedCanvas;
}

async function createGeometryInput(source: string) {
  const image = await loadImageSource(source);
  // Thin jambs and open doors disappear too easily at 1024 px. Keep one
  // EXIF-corrected working image large enough for architectural edges.
  const maximumSide = 1536;
  const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Non posso preparare la foto per il riconoscimento.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .9));
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
    throw friendlyRequestError(caught);
  } finally {
    window.clearTimeout(timer);
  }
}

export function RoomStudio() {
  const [room, setRoom] = useState<ImportedRoom | null>(null);
  const [roomRatio, setRoomRatio] = useState(16 / 10);
  const [canvasCssSize, setCanvasCssSize] = useState({ width: 1000, height: 625 });
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [pastSurfaces, setPastSurfaces] = useState<Surface[][]>([]);
  const [futureSurfaces, setFutureSurfaces] = useState<Surface[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [drawKind, setDrawKind] = useState<SurfaceKind | null>(null);
  const [quickDraw, setQuickDraw] = useState(false);
  const [manualOpeningMode, setManualOpeningMode] = useState<ManualOpeningMode>(null);
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
  const [pastFurniture, setPastFurniture] = useState<PlacedFurniture[][]>([]);
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
  const [isCreatingFloorplanRoom, setIsCreatingFloorplanRoom] = useState(false);
  const [isAutoFitting, setIsAutoFitting] = useState(false);
  const [isEmptyingRoom, setIsEmptyingRoom] = useState(false);
  const [isPickingCleanup, setIsPickingCleanup] = useState(false);
  const [isDetectingCleanup, setIsDetectingCleanup] = useState(false);
  const [isCleaningRegion, setIsCleaningRegion] = useState(false);
  const [cleanupRegion, setCleanupRegion] = useState<CleanupRegion | null>(null);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [isClassifyingProduct, setIsClassifyingProduct] = useState(false);
  const [isPreparingFurniture, setIsPreparingFurniture] = useState(false);
  const [isApplyingProduct, setIsApplyingProduct] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>('checking');
  const [aiProviderLabel, setAiProviderLabel] = useState<string | null>(null);
  const [aiServiceLabels, setAiServiceLabels] = useState<string[]>([]);
  const [processedPreview, setProcessedPreview] = useState<string | null>(null);
  const [processedLabel, setProcessedLabel] = useState('Stanza vuota');
  const [showProcessedPreview, setShowProcessedPreview] = useState(false);
  const [localCleaningTestAvailable, setLocalCleaningTestAvailable] = useState(false);
  const [dragVertex, setDragVertex] = useState<DragVertex | null>(null);
  const [dragEdge, setDragEdge] = useState<DragEdge | null>(null);
  const [isCorrectingEdges, setIsCorrectingEdges] = useState(false);
  const [geometryDetectionStatus, setGeometryDetectionStatus] = useState<GeometryDetectionStatus>(null);
  const geometryHasOpeningIssue = geometryDetectionStatus === 'opening-invalid' || geometryDetectionStatus === 'opening-shell-invalid';
  const geometryHasShellIssue = geometryDetectionStatus === 'shell-invalid' || geometryDetectionStatus === 'opening-shell-invalid';
  const geometryDetectionBlocked = geometryHasOpeningIssue || geometryHasShellIssue;
  const [showSurfaceGuides, setShowSurfaceGuides] = useState(true);
  const [manualRoomWidth, setManualRoomWidth] = useState<number | null>(null);
  const [roomWidthDraft, setRoomWidthDraft] = useState('');
  const [furnitureWidthDraft, setFurnitureWidthDraft] = useState('');
  const [isEditingRoomMeasure, setIsEditingRoomMeasure] = useState(false);
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
  const materialSampleRef = useRef<Blob | null>(null);
  const materialIdRef = useRef(0);
  const furnitureBlobUrlsRef = useRef<string[]>([]);
  const furnitureFilesRef = useRef<Map<string, File>>(new Map());
  const furnitureIdRef = useRef(0);
  const geometryDetectionIdRef = useRef(0);
  const processedBlobRef = useRef<string | null>(null);
  const dragStartRef = useRef<Surface[] | null>(null);
  const geometryDragRef = useRef<GeometryDrag | null>(null);
  const geometryCaptureTargetRef = useRef<Element | null>(null);
  const roomImageRef = useRef<HTMLImageElement>(null);
  const autoFitPreviewRef = useRef<string | null>(null);
  const originalSurfacesRef = useRef<Surface[]>([]);
  const processedSurfacesRef = useRef<Surface[] | null>(null);
  const cleanupHistoryRef = useRef<CleanupRegion[]>([]);
  const projectIdRef = useRef('draft');
  const skipAutosaveRef = useRef(false);
  const manualOpeningParentRef = useRef<string | null>(null);

  useEffect(() => {
    shellRef.current?.setAttribute('data-hydrated', 'true');
    const localTestTimer = window.setTimeout(() => {
      setLocalCleaningTestAvailable(isLocalPreview() && new URLSearchParams(window.location.search).has('roomTest'));
    }, 0);
    return () => {
      window.clearTimeout(localTestTimer);
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
        const result = await response.json() as {
          aiReady?: boolean;
          providerLabel?: string | null;
          cleanerReady?: boolean;
          cleanerLabel?: string | null;
          auditorReady?: boolean;
          auditorLabel?: string | null;
        };
        setAiProviderLabel(result.providerLabel ?? null);
        setAiServiceLabels([
          result.aiReady ? result.providerLabel : null,
          result.auditorReady ? result.auditorLabel : null,
          result.cleanerReady ? result.cleanerLabel : null,
        ].filter((label): label is string => Boolean(label)));
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setCanvasCssSize({ width: rect.width, height: rect.height });
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update);
      observer.observe(canvas);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [room, activeStep]);

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

  const selected = surfaces.find((surface) => surface.id === selectedId) ?? null;
  const roomMeasurement = useMemo(() => inferRoomMeasurement(surfaces, roomRatio, manualRoomWidth), [surfaces, roomRatio, manualRoomWidth]);
  const materialNeedsSample = requiresVerifiedSurfaceSample(material);
  const productTargetSurfaces = surfaces.filter((surface) => surface.kind !== 'door' && surface.kind !== 'window');
  const materialTarget = material ? recommendedSurface(material) : selected;
  const selectedFurniture = placedFurniture.find((item) => item.id === selectedFurnitureId) ?? null;
  const projectName = room?.projectName ?? 'Progetto senza titolo';
  const importedCaption = useMemo(() => room ? `Immagine · ${room.displaySize}` : null, [room]);
  const filteredMaterials = useMemo(() => {
    const query = [materialQuery, searchBrand, searchModel, searchColor].filter(Boolean).join(' ');
    return catalogSuggestions(query, searchCategory);
  }, [materialQuery, searchBrand, searchModel, searchColor, searchCategory]);
  const filteredFurniture = useMemo(() => {
    if (searchCategory && searchCategory !== 'Arredi') return [];
    const query = [materialQuery, searchBrand, searchModel, searchColor].filter(Boolean).join(' ').trim().toLocaleLowerCase('it');
    if (!query) return [];
    return furnitureCatalog.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase('it').includes(query));
  }, [materialQuery, searchBrand, searchModel, searchColor, searchCategory]);
  const materialMap = useMemo(() => new Map(catalogMaterials.concat(onlineMaterials, material ? [material] : []).map((item) => [item.id, item])), [material, onlineMaterials]);

  useEffect(() => {
    const floor = surfaces.find((surface) => surface.kind === 'floor');
    if (!floor) return;
    const frame = window.requestAnimationFrame(() => {
      setPlacedFurniture((current) => {
        let changed = false;
        const next = current.map((item) => {
          if (!item.autoScale) return item;
          const floorContact = floorContactYAtX(floor, item.x);
          const scale = perspectiveFurnitureScale(item.name, item.description, item.y, floorContact, floor, roomMeasurement);
          if (Math.abs(scale - item.scale) < .05) return item;
          changed = true;
          return { ...item, scale };
        });
        return changed ? next : current;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [roomMeasurement, surfaces]);

  const syncGeometrySnapshots = useCallback((next: Surface[]) => {
    if (!room || room.sourceType !== 'photo') return;
    const snapshots = geometrySnapshotsAfterEdit(
      next,
      Boolean(processedPreview || processedSurfacesRef.current),
    );
    originalSurfacesRef.current = snapshots.original;
    if (snapshots.processed) processedSurfacesRef.current = snapshots.processed;
  }, [processedPreview, room]);

  const moveGeometryAt = useCallback((clientX: number, clientY: number) => {
    const activeDrag = geometryDragRef.current;
    const overlay = surfaceOverlayRef.current;
    if (!activeDrag || !overlay) return;
    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
    setSurfaces((current) => {
      let edgeDelta: Point | null = null;
      if (activeDrag.kind === 'edge') {
        const allOrigins = activeDrag.endpoints.flatMap((endpoint) => endpoint.linked.map(() => endpoint.origin));
        const wantedX = point.x - activeDrag.start.x;
        const wantedY = point.y - activeDrag.start.y;
        const minX = Math.max(...allOrigins.map((origin) => -origin.x));
        const maxX = Math.min(...allOrigins.map((origin) => 1 - origin.x));
        const minY = Math.max(...allOrigins.map((origin) => -origin.y));
        const maxY = Math.min(...allOrigins.map((origin) => 1 - origin.y));
        edgeDelta = {
          x: Math.min(maxX, Math.max(minX, wantedX)),
          y: Math.min(maxY, Math.max(minY, wantedY)),
        };
      }
      const next = current.map((surface) => {
        if (surface.frozen) return surface;
        const linkedPoints = surface.points.map((candidate, index) => {
          if (activeDrag.kind === 'vertex') {
            const isLinked = activeDrag.linked.some((linked) => linked.surfaceId === surface.id && linked.vertexIndex === index);
            return isLinked ? point : candidate;
          }
          if (edgeDelta) {
            const endpoint = activeDrag.endpoints.find((item) => item.linked.some((linked) => linked.surfaceId === surface.id && linked.vertexIndex === index));
            return endpoint ? { x: endpoint.origin.x + edgeDelta.x, y: endpoint.origin.y + edgeDelta.y } : candidate;
          }
          return candidate;
        });
        return { ...surface, points: linkedPoints };
      });
      if (!next.every((surface) => isValidPolygon(surface.points))) return current;
      syncGeometrySnapshots(next);
      return next;
    });
  }, [syncGeometrySnapshots]);

  const finishGeometryDrag = useCallback((pointerId: number) => {
    const activeDrag = geometryDragRef.current;
    if (!activeDrag || pointerId !== activeDrag.pointerId) return;
    const captureTarget = geometryCaptureTargetRef.current;
    geometryDragRef.current = null;
    geometryCaptureTargetRef.current = null;
    try {
      if (captureTarget?.hasPointerCapture?.(pointerId)) captureTarget.releasePointerCapture(pointerId);
    } catch { /* Safari may already have released the Pencil pointer. */ }
    const dragStart = dragStartRef.current;
    if (dragStart) {
      setPastSurfaces((history) => [...history, dragStart].slice(-40));
      setFutureSurfaces([]);
    }
    dragStartRef.current = null;
    setDragVertex(null);
    setDragEdge(null);
    setGeometryDetectionStatus((current) => current === 'shell-invalid'
      ? 'ai'
      : current === 'opening-shell-invalid' ? 'opening-invalid' : current);
    shellRef.current?.classList.remove('is-moving-vertex');
  }, []);

  useEffect(() => {
    const activeDrag = dragVertex ?? dragEdge;
    if (!activeDrag) return;
    const preventTouchScroll = (event: TouchEvent) => event.preventDefault();
    const move = (event: PointerEvent) => {
      if (event.pointerId !== geometryDragRef.current?.pointerId) return;
      event.preventDefault();
      moveGeometryAt(event.clientX, event.clientY);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId === geometryDragRef.current?.pointerId) finishGeometryDrag(event.pointerId);
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
  }, [dragEdge, dragVertex, finishGeometryDrag, moveGeometryAt]);

  function handleGeometryPointerMove(event: ReactPointerEvent<Element>) {
    if (event.pointerId !== geometryDragRef.current?.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    moveGeometryAt(event.clientX, event.clientY);
  }

  function handleGeometryPointerEnd(event: ReactPointerEvent<Element>) {
    if (event.pointerId !== geometryDragRef.current?.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    finishGeometryDrag(event.pointerId);
  }

  function commitSurfaces(next: Surface[]) {
    setPastSurfaces((history) => [...history, surfaces].slice(-40));
    setFutureSurfaces([]);
    syncGeometrySnapshots(next);
    setSurfaces(next);
  }

  function undo() {
    const previous = pastSurfaces.at(-1);
    if (!previous) return;
    setPastSurfaces((history) => history.slice(0, -1));
    setFutureSurfaces((future) => [surfaces, ...future].slice(0, 40));
    syncGeometrySnapshots(previous);
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
    syncGeometrySnapshots(next);
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
      setPlacedFurniture([]); setPastFurniture([]); setPendingFurniture(null); setSelectedFurnitureId(null); furnitureFilesRef.current.clear();
      setCleanupRegion(null); setIsPickingCleanup(false);
      setShowSurfaceGuides(true);
      setGeometryDetectionStatus(null);
      setManualRoomWidth(null); setRoomWidthDraft(''); setIsEditingRoomMeasure(false);
      autoFitPreviewRef.current = null;
      originalSurfacesRef.current = initialSurfaces;
      processedSurfacesRef.current = null;
      cleanupHistoryRef.current = [];
      setSurfaces(initialSurfaces); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(initialSurfaces[0]?.id ?? null); setRenameDraft(initialSurfaces[0]?.name ?? ''); setDraft([]); setDrawKind(null); setQuickDraw(false); setManualOpeningMode(null); setLineWallDraw(false); setError(null);
      setIsCorrectingEdges(false);
      setNotice(sourceType === 'floorplan'
        ? 'Planimetria caricata. Creo automaticamente la stanza vuota; potrai correggere il perimetro solo se serve.'
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
    materialSampleRef.current = null;
    originalSurfacesRef.current = [];
    processedSurfacesRef.current = null;
    cleanupHistoryRef.current = [];
    furnitureBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    furnitureBlobUrlsRef.current = [];
    furnitureFilesRef.current.clear();
    setRoom(null); setSurfaces([]); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(null); setDraft([]); setDrawKind(null); setQuickDraw(false); setManualOpeningMode(null); setLineWallDraw(false); setProcessedPreview(null); setShowProcessedPreview(false); setProcessedLabel('Stanza vuota'); setOnlineMaterials([]); setPlacedFurniture([]); setPastFurniture([]); setPendingFurniture(null); setSelectedFurnitureId(null); setCleanupRegion(null); setIsPickingCleanup(false); setNotice(null); setIsCorrectingEdges(false); setGeometryDetectionStatus(null); setShowSurfaceGuides(true); setManualRoomWidth(null); setRoomWidthDraft(''); setIsEditingRoomMeasure(false);
  }

  function startDrawing(kind: SurfaceKind = 'wall', quick = false, openingMode: ManualOpeningMode = null) {
    if (!room) return;
    setShowSurfaceGuides(true);
    const selectedSurface = surfaces.find((surface) => surface.id === selectedId);
    manualOpeningParentRef.current = (kind === 'door' || kind === 'window') && selectedSurface?.kind === 'wall'
      ? selectedSurface.id
      : null;
    const resolvedOpeningMode = kind === 'door' || kind === 'window'
      ? openingMode ?? (quick ? 'rectangle' : null)
      : null;
    setDrawKind(kind); setQuickDraw(quick); setManualOpeningMode(resolvedOpeningMode); setLineWallDraw(false); setDraft([]); setSelectedId(null); setRenameDraft('');
    const subject = kind === 'door' && resolvedOpeningMode === 'arch' ? 'Arco' : kind === 'door' ? 'Porta' : kind === 'window' ? 'Finestra' : 'Muro';
    setNotice(quick
      ? `${subject}: tocca i quattro angoli ESTERNI in qualsiasi ordine. Si chiuderà automaticamente e resterà selezionata.`
      : `${subject}: segui il bordo esterno in ordine con almeno cinque punti, includendo arco, stipiti e soglia; poi premi “Conferma ${subject.toLowerCase()}”.`);
  }

  function startFloorplanWall() {
    if (!room) return;
    setShowSurfaceGuides(true);
    setDrawKind('wall'); setQuickDraw(false); setManualOpeningMode(null); setLineWallDraw(true); setDraft([]); setSelectedId(null); setRenameDraft('');
    setNotice('Parete interna: tocca l’inizio e la fine della linea. Lo spessore viene creato automaticamente.');
  }

  function addDraftPoint(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drawKind || dragVertex || dragEdge) return;
    const point = eventPoint(event);
    const next = [...draft, point];
    if (lineWallDraw && next.length === 2) completeSurface(wallFromLine(next[0], next[1]), 'wall');
    else if (quickDraw && next.length === 4) completeSurface(next, drawKind);
    else setDraft(next);
  }

  function completeSurface(points: Point[], kind: SurfaceKind) {
    const isOpening = kind === 'door' || kind === 'window';
    const orderedPoints = isOpening && points.length === 4 ? orderManualOpeningQuad(points) : points;
    const finalPoints = isOpening ? snapOpeningExtrema(orderedPoints) : orderedPoints;
    if (!isValidPolygon(finalPoints)) {
      setError('Servono almeno tre punti non allineati per chiudere la superficie.'); return;
    }
    const id = `surface-${Date.now()}-${surfaces.length}`;
    const openingCenter = finalPoints.reduce((sum, point) => ({ x: sum.x + point.x / finalPoints.length, y: sum.y + point.y / finalPoints.length }), { x: 0, y: 0 });
    const touchesImageEdge = isOpening && finalPoints.some((point) => point.x === 0 || point.x === 1 || point.y === 0 || point.y === 1);
    const parentThreshold = touchesImageEdge ? .7 : .9;
    const wallsByFit = surfaces.filter((surface) => surface.kind === 'wall').map((wall) => ({
      wall,
      coverage: isOpening ? openingCoverageInWall(finalPoints, wall.points) : 0,
      distance: Math.hypot(openingCenter.x - surfaceCenter(wall).x, openingCenter.y - surfaceCenter(wall).y),
    })).sort((left, right) => right.coverage - left.coverage || left.distance - right.distance);
    const selectedParent = surfaces.find((surface) => surface.id === manualOpeningParentRef.current && surface.kind === 'wall');
    const selectedCoverage = selectedParent && isOpening ? openingCoverageInWall(finalPoints, selectedParent.points) : 0;
    const closestWall = surfaces.filter((surface) => surface.kind === 'wall').sort((left, right) => {
      const leftCenter = surfaceCenter(left); const rightCenter = surfaceCenter(right);
      return Math.hypot(openingCenter.x - leftCenter.x, openingCenter.y - leftCenter.y)
        - Math.hypot(openingCenter.x - rightCenter.x, openingCenter.y - rightCenter.y);
    })[0];
    const parentId = isOpening
      ? selectedParent && selectedCoverage >= parentThreshold
        ? selectedParent.id
        : (wallsByFit.find((candidate) => candidate.coverage >= parentThreshold)?.wall ?? closestWall)?.id
      : undefined;
    const isManualArch = kind === 'door' && manualOpeningMode === 'arch';
    const surface: Surface = {
      id,
      name: isManualArch
        ? `Arco ${surfaces.filter((candidate) => candidate.kind === 'door' && candidate.name.startsWith('Arco')).length + 1}`
        : nextSurfaceName(kind, surfaces),
      kind,
      points: finalPoints,
      frozen: false,
      confidence: isOpening ? 1 : undefined,
      slot: isOpening ? openingSlot(finalPoints) : undefined,
      parentId,
      source: isOpening ? 'manual' : undefined,
    };
    commitSurfaces([...surfaces, surface]); setSelectedId(id); setRenameDraft(surface.name); setDraft([]); setDrawKind(null); setQuickDraw(false); setManualOpeningMode(null); setLineWallDraw(false); setError(null); setIsCorrectingEdges(isOpening);
    if (isOpening && geometryDetectionStatus === 'opening-invalid') setGeometryDetectionStatus('ai');
    if (isOpening && geometryDetectionStatus === 'opening-shell-invalid') setGeometryDetectionStatus('shell-invalid');
    manualOpeningParentRef.current = null;
    setNotice(`${surface.name} creata${parentId ? ` e collegata a ${surfaces.find((item) => item.id === parentId)?.name ?? 'un muro'}` : ''}. Trascina i punti per correggerla.`);
  }

  function undoDraftPoint() {
    if (!drawKind || draft.length === 0) return;
    const subject = drawKind === 'door' ? 'Porta' : drawKind === 'window' ? 'Finestra' : 'Muro';
    setDraft((current) => current.slice(0, -1));
    setError(null);
    setNotice(`${subject}: ultimo punto cancellato. Tocca di nuovo la foto per continuare.`);
  }

  function confirmInferredOpeningThreshold() {
    if (!selected || selected.kind !== 'door' || !selected.thresholdInferred) return;
    commitSurfaces(surfaces.map((surface) => surface.id === selected.id
      ? { ...surface, thresholdInferred: false, source: 'manual' as const }
      : surface));
    setGeometryDetectionStatus((current) => current === 'opening-shell-invalid'
      ? 'shell-invalid'
      : current === 'opening-invalid' ? 'ai' : current);
    setNotice(`${selected.name}: soglia stimata confermata. ${geometryHasShellIssue ? 'Restano da correggere i confini della stanza.' : 'Ora puoi continuare.'}`);
  }

  function cancelDrawing() { manualOpeningParentRef.current = null; setDraft([]); setDrawKind(null); setQuickDraw(false); setManualOpeningMode(null); setLineWallDraw(false); setNotice(null); }

  function linkedVerticesAt(origin: Point) {
    const overlay = surfaceOverlayRef.current?.getBoundingClientRect();
    const width = overlay?.width || 1000;
    const height = overlay?.height || 625;
    return surfaces.flatMap((candidate) => candidate.points.flatMap((point, index) => (
      Math.hypot((point.x - origin.x) * width, (point.y - origin.y) * height) <= 8
        ? [{ surfaceId: candidate.id, vertexIndex: index }]
        : []
    )));
  }

  function linkedGroupTouchesFrozen(linked: LinkedVertex[]) {
    return linked.some((item) => surfaces.find((candidate) => candidate.id === item.surfaceId)?.frozen);
  }

  function beginVertexDrag(event: ReactPointerEvent<Element>, surfaceId: string, vertexIndex: number) {
    if (geometryDragRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const surface = surfaces.find((item) => item.id === surfaceId);
    if (!surface || surface.frozen || !isCorrectingEdges) return;
    const origin = surface.points[vertexIndex];
    const linked = linkedVerticesAt(origin);
    if (linkedGroupTouchesFrozen(linked)) {
      setNotice('Questo nodo tocca una superficie Freeze. Sbloccala prima di spostare il bordo condiviso.');
      return;
    }
    event.preventDefault(); event.stopPropagation();
    const activeDrag: DragVertex = { kind: 'vertex', surfaceId, vertexIndex, pointerId: event.pointerId, origin, linked };
    geometryDragRef.current = activeDrag;
    geometryCaptureTargetRef.current = event.currentTarget;
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Global listeners keep the drag active. */ }
    shellRef.current?.classList.add('is-moving-vertex');
    dragStartRef.current = surfaces;
    setDragEdge(null);
    setDragVertex(activeDrag);
  }

  function beginEdgeDrag(event: ReactPointerEvent<Element>, surfaceId: string, edgeIndex: number) {
    if (geometryDragRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const surface = surfaces.find((item) => item.id === surfaceId);
    if (!surface || surface.frozen || !isCorrectingEdges || !surfaceOverlayRef.current) return;
    const first = surface.points[edgeIndex];
    const second = surface.points[(edgeIndex + 1) % surface.points.length];
    const firstLinked = linkedVerticesAt(first);
    const secondLinked = linkedVerticesAt(second);
    if (linkedGroupTouchesFrozen([...firstLinked, ...secondLinked])) {
      setNotice('Questa linea tocca una superficie Freeze. Sbloccala prima di spostare il bordo condiviso.');
      return;
    }
    const rect = surfaceOverlayRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    event.preventDefault(); event.stopPropagation();
    const activeDrag: DragEdge = {
      kind: 'edge',
      surfaceId,
      edgeIndex,
      pointerId: event.pointerId,
      start: { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height },
      endpoints: [
        { origin: first, linked: firstLinked },
        { origin: second, linked: secondLinked },
      ],
    };
    geometryDragRef.current = activeDrag;
    geometryCaptureTargetRef.current = event.currentTarget;
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Global listeners keep the drag active. */ }
    shellRef.current?.classList.add('is-moving-vertex');
    dragStartRef.current = surfaces;
    setDragVertex(null);
    setDragEdge(activeDrag);
  }

  function beginMidpointDrag(event: ReactPointerEvent<Element>, surfaceId: string, edgeIndex: number) {
    if (geometryDragRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const surface = surfaces.find((item) => item.id === surfaceId);
    if (!surface || surface.frozen || !isCorrectingEdges || surface.points.length >= 24) return;
    const first = surface.points[edgeIndex];
    const second = surface.points[(edgeIndex + 1) % surface.points.length];
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const overlay = surfaceOverlayRef.current?.getBoundingClientRect();
    const width = overlay?.width || 1000;
    const height = overlay?.height || 625;
    const samePoint = (left: Point, right: Point) => (
      Math.hypot((left.x - right.x) * width, (left.y - right.y) * height) <= 8
    );
    const insertions = surfaces.flatMap((candidate) => {
      if (candidate.frozen || candidate.points.length >= 24) return [];
      return candidate.points.flatMap((point, index) => {
        const next = candidate.points[(index + 1) % candidate.points.length];
        return (samePoint(point, first) && samePoint(next, second))
          || (samePoint(point, second) && samePoint(next, first))
          ? [{ surfaceId: candidate.id, afterIndex: index }]
          : [];
      });
    });
    const selectedInsertion = insertions.find((item) => item.surfaceId === surfaceId && item.afterIndex === edgeIndex);
    if (!selectedInsertion) return;
    const sharedFrozen = surfaces.some((candidate) => candidate.frozen && candidate.points.some((point, index) => {
      const next = candidate.points[(index + 1) % candidate.points.length];
      return (samePoint(point, first) && samePoint(next, second))
        || (samePoint(point, second) && samePoint(next, first));
    }));
    if (sharedFrozen) {
      setNotice('Questa linea tocca una superficie Freeze. Sbloccala prima di aggiungere un punto condiviso.');
      return;
    }

    const next = surfaces.map((candidate) => {
      const insertion = insertions.find((item) => item.surfaceId === candidate.id);
      if (!insertion) return candidate;
      const points = [...candidate.points];
      points.splice(insertion.afterIndex + 1, 0, midpoint);
      return { ...candidate, points };
    });
    if (!next.every((candidate) => isValidPolygon(candidate.points))) return;
    const linked = insertions.map((item) => ({ surfaceId: item.surfaceId, vertexIndex: item.afterIndex + 1 }));
    event.preventDefault(); event.stopPropagation();
    const activeDrag: DragVertex = {
      kind: 'vertex', surfaceId, vertexIndex: edgeIndex + 1,
      pointerId: event.pointerId, origin: midpoint, linked,
    };
    geometryDragRef.current = activeDrag;
    geometryCaptureTargetRef.current = event.currentTarget;
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Global listeners keep the drag active. */ }
    shellRef.current?.classList.add('is-moving-vertex');
    dragStartRef.current = surfaces;
    syncGeometrySnapshots(next);
    setSurfaces(next);
    setDragEdge(null);
    setDragVertex(activeDrag);
    setNotice('Nuovo punto creato: trascinalo per formare una punta.');
  }

  function toggleEdgeCorrection() {
    if (isCorrectingEdges) {
      if (geometryDragRef.current) finishGeometryDrag(geometryDragRef.current.pointerId);
      setIsCorrectingEdges(false);
      setDragVertex(null);
      setDragEdge(null);
      shellRef.current?.classList.remove('is-moving-vertex');
      setNotice('Contorno salvato. Puoi scegliere il prodotto o un’altra superficie.');
      return;
    }
    if (!selected || selected.frozen) {
      setNotice(selected?.frozen ? 'Questa superficie è bloccata. Sbloccala prima di correggere il contorno.' : 'Scegli prima una superficie da correggere.');
      return;
    }
    setPendingFurniture(null);
    setShowSurfaceGuides(true);
    setIsCorrectingEdges(true);
    setNotice('Correzione attiva: trascina una linea per spostarla intera, oppure un pallino per correggere un angolo. Funziona con dito e Apple Pencil.');
    window.requestAnimationFrame(() => canvasRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
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
    if (file.size > 12 * 1024 * 1024) { setError('Il campione materiale supera il limite di 12 MB.'); return; }
    if (materialBlobRef.current) URL.revokeObjectURL(materialBlobRef.current);
    const previewUrl = URL.createObjectURL(file);
    materialBlobRef.current = previewUrl;
    materialSampleRef.current = file;
    materialIdRef.current += 1;
    const next: StudioMaterial = { id: `material-${materialIdRef.current}`, name: file.name.replace(/\.[^.]+$/, ''), category: 'Rivestimenti', description: 'Campione fotografico personale', previewUrl, textureUrl: previewUrl, referenceKind: 'uploaded-sample' };
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
    const rawQuery = materialQuery.trim();
    const combinedQuery = [rawQuery, searchBrand, searchModel, searchColor].filter(Boolean).join(' ');
    const normalizedQuery = normalizeProductSearch(rawQuery);
    const normalizedCombinedQuery = normalizeProductSearch(combinedQuery);
    const inferredFlooringCategory = /\b(?:pavimento|parquet|legno|rovere|doghe)\b/.test(normalizedCombinedQuery);
    const inferredWallCoveringCategory = /\b(?:carta da parati|wallpaper|wallcovering|tappezzeria|rivestimento murale)\b/.test(normalizedCombinedQuery);
    const criteria = {
      brand: searchBrand.trim(),
      model: searchModel.trim(),
      color: searchColor.trim(),
      category: searchCategory || (inferredWallCoveringCategory ? 'Rivestimenti' : inferredFlooringCategory ? 'Pavimenti' : ''),
      sourceUrl: searchSourceUrl.trim(),
    };
    const query = normalizedQuery || rawQuery;
    const readableSearch = [criteria.brand, criteria.model, criteria.color, criteria.category, rawQuery, criteria.sourceUrl].filter(Boolean).join(' · ');
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
        const correctedCategory = correctedOnlineCategory(item);
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
          : correctedCategory === 'Arredi' && productImageUrl
            ? 'official-product-image'
            : 'metadata-only';
        return {
          id: `online-${Date.now()}-${index}`,
          name: item.name,
          brand: item.brand,
          category: correctedCategory,
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
      const includedSuggestions = catalogSuggestions(combinedQuery, criteria.category as ProductSearchCategory);
      setNotice(found.length
        ? `${found.length} prodotti verificati. L’app indica chiaramente se ha trovato anche una texture ufficiale oppure soltanto i dati del catalogo.`
        : includedSuggestions.length
          ? `Non ho trovato un prodotto online verificato, ma qui sotto trovi ${includedSuggestions.length} esempi compatibili da provare subito.`
          : 'Nessun prodotto affidabile trovato. Prova con marca e collezione più precise.');
    } catch (caught) {
      const includedSuggestions = catalogSuggestions(combinedQuery, criteria.category as ProductSearchCategory);
      if (includedSuggestions.length) {
        setError(null);
        setNotice(`La ricerca online non ha risposto. Puoi comunque provare subito i ${includedSuggestions.length} esempi compatibili qui sotto.`);
      } else {
        setError(caught instanceof Error ? caught.message : 'Ricerca non disponibile.'); setNotice(null);
      }
    } finally { setIsSearchingProducts(false); }
  }

  function resetProductSearch() {
    setMaterialQuery(''); setSearchBrand(''); setSearchModel(''); setSearchColor(''); setSearchCategory(''); setSearchSourceUrl(''); setOnlineMaterials([]); setError(null);
    setNotice('Criteri di ricerca azzerati.');
  }

  function recommendedSurface(item: StudioMaterial) {
    const description = `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase('it');
    const preferredKind: SurfaceKind = item.category === 'Pavimenti' || /pavimento|parquet|rovere|piastrella|mattonell/.test(description) ? 'floor' : 'wall';
    const exactTarget = surfaces.find((surface) => !surface.frozen && surface.kind === preferredKind) ?? null;
    if (item.category === 'Pavimenti' || item.category === 'Rivestimenti' || item.category === 'Colori') return exactTarget;
    return exactTarget
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
    const maskReferenceCanvas = document.createElement('canvas');
    imageCanvas.width = maskCanvas.width = maskReferenceCanvas.width = width;
    imageCanvas.height = maskCanvas.height = maskReferenceCanvas.height = height;
    const imageContext = imageCanvas.getContext('2d');
    const maskContext = maskCanvas.getContext('2d');
    const maskReferenceContext = maskReferenceCanvas.getContext('2d');
    if (!imageContext || !maskContext || !maskReferenceContext) throw new Error('Non posso preparare la superficie.');
    imageContext.drawImage(image, 0, 0, width, height);

    const drawPoints = (context: CanvasRenderingContext2D, points: Point[]) => {
      context.beginPath();
      points.forEach((point, index) => {
        const x = point.x * width; const y = point.y * height;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.closePath(); context.fill();
    };
    const drawPolygon = (context: CanvasRenderingContext2D, surface: Surface) => drawPoints(context, surface.points);

    const editableSurfaces = options.editableSurfaces ?? (options.editableSurface ? [options.editableSurface] : []);
    const editableFurniture = options.editableFurniture ?? [];
    if (editableSurfaces.length || editableFurniture.length) {
      maskContext.fillStyle = '#ffffff'; maskContext.fillRect(0, 0, width, height);
      maskContext.globalCompositeOperation = 'destination-out';
      for (const surface of editableSurfaces) drawPolygon(maskContext, surface);
      maskContext.globalCompositeOperation = 'source-over';
      maskContext.fillStyle = '#ffffff';
      for (const surface of options.protectedSurfaces ?? []) drawPolygon(maskContext, surface);
      // A requested item is allowed to naturally occlude a protected wall.
      // Open its placement window after restoring the architectural mask.
      maskContext.globalCompositeOperation = 'destination-out';
      for (const item of editableFurniture) drawPoints(maskContext, rectPoints(furnitureEditRect(item)));
      maskContext.globalCompositeOperation = 'source-over';

      maskReferenceContext.fillStyle = '#000000'; maskReferenceContext.fillRect(0, 0, width, height);
      maskReferenceContext.fillStyle = '#ff00ff';
      for (const surface of editableSurfaces) drawPolygon(maskReferenceContext, surface);
      for (const item of editableFurniture) drawPoints(maskReferenceContext, rectPoints(furnitureEditRect(item)));
      maskReferenceContext.fillStyle = '#000000';
      for (const surface of options.protectedSurfaces ?? []) drawPolygon(maskReferenceContext, surface);
      maskReferenceContext.fillStyle = '#ff00ff';
      for (const item of editableFurniture) drawPoints(maskReferenceContext, rectPoints(furnitureEditRect(item)));
    } else {
      maskContext.clearRect(0, 0, width, height);
      maskContext.fillStyle = '#ffffff';
      for (const surface of options.frozenSurfaces ?? []) drawPolygon(maskContext, surface);
      maskReferenceContext.fillStyle = '#ff00ff'; maskReferenceContext.fillRect(0, 0, width, height);
      maskReferenceContext.fillStyle = '#000000';
      for (const surface of options.frozenSurfaces ?? []) drawPolygon(maskReferenceContext, surface);
    }

    const [inputImage, mask, maskReference] = await Promise.all([
      // JPEG keeps the multipart request comfortably below mobile/edge body
      // limits; the lossless PNG is reserved for the technical mask.
      new Promise<Blob | null>((resolve) => imageCanvas.toBlob(resolve, 'image/jpeg', .92)),
      new Promise<Blob | null>((resolve) => maskCanvas.toBlob(resolve, 'image/png')),
      new Promise<Blob | null>((resolve) => maskReferenceCanvas.toBlob(resolve, 'image/png')),
    ]);
    if (!inputImage || !mask || !maskReference) throw new Error('Non posso preparare foto e maschera della superficie.');
    return { inputImage, mask, maskReference };
  }

  async function createCleanupTileInput(source: HTMLImageElement, plan: CleanupTilePlan, protectedSurfaces: Surface[]) {
    const sourceSize = { width: source.naturalWidth, height: source.naturalHeight };
    const pixelRect = snapCleanupTileRect(plan.bounds, sourceSize);
    const bounds = cleanupTileBoundsFromRect(pixelRect, sourceSize);
    const envelope = cleanupTileMaskEnvelope(plan.regions, sourceSize);
    const normalizedRegions = plan.regions.map((region) => ({
      ...region, points: region.points.map((point) => pointInCleanupTile(point, bounds)),
      internalEdges: region.internalEdges?.map((edge) => ({
        axis: edge.axis,
        value: edge.axis === 'x'
          ? (edge.value - bounds.left) / Math.max(.0001, bounds.right - bounds.left)
          : (edge.value - bounds.top) / Math.max(.0001, bounds.bottom - bounds.top),
      })),
    }));
    const { left: sourceLeft, top: sourceTop, width: sourceWidth, height: sourceHeight } = pixelRect;
    const maximumSide = isAppleTouchDevice() ? 1024 : 1280;
    const scale = Math.min(1, maximumSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const imageCanvas = document.createElement('canvas');
    const maskCanvas = document.createElement('canvas');
    const maskReferenceCanvas = document.createElement('canvas');
    imageCanvas.width = maskCanvas.width = maskReferenceCanvas.width = width;
    imageCanvas.height = maskCanvas.height = maskReferenceCanvas.height = height;
    const imageContext = imageCanvas.getContext('2d');
    const maskContext = maskCanvas.getContext('2d');
    const maskReferenceContext = maskReferenceCanvas.getContext('2d');
    if (!imageContext || !maskContext || !maskReferenceContext) throw new Error('Non posso preparare il ritaglio locale.');
    imageContext.drawImage(source, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, width, height);

    const traceRegion = (context: CanvasRenderingContext2D, region: CleanupRegion) => {
      context.beginPath();
      region.points.forEach((point, index) => {
        const x = point.x * width; const y = point.y * height;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.closePath();
    };
    const strokeRegionBoundary = (context: CanvasRenderingContext2D, region: CleanupRegion) => {
      if (!region.internalEdges?.length) {
        traceRegion(context, region);
        context.stroke();
        return;
      }
      for (let index = 0; index < region.points.length; index += 1) {
        const first = region.points[index];
        const second = region.points[(index + 1) % region.points.length];
        if (cleanupTileEdgeIsInternal(region, first, second)) continue;
        context.beginPath();
        context.moveTo(first.x * width, first.y * height);
        context.lineTo(second.x * width, second.y * height);
        context.stroke();
      }
    };
    // Object detectors usually stop at the visible body.  Include contact
    // shadows and tiny attachment fringes as well, otherwise the room can be
    // left with a table-shaped shadow after the table itself is removed.
    const tileScale = Math.min(width / sourceWidth, height / sourceHeight);
    const expansion = envelope.outsetSourcePx * tileScale;
    const shadowOffset = envelope.shadowOffsetSourcePx * tileScale;
    maskContext.fillStyle = '#ffffff'; maskContext.fillRect(0, 0, width, height);
    maskContext.globalCompositeOperation = 'destination-out';
    maskContext.fillStyle = '#000000'; maskContext.strokeStyle = '#000000';
    maskContext.lineWidth = expansion * 2; maskContext.lineJoin = 'round'; maskContext.lineCap = 'butt';
    maskReferenceContext.fillStyle = '#000000'; maskReferenceContext.fillRect(0, 0, width, height);
    maskReferenceContext.fillStyle = '#ff00ff'; maskReferenceContext.strokeStyle = '#ff00ff';
    maskReferenceContext.lineWidth = expansion * 2; maskReferenceContext.lineJoin = 'round'; maskReferenceContext.lineCap = 'butt';
    for (const region of normalizedRegions) {
      traceRegion(maskContext, region); maskContext.fill(); strokeRegionBoundary(maskContext, region);
      maskContext.save(); maskContext.translate(0, shadowOffset); strokeRegionBoundary(maskContext, region); maskContext.restore();
      traceRegion(maskReferenceContext, region); maskReferenceContext.fill(); strokeRegionBoundary(maskReferenceContext, region);
      maskReferenceContext.save(); maskReferenceContext.translate(0, shadowOffset); strokeRegionBoundary(maskReferenceContext, region); maskReferenceContext.restore();
    }
    maskContext.globalCompositeOperation = 'source-over';
    // Apertures and explicit Freeze regions are protected twice: they are
    // excluded from the model's editable mask here and copied back from the
    // original again after compositing.
    const protectedRegions = protectedSurfaces.map((surface) => ({
      surface,
      region: {
        label: surface.name,
        confidence: 1,
        points: surface.points.map((point) => pointInCleanupTile(point, bounds)),
      } satisfies CleanupRegion,
    }));
    maskContext.fillStyle = '#ffffff';
    maskContext.strokeStyle = '#ffffff';
    maskReferenceContext.fillStyle = '#000000';
    maskReferenceContext.strokeStyle = '#000000';
    const openingOutline = Math.max(4, Math.min(width, height) * .012);
    maskContext.lineWidth = openingOutline;
    maskReferenceContext.lineWidth = openingOutline;
    maskContext.lineJoin = maskReferenceContext.lineJoin = 'round';
    for (const { surface, region } of protectedRegions) {
      const protection = cleanupProtectionMode(surface);
      traceRegion(maskContext, region);
      traceRegion(maskReferenceContext, region);
      if (protection === 'fill') {
        maskContext.fill();
        maskReferenceContext.fill();
      } else {
        maskContext.stroke();
        maskReferenceContext.stroke();
      }
    }
    const [inputImage, mask, maskReference] = await Promise.all([
      new Promise<Blob | null>((resolve) => imageCanvas.toBlob(resolve, 'image/jpeg', .94)),
      new Promise<Blob | null>((resolve) => maskCanvas.toBlob(resolve, 'image/png')),
      new Promise<Blob | null>((resolve) => maskReferenceCanvas.toBlob(resolve, 'image/png')),
    ]);
    if (!inputImage || !mask || !maskReference) throw new Error('Non posso preparare foto e maschera del ritaglio locale.');
    return { ...plan, bounds, pixelRect, sourceSize, envelope, normalizedRegions, inputImage, mask, maskReference };
  }

  async function composeCleanupTiles(
    sourceUrl: string,
    results: CleanupTileResult[],
    protectedSurfaces: Surface[],
  ) {
    const original = await loadImageSource(sourceUrl);
    const generated = await Promise.all(results.map((result) => loadImageSource(result.image)));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.sourceSize.width !== original.naturalWidth
        || result.sourceSize.height !== original.naturalHeight
        || !cleanupTileRatioMatches(
          generated[index].naturalWidth,
          generated[index].naturalHeight,
          result.pixelRect.width,
          result.pixelRect.height,
        )) {
        throw new Error('Il ritaglio IA ha cambiato proporzioni o geometria: è stato scartato e la fotografia è rimasta intatta.');
      }
    }
    const maximumSide = isAppleTouchDevice() ? 1280 : 1536;
    const scale = Math.min(1, maximumSide / Math.max(original.naturalWidth, original.naturalHeight));
    const width = Math.max(1, Math.round(original.naturalWidth * scale));
    const height = Math.max(1, Math.round(original.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    const authorizationCanvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    authorizationCanvas.width = width; authorizationCanvas.height = height;
    const context = canvas.getContext('2d');
    const authorizationContext = authorizationCanvas.getContext('2d');
    if (!context || !authorizationContext) throw new Error('Non posso ricomporre la pulizia locale.');
    context.drawImage(original, 0, 0, width, height);
    authorizationContext.fillStyle = '#000000';
    authorizationContext.fillRect(0, 0, width, height);

    const traceNormalized = (target: CanvasRenderingContext2D, points: Point[]) => {
      target.beginPath();
      points.forEach((point, index) => {
        const x = point.x * width; const y = point.y * height;
        if (index === 0) target.moveTo(x, y); else target.lineTo(x, y);
      });
      target.closePath();
    };
    const strokeNormalizedBoundary = (target: CanvasRenderingContext2D, region: CleanupRegion) => {
      if (!region.internalEdges?.length) {
        traceNormalized(target, region.points);
        target.stroke();
        return;
      }
      for (let index = 0; index < region.points.length; index += 1) {
        const first = region.points[index];
        const second = region.points[(index + 1) % region.points.length];
        if (cleanupTileEdgeIsInternal(region, first, second)) continue;
        target.beginPath();
        target.moveTo(first.x * width, first.y * height);
        target.lineTo(second.x * width, second.y * height);
        target.stroke();
      }
    };
    for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
      const result = results[resultIndex];
      const scaleX = width / result.sourceSize.width;
      const scaleY = height / result.sourceSize.height;
      const tileLeft = Math.round(result.pixelRect.left * scaleX);
      const tileTop = Math.round(result.pixelRect.top * scaleY);
      const tileRight = Math.round(result.pixelRect.right * scaleX);
      const tileBottom = Math.round(result.pixelRect.bottom * scaleY);
      const tileWidth = Math.max(1, tileRight - tileLeft);
      const tileHeight = Math.max(1, tileBottom - tileTop);
      const originalTile = document.createElement('canvas');
      originalTile.width = tileWidth; originalTile.height = tileHeight;
      const originalTileContext = originalTile.getContext('2d');
      if (!originalTileContext) throw new Error('Non posso controllare il colore del ritaglio.');
      originalTileContext.drawImage(
        original,
        result.pixelRect.left,
        result.pixelRect.top,
        result.pixelRect.width,
        result.pixelRect.height,
        0,
        0,
        tileWidth,
        tileHeight,
      );
      const stabilized = colorStabilizedRoomLayer(originalTile, generated[resultIndex], tileWidth, tileHeight);
      const fullPatch = document.createElement('canvas');
      const sharpMask = document.createElement('canvas');
      const softMask = document.createElement('canvas');
      fullPatch.width = sharpMask.width = softMask.width = width;
      fullPatch.height = sharpMask.height = softMask.height = height;
      const patchContext = fullPatch.getContext('2d');
      const sharpContext = sharpMask.getContext('2d');
      const softContext = softMask.getContext('2d');
      if (!patchContext || !sharpContext || !softContext) throw new Error('Non posso fondere il ritaglio pulito.');
      patchContext.drawImage(stabilized, tileLeft, tileTop, tileWidth, tileHeight);
      const repairMargin = result.envelope.outsetSourcePx * Math.min(scaleX, scaleY);
      const shadowOffset = result.envelope.shadowOffsetSourcePx * scaleY;
      sharpContext.fillStyle = '#ffffff'; sharpContext.strokeStyle = '#ffffff';
      sharpContext.lineWidth = repairMargin * 2; sharpContext.lineJoin = 'round'; sharpContext.lineCap = 'butt';
      for (const region of result.regions) {
        traceNormalized(sharpContext, region.points); sharpContext.fill(); strokeNormalizedBoundary(sharpContext, region);
        sharpContext.save(); sharpContext.translate(0, shadowOffset); strokeNormalizedBoundary(sharpContext, region); sharpContext.restore();
      }
      const feather = Math.min(6, Math.max(3, Math.round(Math.min(width, height) * .004)));
      softContext.filter = `blur(${feather}px)`;
      softContext.drawImage(sharpMask, 0, 0);
      softContext.filter = 'none';
      softContext.globalCompositeOperation = 'destination-in';
      softContext.drawImage(sharpMask, 0, 0);
      patchContext.globalCompositeOperation = 'destination-in';
      patchContext.drawImage(softMask, 0, 0);
      context.drawImage(fullPatch, 0, 0);

      // The quality gate must receive the *actual* compositing envelope, not
      // the detector's tighter polygon.  The previous raw-polygon guide made
      // legitimate feather/shadow repairs look like unauthorized changes.
      const authorizationMargin = repairMargin;
      authorizationContext.fillStyle = '#ff00ff';
      authorizationContext.strokeStyle = '#ff00ff';
      authorizationContext.lineWidth = authorizationMargin * 2;
      authorizationContext.lineJoin = 'round';
      authorizationContext.lineCap = 'butt';
      for (const region of result.regions) {
        traceNormalized(authorizationContext, region.points);
        authorizationContext.fill();
        strokeNormalizedBoundary(authorizationContext, region);
        authorizationContext.save();
        authorizationContext.translate(0, shadowOffset);
        strokeNormalizedBoundary(authorizationContext, region);
        authorizationContext.restore();
      }
    }

    // User Freeze protects the full selected surface.  Automatic door/window
    // protection restores only the architectural outline: furniture may sit
    // in front of an opening and must remain removable instead of being copied
    // back with the whole interior of the opening.
    const restoreMask = document.createElement('canvas');
    const restorePatch = document.createElement('canvas');
    restoreMask.width = restorePatch.width = width;
    restoreMask.height = restorePatch.height = height;
    const restoreMaskContext = restoreMask.getContext('2d');
    const restorePatchContext = restorePatch.getContext('2d');
    if (!restoreMaskContext || !restorePatchContext) throw new Error('Non posso ripristinare le aperture protette.');
    restoreMaskContext.fillStyle = '#ffffff';
    restoreMaskContext.strokeStyle = '#ffffff';
    restoreMaskContext.lineJoin = 'round';
    restoreMaskContext.lineWidth = Math.max(5, Math.min(width, height) * .012);
    for (const surface of protectedSurfaces) {
      traceNormalized(restoreMaskContext, surface.points);
      if (cleanupProtectionMode(surface) === 'fill') restoreMaskContext.fill();
      else restoreMaskContext.stroke();
    }
    restorePatchContext.drawImage(original, 0, 0, width, height);
    restorePatchContext.globalCompositeOperation = 'destination-in';
    restorePatchContext.drawImage(restoreMask, 0, 0);
    context.drawImage(restorePatch, 0, 0);
    const [blob, authorizationReference] = await Promise.all([
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png')),
      new Promise<Blob | null>((resolve) => authorizationCanvas.toBlob(resolve, 'image/png')),
    ]);
    if (!blob || !authorizationReference) throw new Error('Non posso completare la ricomposizione locale.');
    return { previewUrl: URL.createObjectURL(blob), authorizationReference };
  }

  async function generateCleanupTiles(
    sourceUrl: string,
    regions: CleanupRegion[],
    protectedSurfaces: Surface[],
    mode: 'automatic' | 'local',
  ) {
    const source = await loadImageSource(sourceUrl);
    const sourceSize = { width: source.naturalWidth, height: source.naturalHeight };
    const globalContext = await createGeometryInput(sourceUrl);
    // A furnished kitchen can legitimately contain more than twenty distinct
    // detections spread across the frame. Keep every edit local, group nearby
    // connected targets and use the full safe request budget when needed.
    const plans = mode === 'local'
      ? planCleanupTiles(regions, 4, sourceSize)
      : planRoomCleanupPass(regions, 12, sourceSize);
    const results: CleanupTileResult[] = [];
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      setNotice(mode === 'local'
        ? 'Pulisco il ritaglio locale senza rigenerare il resto della fotografia…'
        : `Pulisco la zona ${index + 1} di ${plans.length} senza rigenerare il resto della fotografia…`);
      const prepared = await createCleanupTileInput(source, plan, protectedSurfaces);
      const form = new FormData();
      form.append('image', prepared.inputImage, `room-tile-${index + 1}.jpg`);
      form.append('mask', prepared.mask, `room-tile-mask-${index + 1}.png`);
      form.append('maskReference', prepared.maskReference, `room-tile-guide-${index + 1}.png`);
      const wholeRoomPass = plan.bounds.left === 0 && plan.bounds.top === 0
        && plan.bounds.right === 1 && plan.bounds.bottom === 1;
      if (!wholeRoomPass) form.append('contextImage', globalContext, 'room-global-context.jpg');
      form.append('localCrop', wholeRoomPass ? 'false' : 'true');
      const hasMultipleTargets = prepared.normalizedRegions.length > 1;
      let route = endpoint('/api/empty-room');
      if (mode === 'local' && !hasMultipleTargets) {
        route = endpoint('/api/clean-room-region');
        form.append('targetLabel', prepared.normalizedRegions[0].label);
        form.append('targetArea', JSON.stringify(prepared.normalizedRegions[0].points));
      } else {
        form.append('targetAreas', JSON.stringify(prepared.normalizedRegions.map((region) => ({
          label: region.label, points: region.points,
        }))));
        form.append('protectedAreas', protectedSurfaces.filter((surface) => surface.frozen)
          .map((surface) => surface.name).join(', '));
      }
      const { response, result } = await requestJson<{ image?: string; message?: string }>(
        route, { method: 'POST', body: form }, 210000,
      );
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Pulizia locale non disponibile.');
      results.push({
        bounds: prepared.bounds,
        pixelRect: prepared.pixelRect,
        sourceSize: prepared.sourceSize,
        envelope: prepared.envelope,
        regions: prepared.regions,
        image: result.image,
      });
    }
    const composed = await composeCleanupTiles(sourceUrl, results, protectedSurfaces);
    return { ...composed, planCount: plans.length, sourceSize };
  }

  async function protectAiResult(resultSource: string, options: {
    editableSurface?: Surface;
    editableSurfaces?: Surface[];
    editableFurniture?: PlacedFurniture[];
    protectedSurfaces?: Surface[];
    frozenSurfaces?: Surface[];
    sourceUrl?: string;
    stabilizeColor?: boolean;
    deferCommit?: boolean;
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
    const generatedLayer = options.stabilizeColor
      ? colorStabilizedRoomLayer(original, generated, width, height)
      : generated;

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
    const drawFeatheredGeneratedSurface = (surface: Surface) => {
      const sharpMask = document.createElement('canvas');
      const softMask = document.createElement('canvas');
      const generatedPatch = document.createElement('canvas');
      sharpMask.width = softMask.width = generatedPatch.width = width;
      sharpMask.height = softMask.height = generatedPatch.height = height;
      const sharpContext = sharpMask.getContext('2d');
      const softContext = softMask.getContext('2d');
      const patchContext = generatedPatch.getContext('2d');
      if (!sharpContext || !softContext || !patchContext) {
        context.save(); clipTo(surface); drawImageCover(context, generatedLayer, width, height); context.restore();
        return;
      }
      const tracePolygon = (target: CanvasRenderingContext2D) => {
        target.beginPath();
        surface.points.forEach((point, index) => {
          const x = point.x * width; const y = point.y * height;
          if (index === 0) target.moveTo(x, y); else target.lineTo(x, y);
        });
        target.closePath();
      };
      const repairMargin = Math.max(5, Math.round(Math.min(width, height) * .012));
      const feather = Math.max(3, Math.round(Math.min(width, height) * .007));
      sharpContext.fillStyle = '#fff'; sharpContext.strokeStyle = '#fff';
      sharpContext.lineJoin = 'round'; sharpContext.lineCap = 'round'; sharpContext.lineWidth = repairMargin * 2;
      tracePolygon(sharpContext); sharpContext.fill(); sharpContext.stroke();
      softContext.filter = `blur(${feather}px)`;
      softContext.drawImage(sharpMask, 0, 0);
      drawImageCover(patchContext, generatedLayer, width, height);
      patchContext.globalCompositeOperation = 'destination-in';
      patchContext.drawImage(softMask, 0, 0);
      context.drawImage(generatedPatch, 0, 0);
    };

    const editableSurfaces = options.editableSurfaces ?? (options.editableSurface ? [options.editableSurface] : []);
    const editableFurniture = options.editableFurniture ?? [];
    if (editableSurfaces.length || editableFurniture.length) {
      context.drawImage(original, 0, 0, width, height);
      for (const surface of editableSurfaces) drawFeatheredGeneratedSurface(surface);
      for (const surface of options.protectedSurfaces ?? []) {
        context.save(); clipTo(surface); context.drawImage(original, 0, 0, width, height); context.restore();
      }
      // Furniture is the foreground layer and may cover a Freeze surface
      // without allowing the model to redesign that surface elsewhere.
      for (const item of editableFurniture) {
        context.save(); clipPoints(rectPoints(furnitureEditRect(item))); drawImageCover(context, generatedLayer, width, height); context.restore();
      }
    } else {
      drawImageCover(context, generatedLayer, width, height);
      for (const surface of options.frozenSurfaces ?? []) {
        context.save();
        clipTo(surface);
        context.drawImage(original, 0, 0, width, height);
        context.restore();
      }
    }

    const protectedImage = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!protectedImage) throw new Error('Non posso completare la protezione Freeze.');
    const protectedUrl = URL.createObjectURL(protectedImage);
    if (!options.deferCommit) {
      if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
      processedBlobRef.current = protectedUrl;
    }
    return protectedUrl;
  }

  async function assertVisibleSurfaceEdit(sourceUrl: string, previewUrl: string, surface: Surface) {
    const [original, edited] = await Promise.all([loadImageSource(sourceUrl), loadImageSource(previewUrl)]);
    const maxSide = 640;
    const scale = Math.min(1, maxSide / Math.max(original.naturalWidth, original.naturalHeight));
    const width = Math.max(1, Math.round(original.naturalWidth * scale));
    const height = Math.max(1, Math.round(original.naturalHeight * scale));
    const pixels = [original, edited].map((image) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Non posso controllare il risultato del materiale.');
      drawImageCover(context, image, width, height);
      return context.getImageData(0, 0, width, height).data;
    });
    const difference = assessVisibleSurfaceEdit(pixels[0], pixels[1], width, height, surface.points);
    if (!difference.visiblyChanged) {
      throw new Error('Il prodotto non è stato applicato in modo visibile: il risultato è stato scartato e la stanza è rimasta intatta. Prova con un campione del materiale.');
    }
  }

  async function verifyCleanupPreview(
    sourceUrl: string,
    previewUrl: string,
    targetDescription: string,
    targetRegions: CleanupRegion[],
    authorizationReference?: Blob,
  ) {
    const [source, renderedResponse] = await Promise.all([
      createGeometryInput(sourceUrl),
      fetch(previewUrl),
    ]);
    if (!renderedResponse.ok) throw new Error('Non posso controllare la fotografia pulita.');
    const rendered = await renderedResponse.blob();
    const form = new FormData();
    form.append('source', source, 'original-room.jpg');
    form.append('rendered', rendered, 'cleaned-room.png');
    form.append('targetDescription', targetDescription);
    if (authorizationReference) {
      form.append('maskReference', authorizationReference, 'authorized-cleanup-areas.png');
    } else if (targetRegions.length) {
      const verificationSurfaces: Surface[] = targetRegions.map((region, index) => ({
        id: `verify-cleanup-${index}`, name: region.label, kind: 'other', frozen: false, points: region.points,
      }));
      const { maskReference } = await createMaskedInput({ editableSurfaces: verificationSurfaces, sourceUrl });
      form.append('maskReference', maskReference, 'authorized-cleanup-areas.png');
    }
    const { response, result } = await requestJson<{
      accepted?: boolean;
      code?: string;
      message?: string;
      checks?: Record<string, boolean | number>;
    }>(
      endpoint('/api/verify-cleanup'), { method: 'POST', body: form }, 90000,
    );
    if (!response.ok || !result.accepted) {
      if (result.checks) console.warn('Materia cleanup quality checks', result.checks);
      const failure = new Error(result.message ?? 'La pulizia non ha superato il controllo fotografico.') as Error & {
        cleanupChecks?: Record<string, boolean | number>;
        cleanupFailureCode?: string;
      };
      failure.cleanupChecks = result.checks;
      failure.cleanupFailureCode = result.code;
      throw failure;
    }
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

  async function createAiCleanedFurnitureFile(file: File) {
    const form = new FormData();
    form.append('image', file, file.name || 'prodotto.jpg');
    const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/clean-product'), {
      method: 'POST', body: form,
    }, 100000);
    if (!response.ok || !result.image) throw new Error(result.message ?? 'Pulizia BRIA non disponibile.');
    return result.image;
  }

  async function prepareFurnitureView(
    sourceUrl: string,
    productName: string,
    facing: FurnitureFacing,
    productDescription?: string,
  ) {
    const sourceResponse = await fetch(sourceUrl);
    if (!sourceResponse.ok) throw new Error('Non riesco a rileggere la sagoma del mobile.');
    const sourceBlob = await sourceResponse.blob();
    const form = new FormData();
    form.append('image', new File([sourceBlob], 'mobile-scontornato.png', { type: sourceBlob.type || 'image/png' }));
    form.append('facing', facing);
    form.append('productName', productName);
    if (productDescription) form.append('productDescription', productDescription);
    const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/prepare-furniture-view'), {
      method: 'POST', body: form,
    }, 170000);
    if (!response.ok || !result.image) throw new Error(result.message ?? 'Ricostruzione della prospettiva non disponibile.');
    return createFurnitureCutout(result.image, productName, undefined, false, productDescription);
  }

  async function applyMaterialAutomatically(chosenMaterial: StudioMaterial | null = material) {
    if (!chosenMaterial || !room?.previewUrl || isApplyingProduct) return;
    setMaterial(chosenMaterial);
    if (chosenMaterial.category === 'Arredi') {
      startFurniturePlacement(chosenMaterial.name, chosenMaterial.previewUrl, chosenMaterial.description);
      return;
    }
    const target = recommendedSurface(chosenMaterial);
    if (!target) {
      const targetLabel = chosenMaterial.category === 'Pavimenti' ? 'il Pavimento' : 'un muro';
      setError(`Non trovo ${targetLabel} disponibile. Correggi i contorni oppure sblocca la superficie giusta prima di applicare il prodotto.`);
      return;
    }
    setSelectedId(target.id); setRenameDraft(target.name); setShowSurfaceGuides(true); setError(null);

    if (requiresVerifiedSurfaceSample(chosenMaterial)) {
      setNotice(`${chosenMaterial.name} è un prodotto verificato, ma la fonte non fornisce una texture applicabile. Carica un campione del materiale: non inventerò il disegno dal solo nome.`);
      materialInputRef.current?.click();
      return;
    }

    if (!chosenMaterial.sourceUrl) {
      commitSurfaces(surfaces.map((surface) => surface.id === target.id ? { ...surface, materialId: chosenMaterial.id } : surface));
      setNotice(`${chosenMaterial.name} applicato automaticamente a ${target.name}. Le zone bloccate non sono state toccate.`);
      return;
    }

    setIsApplyingProduct(true);
    setNotice(`Adatto ${chosenMaterial.name} a ${target.name} rispettando prospettiva e zone bloccate…`);
    try {
      const { inputImage, mask, maskReference } = await createMaskedInput({ editableSurface: target });
      const form = new FormData();
      form.append('image', inputImage, 'surface-input.jpg');
      form.append('mask', mask, 'surface-mask.png');
      form.append('maskReference', maskReference, 'surface-mask-reference.png');
      form.append('productName', `${chosenMaterial.brand ? `${chosenMaterial.brand} ` : ''}${chosenMaterial.name}`);
      form.append('productDescription', `${chosenMaterial.description} · fonte: ${chosenMaterial.sourceUrl}`);
      form.append('targetName', target.name);
      form.append('roomMeasurements', `width ${roomMeasurement.widthMeters} m; depth ${roomMeasurement.depthMeters} m; height ${roomMeasurement.heightMeters} m; confidence ${Math.round(roomMeasurement.confidence * 100)}%; reference ${roomMeasurement.referenceLabel}`);
      form.append('protectedAreas', surfaces.filter((surface) => surface.frozen).map((surface) => surface.name).join(', '));
      // Only a verified flat texture (or an uploaded sample, stored as
      // textureUrl) may be sent as the visual surface reference.
      const referenceUrl = chosenMaterial.textureUrl;
      if (chosenMaterial.referenceKind === 'uploaded-sample' && materialSampleRef.current) {
        form.append('materialReference', materialSampleRef.current, 'campione-materiale.png');
      } else if (referenceUrl) {
        form.append('imageUrl', referenceUrl);
      }
      form.append('referenceType', chosenMaterial.referenceKind ?? 'metadata-only');
      const { response, result } = await requestJson<{ image?: string; message?: string }>(endpoint('/api/apply-product'), { method: 'POST', body: form }, 180000);
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Render non disponibile.');
      const protectedPreview = await protectAiResult(result.image, { editableSurface: target, deferCommit: true });
      try {
        await assertVisibleSurfaceEdit(room.previewUrl, protectedPreview, target);
      } catch (caught) {
        URL.revokeObjectURL(protectedPreview);
        throw caught;
      }
      if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
      processedBlobRef.current = protectedPreview;
      const updatedSurfaces = surfaces.map((surface) => surface.id === target.id ? { ...surface, materialId: chosenMaterial.id } : surface);
      commitSurfaces(updatedSurfaces);
      processedSurfacesRef.current = updatedSurfaces;
      setProcessedPreview(protectedPreview); setProcessedLabel(chosenMaterial.name); setShowProcessedPreview(true);
      setNotice(`${chosenMaterial.name} adattato a ${target.name} usando il campione visivo. Fuori dal contorno restano i pixel originali.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito ad applicare il prodotto.'); setNotice(null);
    } finally { setIsApplyingProduct(false); }
  }

  function chooseMaterial(next: StudioMaterial) {
    setMaterial(next);
    const target = recommendedSurface(next);
    if (target) {
      setSelectedId(target.id); setRenameDraft(target.name); setShowSurfaceGuides(true);
      setNotice(`${next.name} selezionato per ${target.name}. Tocca “Prova ora” per applicarlo.`);
    } else {
      setNotice(`${next.name} selezionato. Sblocca una superficie per applicarlo.`);
    }
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
      try {
        const cutoutUrl = next.previewUrl
          ? await createAiCleanedFurnitureCutout(next.previewUrl, name, next.description)
          : undefined;
        if (!cutoutUrl) throw new Error('Non sono riuscito a isolare il mobile dalla foto.');
        setNotice(`Ricostruisco “${name}” in vista frontale senza cambiarne geometria e materiali…`);
        setIsPreparingFurniture(true);
        const frontViewUrl = await prepareFurnitureView(cutoutUrl, name, 'front-wall', next.description);
        startFurniturePlacement(name, next.previewUrl, next.description, undefined, cutoutUrl, undefined, { 'front-wall': frontViewUrl });
      } catch (caught) {
        setError(caught instanceof Error
          ? `Non inserisco la foto intera: ${caught.message}`
          : 'Non sono riuscito a isolare il mobile dalla foto.');
        setNotice(null);
      } finally { setIsPreparingFurniture(false); }
      return;
    }
    chooseMaterial(next);
  }

  function startFurniturePlacement(name: string, previewUrl?: string, description?: string, file?: File, cutoutUrl?: string, sidePreviewUrl?: string, preparedViews?: Partial<Record<FurnitureFacing, string>>) {
    if (!room || room.sourceType !== 'photo') {
      setError('Per posizionare un mobile serve una foto della stanza.');
      return;
    }
    setPendingFurniture({ name, previewUrl, sidePreviewUrl, cutoutUrl, preparedViews, description, file });
    setSelectedFurnitureId(null);
    setNotice(`Tocca il punto del pavimento dove vuoi mettere “${name}”.`);
  }

  async function importFurniture(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('La foto del mobile deve essere JPG, PNG o WEBP.'); return; }
    if (file.size > 12 * 1024 * 1024) { setError('La foto prodotto supera il limite di 12 MB.'); return; }
    if (isClassifyingProduct) return;
    setIsClassifyingProduct(true); setError(null);
    setNotice('Riconosco automaticamente se hai fotografato un materiale oppure un mobile…');
    try {
      const form = new FormData();
      form.append('image', file, file.name || 'prodotto.jpg');
      form.append('intendedTarget', selected?.kind === 'floor' ? 'floor' : 'wall');
      const { response, result } = await requestJson<ProductPhotoClassification>(endpoint('/api/classify-product'), {
        method: 'POST', body: form,
      }, 70000);
      if (!response.ok) throw new Error(result.message ?? 'Non sono riuscito a riconoscere la foto prodotto.');

      if (result.kind === 'surface-material') {
        if (!result.usableSample) {
          throw new Error(`Ho riconosciuto “${result.label}” come materiale, ma nella foto non c’è una zona pulita da usare. Avvicinati alla lastra o al campione evitando persone, bordi ed espositori.`);
        }
        const sourceUrl = URL.createObjectURL(file);
        let sample: Blob;
        try {
          sample = await cropMaterialSample(sourceUrl, result.sampleBounds);
        } finally {
          URL.revokeObjectURL(sourceUrl);
        }
        if (materialBlobRef.current) URL.revokeObjectURL(materialBlobRef.current);
        const previewUrl = URL.createObjectURL(sample);
        materialBlobRef.current = previewUrl;
        materialSampleRef.current = sample;
        materialIdRef.current += 1;
        const next: StudioMaterial = {
          id: `material-${materialIdRef.current}`,
          name: result.label || file.name.replace(/\.[^.]+$/, ''),
          category: result.category,
          description: 'Campione riconosciuto automaticamente dalla foto',
          previewUrl,
          textureUrl: previewUrl,
          referenceKind: 'uploaded-sample',
          confidence: result.confidence,
        };
        setMaterial(next);
        const targetKind: SurfaceKind = result.category === 'Pavimenti' ? 'floor' : 'wall';
        const target = surfaces.find((surface) => !surface.frozen && surface.kind === targetKind);
        if (!target) {
          throw new Error(result.category === 'Pavimenti'
            ? 'Materiale riconosciuto come pavimento, ma il Pavimento non è disponibile o è bloccato. Sbloccalo e applica il campione.'
            : 'Materiale riconosciuto come rivestimento, ma non c’è un muro disponibile. Sblocca un muro e applica il campione.');
        }
        setSelectedId(target.id); setRenameDraft(target.name); setShowSurfaceGuides(true);
        commitSurfaces(surfaces.map((surface) => surface.id === target.id ? { ...surface, materialId: next.id } : surface));
        setError(null);
        setNotice(`${next.name} riconosciuto e applicato automaticamente a ${target.name}.`);
        return;
      }

      if (result.kind !== 'furniture') {
        throw new Error('Non riconosco con sicurezza un mobile o un materiale. Fotografa un solo prodotto più da vicino, oppure usa “Campione materiale”.');
      }

      const previewUrl = URL.createObjectURL(file);
      const name = result.label || file.name.replace(/\.[^.]+$/, '');
      setNotice(`Scontorno “${name}” e preparo soltanto la sagoma del mobile…`);
      try {
        const cutoutUrl = await createAiCleanedFurnitureFile(file);
        setIsPreparingFurniture(true);
        setNotice(`Ricostruisco “${name}” in vista frontale senza cambiarne geometria e materiali…`);
        const frontViewUrl = await prepareFurnitureView(cutoutUrl, name, 'front-wall');
        furnitureBlobUrlsRef.current.push(previewUrl);
        startFurniturePlacement(name, previewUrl, undefined, file, cutoutUrl, undefined, { 'front-wall': frontViewUrl });
        setError(null);
      } catch (caught) {
        URL.revokeObjectURL(previewUrl);
        throw new Error(caught instanceof Error
          ? `Non inserisco la foto intera: ${caught.message} Riprova con il mobile isolato su uno sfondo semplice.`
          : 'Non sono riuscito a scontornare il mobile. Riprova con uno sfondo semplice.');
      }
    } catch (caught) {
      setError(friendlyRequestError(caught).message); setNotice(null);
    } finally {
      setIsClassifyingProduct(false); setIsPreparingFurniture(false);
    }
  }

  function onFurnitureInput(event: ChangeEvent<HTMLInputElement>) {
    void importFurniture(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  }

  function automaticFurnitureScale(name: string, description: string | undefined, x: number, y: number, measurement = roomMeasurement) {
    const floor = surfaces.find((surface) => surface.kind === 'floor');
    const floorContact = floorContactYAtX(floor, x);
    return perspectiveFurnitureScale(name, description, y, floorContact, floor, measurement);
  }

  function rememberFurnitureState(snapshot = placedFurniture) {
    setPastFurniture((history) => [...history.slice(-19), snapshot.map((item) => ({
      ...item, preparedViews: item.preparedViews ? { ...item.preparedViews } : undefined,
    }))]);
  }

  function selectFurnitureForEditing(item: PlacedFurniture) {
    const width = productWidthMeters(item.name, item.description);
    setSelectedFurnitureId(item.id);
    setFurnitureWidthDraft(width ? String(Math.round(width * 1000) / 10).replace('.', ',') : '');
  }

  function undoFurnitureChange() {
    const previous = pastFurniture[pastFurniture.length - 1];
    if (!previous) return;
    const restoredSelected = previous.find((item) => item.id === selectedFurnitureId) ?? previous.at(-1) ?? null;
    setPlacedFurniture(previous);
    setPastFurniture((history) => history.slice(0, -1));
    setSelectedFurnitureId(restoredSelected?.id ?? null);
    const restoredWidth = restoredSelected ? productWidthMeters(restoredSelected.name, restoredSelected.description) : null;
    setFurnitureWidthDraft(restoredWidth ? String(Math.round(restoredWidth * 1000) / 10).replace('.', ',') : '');
    setPendingFurniture(null); setError(null);
    setNotice('Ultima modifica del mobile annullata.');
  }

  function confirmRoomWidth() {
    const parsed = Number(roomWidthDraft.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 1.5 || parsed > 20) {
      setError('Inserisci una larghezza compresa tra 1,5 e 20 metri.');
      return;
    }
    const calibrated = inferRoomMeasurement(surfaces, roomRatio, parsed);
    setManualRoomWidth(parsed); setIsEditingRoomMeasure(false); setError(null);
    setPlacedFurniture((current) => current.map((item) => item.autoScale
      ? { ...item, scale: automaticFurnitureScale(item.name, item.description, item.x, item.y, calibrated) }
      : item));
    setNotice(`Scala confermata: parete principale ${calibrated.widthMeters.toLocaleString('it-IT')} m. I mobili automatici sono stati ricalcolati.`);
  }

  function confirmFurnitureWidth() {
    if (!selectedFurniture || selectedFurniture.frozen) return;
    const widthCm = Number(furnitureWidthDraft.replace(',', '.'));
    if (!Number.isFinite(widthCm) || widthCm < 20 || widthCm > 1200) {
      setError('Inserisci una larghezza del mobile compresa tra 20 e 1200 cm.');
      return;
    }
    const withoutOldWidth = (selectedFurniture.description ?? '')
      .replace(/(?:^|\s*[·;]\s*)L\s*[\d.,]+\s*cm\b/ig, '')
      .trim();
    const description = [withoutOldWidth, `L ${String(widthCm).replace('.', ',')} cm`].filter(Boolean).join(' · ');
    const next = {
      ...selectedFurniture,
      description,
      autoScale: true,
      scale: automaticFurnitureScale(selectedFurniture.name, description, selectedFurniture.x, selectedFurniture.y),
    };
    rememberFurnitureState();
    setPlacedFurniture((current) => current.map((item) => item.id === selectedFurniture.id ? next : item));
    setError(null);
    setNotice(`${selectedFurniture.name}: larghezza reale ${widthCm.toLocaleString('it-IT')} cm. La scala prospettica è stata ricalcolata sulla misura della stanza.`);
  }

  function restoreAutomaticRoomMeasurement() {
    const automatic = inferRoomMeasurement(surfaces, roomRatio);
    setManualRoomWidth(null); setRoomWidthDraft(''); setIsEditingRoomMeasure(false); setError(null);
    setPlacedFurniture((current) => current.map((item) => item.autoScale
      ? { ...item, scale: automaticFurnitureScale(item.name, item.description, item.x, item.y, automatic) }
      : item));
    setNotice(`Misure automatiche ripristinate usando ${automatic.referenceLabel}.`);
  }

  function placePendingFurniture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!pendingFurniture || activeStep !== 3) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(.94, Math.max(.06, (event.clientX - rect.left) / rect.width));
    const floorContact = floorContactYAtX(surfaces.find((surface) => surface.kind === 'floor'), x);
    // The default target is the front wall: the tap chooses the horizontal
    // anchor, while the floor/wall junction determines the physical contact.
    const y = Math.min(.94, Math.max(.08, floorContact + .025));
    furnitureIdRef.current += 1;
    const id = `furniture-${furnitureIdRef.current}`;
    const scale = automaticFurnitureScale(pendingFurniture.name, pendingFurniture.description, x, y);
    const placed: PlacedFurniture = { id, name: pendingFurniture.name, x, y, scale, autoScale: true, facing: 'front-wall', rotation: 0, frozen: false, previewUrl: pendingFurniture.previewUrl, sidePreviewUrl: pendingFurniture.sidePreviewUrl, cutoutUrl: pendingFurniture.cutoutUrl, preparedViews: pendingFurniture.preparedViews, description: pendingFurniture.description };
    if (pendingFurniture.file) furnitureFilesRef.current.set(id, pendingFurniture.file);
    rememberFurnitureState();
    setPlacedFurniture((current) => [...current, placed]);
    selectFurnitureForEditing(placed);
    setPendingFurniture(null);
    setError(null);
    setNotice(`${placed.name} appoggiato automaticamente al muro frontale e al pavimento, con misura ${Math.round(placed.scale)}%. Puoi scegliere un altro muro o spostarlo.`);
  }

  function beginFurnitureDrag(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    const item = placedFurniture.find((candidate) => candidate.id === id);
    if (!item || item.frozen || !canvasRef.current) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = canvasRef.current.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left) / rect.width;
    const pointerY = (event.clientY - rect.top) / rect.height;
    selectFurnitureForEditing(item);
    setDragFurniture({ id, pointerId: event.pointerId, offsetX: pointerX - item.x, offsetY: pointerY - item.y, previous: placedFurniture });
  }

  function moveFurniture(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragFurniture || dragFurniture.pointerId !== event.pointerId || !canvasRef.current) return;
    event.preventDefault(); event.stopPropagation();
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.min(.96, Math.max(.04, (event.clientX - rect.left) / rect.width - dragFurniture.offsetX));
    const requestedY = (event.clientY - rect.top) / rect.height - dragFurniture.offsetY;
    const floorContact = floorContactYAtX(surfaces.find((surface) => surface.kind === 'floor'), x);
    const y = Math.min(.96, Math.max(floorContact + .015, requestedY));
    setPlacedFurniture((current) => current.map((item) => item.id === dragFurniture.id ? { ...item, x, y, scale: item.autoScale ? automaticFurnitureScale(item.name, item.description, x, y) : item.scale } : item));
  }

  function endFurnitureDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragFurniture?.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const moved = placedFurniture.find((item) => item.id === dragFurniture.id);
    const before = dragFurniture.previous.find((item) => item.id === dragFurniture.id);
    if (moved && before && (Math.abs(moved.x - before.x) > .0001 || Math.abs(moved.y - before.y) > .0001)) {
      rememberFurnitureState(dragFurniture.previous);
    }
    setDragFurniture(null);
  }

  function updateSelectedFurniture(changes: Partial<PlacedFurniture>) {
    if (!selectedFurniture || selectedFurniture.frozen && changes.frozen !== false) return;
    rememberFurnitureState();
    setPlacedFurniture((current) => current.map((item) => item.id === selectedFurniture.id ? { ...item, ...changes } : item));
  }

  async function orientSelectedFurniture(facing: FurnitureFacing) {
    if (!selectedFurniture || selectedFurniture.frozen || isPreparingFurniture) return;
    const item = selectedFurniture;
    const floor = surfaces.find((surface) => surface.kind === 'floor');
    const snapped = snapFurnitureToWall(item, facing, floor);
    rememberFurnitureState();
    setPlacedFurniture((current) => current.map((candidate) => candidate.id === item.id ? snapped : candidate));
    setNotice(`${item.name} agganciato a ${furnitureFacingLabels[facing].toLocaleLowerCase('it')} e appoggiato al pavimento.`);

    const existingView = item.preparedViews?.[facing]
      || (facing !== 'front-wall' ? item.sidePreviewUrl : undefined);
    const sourceUrl = item.cutoutUrl ?? item.previewUrl;
    if (existingView || !sourceUrl) return;
    setIsPreparingFurniture(true); setError(null);
    setNotice(`Ricostruisco la vista di “${item.name}” per ${furnitureFacingLabels[facing].toLocaleLowerCase('it')}, senza cambiarne geometria…`);
    try {
      const preparedView = await prepareFurnitureView(sourceUrl, item.name, facing, item.description);
      setPlacedFurniture((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, preparedViews: { ...(candidate.preparedViews ?? {}), [facing]: preparedView } }
        : candidate));
      setNotice(`${item.name}: vista IA ricostruita, agganciata alla parete e appoggiata al pavimento. Il render finale controllerà ancora somiglianza, scala e contatto.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito a ricostruire la vista del mobile.');
      setNotice('Il mobile è agganciato alla parete, ma la vista fotografica non è stata convalidata: non la considero definitiva.');
    } finally { setIsPreparingFurniture(false); }
  }

  function resizeSelectedFurniture(delta: number) {
    if (!selectedFurniture) return;
    rememberFurnitureState();
    setPlacedFurniture((current) => current.map((item) => item.id === selectedFurniture.id
      ? { ...item, scale: Math.min(90, Math.max(12, item.scale + delta)), autoScale: false }
      : item));
  }

  function nudgeSelectedFurniture(deltaX: number, deltaY: number) {
    if (!selectedFurniture) return;
    rememberFurnitureState();
    setPlacedFurniture((current) => current.map((item) => {
      if (item.id !== selectedFurniture.id || item.frozen) return item;
      const x = Math.min(.96, Math.max(.04, item.x + deltaX));
      const y = Math.min(.96, Math.max(.08, item.y + deltaY));
      return {
        ...item,
        x,
        y,
        scale: item.autoScale ? automaticFurnitureScale(item.name, item.description, x, y) : item.scale,
      };
    }));
  }

  function rotateSelectedFurniture(delta: number) {
    if (!selectedFurniture) return;
    rememberFurnitureState();
    setPlacedFurniture((current) => current.map((item) => item.id === selectedFurniture.id && !item.frozen
      ? { ...item, rotation: Math.min(60, Math.max(-60, item.rotation + delta)) }
      : item));
  }

  function straightenSelectedFurniture() {
    if (!selectedFurniture) return;
    updateSelectedFurniture({ rotation: 0, facing: 'front-wall' });
    setNotice(`${selectedFurniture.name} frontale e raddrizzato a 0°.`);
  }

  function restoreAutomaticFurnitureScale() {
    if (!selectedFurniture) return;
    updateSelectedFurniture({ scale: automaticFurnitureScale(selectedFurniture.name, selectedFurniture.description, selectedFurniture.x, selectedFurniture.y), autoScale: true });
    setNotice(`${selectedFurniture.name}: misura automatica adattata alla profondità della stanza.`);
  }

  function removeSelectedFurniture() {
    if (!selectedFurniture || selectedFurniture.frozen) return;
    rememberFurnitureState();
    furnitureFilesRef.current.delete(selectedFurniture.id);
    setPlacedFurniture((current) => current.filter((item) => item.id !== selectedFurniture.id));
    setSelectedFurnitureId(null);
    setFurnitureWidthDraft('');
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
    const { response, result } = await requestJson<{
      surfaces?: DetectedSurface[];
      openingAuditStatus?: 'verified' | 'geometry-invalid' | 'candidate-unverified' | 'none-found' | 'unavailable';
      shellGeometryStatus?: 'verified' | 'geometry-invalid';
      message?: string;
    }>(
      endpoint('/api/detect-surfaces'),
      { method: 'POST', body: form },
      150000,
    );
    if (!response.ok || !result.surfaces?.length) throw new Error(result.message ?? 'Grok non ha trovato superfici affidabili.');
    geometryDetectionIdRef.current += 1;
    return {
      surfaces: clientValidatedSurfaces(result.surfaces, `grok-${geometryDetectionIdRef.current}`),
      openingAuditStatus: result.openingAuditStatus,
      shellGeometryStatus: result.shellGeometryStatus,
    };
  }

  async function autoFitSurfaces() {
    if (!room?.previewUrl || room.sourceType !== 'photo' || !roomImageRef.current) return;
    if (showProcessedPreview) {
      setNotice('La geometria resta legata alla foto originale. Tocca “Originale” prima di rifare il riconoscimento.');
      return;
    }
    setIsAutoFitting(true); setError(null);
    setNotice(aiStatus === 'ready' || aiStatus === 'checking'
      ? 'Grok sta leggendo gli angoli reali, il pavimento, le pareti e il soffitto…'
      : 'Sto preparando una tracciatura locale della stanza…');
    try {
      let detected: Surface[] | null = null;
      let usedGrok = false;
      let grokError: Error | null = null;
      let openingAuditStatus: string | undefined;
      let shellGeometryStatus: string | undefined;

      if (aiStatus === 'ready' || aiStatus === 'checking') {
        try {
          const recognition = await detectSurfacesForPreview(room.previewUrl, room.file.name);
          detected = recognition.surfaces;
          openingAuditStatus = recognition.openingAuditStatus;
          shellGeometryStatus = recognition.shellGeometryStatus;
          usedGrok = detected.length > 0;
        } catch (caught) {
          grokError = caught instanceof Error ? caught : new Error('Grok non ha completato il riconoscimento.');
        }
      }

      if (!detected?.length && surfaces.length > 0) {
        setIsCorrectingEdges(true);
        setShowSurfaceGuides(true);
        setNotice(`${grokError ? 'Grok non ha completato il riconoscimento. ' : ''}Ho mantenuto i contorni esistenti: puoi riprovare oppure spostare linee e pallini senza perdere il lavoro.`);
        return;
      }
      if (!detected?.length) detected = createGuidedSurfaces(detectRoomBounds(roomImageRef.current));

      const frozenSurfaces = surfaces.filter((surface) => surface.frozen);
      const nextSurfaces = mergeDetectedSurfaces(detected, surfaces);
      const adjusted = nextSurfaces.filter((surface) => !surface.frozen);
      commitSurfaces(nextSurfaces);
      const first = adjusted[0] ?? frozenSurfaces[0] ?? null;
      setSelectedId(first?.id ?? null); setRenameDraft(first?.name ?? '');
      const openingInvalid = usedGrok && openingAuditStatus === 'geometry-invalid';
      const shellInvalid = usedGrok && shellGeometryStatus === 'geometry-invalid';
      setGeometryDetectionStatus(shellInvalid && openingInvalid
        ? 'opening-shell-invalid'
        : shellInvalid ? 'shell-invalid' : openingInvalid ? 'opening-invalid' : usedGrok ? 'ai' : 'fallback');
      setIsCorrectingEdges(!usedGrok || openingInvalid || shellInvalid);
      setShowSurfaceGuides(true);
      setNotice(shellInvalid && openingInvalid
        ? `${nextSurfaces.length} superfici trovate, ma sia l’arco sia i confini della stanza non sono verificabili. Correggi prima l’arco e poi le linee; prodotti, misure e svuotamento restano bloccati.`
        : shellInvalid
        ? `${nextSurfaces.length} superfici trovate, ma pareti, soffitto e pavimento non condividono gli stessi confini. Correggi le linee oppure riprova; prodotti, misure e svuotamento restano bloccati.`
        : openingInvalid
        ? `${nextSurfaces.length} superfici riconosciute, ma l’apertura è stata rifiutata: gli stipiti non arrivano al pavimento o seguono un mobile. Correggi con “＋ Arco” oppure riprova; lo svuotamento resta bloccato.`
        : usedGrok
          ? `${nextSurfaces.length} superfici proposte da controllare sulla foto originale.${nextSurfaces.some((surface) => surface.kind === 'door') ? '' : ' La porta non è sicura: aggiungila con “＋ Porta” e quattro tocchi.'}`
        : `${grokError ? 'Grok non ha completato il riconoscimento. ' : ''}Questi sono contorni provvisori: trascina direttamente una linea intera o i pallini prima di applicare un prodotto.`);
    } catch {
      if (surfaces.length === 0) seedGuidedSurfaces();
      setGeometryDetectionStatus('fallback');
      setIsCorrectingEdges(true);
      setShowSurfaceGuides(true);
      setNotice('Riconoscimento automatico non completato: ho inserito una base provvisoria. Sposta linee e pallini oppure premi “Rifai contorni”.');
    } finally {
      setIsAutoFitting(false);
    }
  }

  function onRoomImageLoad(image: HTMLImageElement) {
    // The overlay belongs to the original pixels. A generated empty-room image
    // may differ slightly in size, but must never stretch the approved geometry.
    if (!showProcessedPreview) setRoomRatio(image.naturalWidth / image.naturalHeight);
    if (room?.sourceType === 'floorplan' && room.previewUrl && autoFitPreviewRef.current !== room.previewUrl) {
      autoFitPreviewRef.current = room.previewUrl;
      window.setTimeout(() => void createRoomFromFloorplan(), 0);
      return;
    }
    if (room?.sourceType === 'photo' && room.previewUrl && surfaces.length === 0 && autoFitPreviewRef.current !== room.previewUrl) {
      autoFitPreviewRef.current = room.previewUrl;
      window.setTimeout(() => void autoFitSurfaces(), 0);
    }
  }

  async function createRoomFromFloorplan() {
    if (!room?.previewUrl || room.sourceType !== 'floorplan' || isCreatingFloorplanRoom) return;
    setIsCreatingFloorplanRoom(true); setError(null);
    setNotice('L’IA sta leggendo perimetro, pareti, porte e finestre e sta creando la stanza vuota…');
    try {
      const form = new FormData();
      form.append('image', room.file, room.file.name || 'planimetria.png');
      const { response, result } = await requestJson<{ image?: string; surfaces?: DetectedSurface[]; message?: string }>(endpoint('/api/floorplan-room'), { method: 'POST', body: form }, 180000);
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Stanza non disponibile.');

      geometryDetectionIdRef.current += 1;
      const created = clientValidatedSurfaces(result.surfaces ?? [], `floorplan-room-${geometryDetectionIdRef.current}`);
      originalSurfacesRef.current = created;
      processedSurfacesRef.current = null;
      cleanupHistoryRef.current = [];
      autoFitPreviewRef.current = created.length ? result.image : null;
      const preferred = created.find((surface) => surface.kind === 'floor') ?? created[0] ?? null;
      setSurfaces(created); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(preferred?.id ?? null); setRenameDraft(preferred?.name ?? '');
      setProcessedPreview(null); setShowProcessedPreview(false); setProcessedLabel('Stanza vuota');
      setRoom((current) => current ? {
        ...current,
        previewUrl: result.image,
        sourceType: 'photo',
        displaySize: 'creata automaticamente dalla planimetria',
        projectName: `${current.projectName} · stanza`,
      } : current);
      const openingCount = created.filter((surface) => surface.kind === 'door' || surface.kind === 'window').length;
      setNotice(created.length
        ? `Stanza creata dalla planimetria: ${created.length} superfici e ${openingCount} aperture riconosciute. Controlla i contorni prima di continuare.`
        : 'Stanza creata dalla planimetria. Completo ora il riconoscimento di pavimento, pareti, porte e finestre.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito a creare la stanza dalla planimetria.');
      setNotice('La planimetria resta modificabile: puoi correggere il perimetro e aggiungere pareti a mano.');
    } finally {
      setIsCreatingFloorplanRoom(false);
    }
  }

  async function emptyRoom() {
    if (!room?.previewUrl || room.sourceType !== 'photo' || isEmptyingRoom) return;
    if (geometryDetectionBlocked) {
      setError(geometryHasOpeningIssue
        ? 'L’apertura non ha ancora un contorno sicuro. Rifai il riconoscimento oppure traccia l’arco fino al pavimento prima di svuotare la stanza.'
        : 'I piani della stanza non condividono ancora confini sicuri. Rifai il riconoscimento oppure correggi le linee prima di svuotare la stanza.');
      setNotice(null);
      return;
    }
    const baselineSurfaces = processedLabel === 'Stanza vuota' && processedPreview && originalSurfacesRef.current.length
      ? originalSurfacesRef.current
      : surfaces;
    setCleanupRegion(null); setIsPickingCleanup(false);
    setIsEmptyingRoom(true); setError(null);
    setShowProcessedPreview(false);
    setSurfaces(baselineSurfaces);
    setNotice('Terra controlla se la stanza va svuotata; Grok delimita soltanto gli oggetti da rimuovere. Pareti, pavimento e aperture resteranno protetti.');
    try {
      const detectionImage = await createGeometryInput(room.previewUrl);
      const detectionForm = new FormData();
      detectionForm.append('image', detectionImage, 'room-objects.jpg');
      detectionForm.append('mode', 'all');
      type RoomEmptyingAudit = {
        needsEmptying: boolean;
        removableObjectCount: number;
        majorCategories: string[];
        confidence: number;
        reason: string;
      };
      let detected: Awaited<ReturnType<typeof requestJson<{
        regions?: CleanupRegion[];
        roomAudit?: RoomEmptyingAudit | null;
        message?: string;
      }>>>;
      try {
        detected = await requestJson<{
          regions?: CleanupRegion[];
          roomAudit?: RoomEmptyingAudit | null;
          message?: string;
        }>(
          endpoint('/api/detect-object'), { method: 'POST', body: detectionForm }, 90000,
        );
        if (!detected.response.ok) throw new Error(detected.result.message ?? 'Non riesco a delimitare i mobili.');
      } catch {
        setIsPickingCleanup(true);
        setError(null);
        setNotice('Il riconoscimento automatico non si è concluso. Tocca il centro di un mobile: lo delimito e rimuovo senza cambiare la stanza. Puoi anche continuare con la foto originale.');
        return;
      }
      const regions = (detected.result.regions ?? []).filter((region) => isValidPolygon(region.points));
      const roomAudit = detected.result.roomAudit;
      const categories = roomAudit?.majorCategories.filter(Boolean).slice(0, 5).join(', ') ?? '';
      if (roomAudit && roomAudit.confidence >= .7 && !roomAudit.needsEmptying) {
        setNotice(`Terra conferma che la stanza è già vuota${roomAudit.reason ? `: ${roomAudit.reason}` : '.'} Nessuna parte della foto è stata modificata.`);
        return;
      }
      if (!regions.length) {
        setIsPickingCleanup(true);
        setNotice(roomAudit?.needsEmptying
          ? `Terra vede elementi da rimuovere${categories ? ` (${categories})` : ''}, ma Grok non è riuscito a delimitarli con precisione. Tocca il centro di un mobile per indicarlo; la stanza non verrà modificata automaticamente.`
          : 'Il controllo non ha individuato con sufficiente certezza zone da rimuovere. Se la stanza è già vuota puoi continuare; altrimenti tocca il centro di un mobile per indicarlo.');
        return;
      }

      setNotice(`${roomAudit?.needsEmptying ? 'Terra ha confermato che la stanza va svuotata. ' : ''}Grok ha delimitato ${regions.length} zone da pulire${categories ? `: ${categories}` : ''}. Le elaboro in ritagli locali e proteggo ogni altro pixel.`);
      const architecturalAnchors = baselineSurfaces.filter((surface) => surface.frozen || surface.kind === 'door' || surface.kind === 'window');
      let finalRegions = regions;
      let cleanupResult = await generateCleanupTiles(room.previewUrl, finalRegions, architecturalAnchors, 'automatic');
      let protectedPreview = cleanupResult.previewUrl;

      // A first edit can remove the large fitted units yet leave lamps,
      // countertop appliances, chairs or fragments behind. Inspect the actual
      // result up to twice. Every retry rebuilds from the untouched original
      // with one cumulative mask; an already-generated patch is never used as
      // the inpainting source.
      let usedCleanupRequests = cleanupResult.planCount;
      for (let residualPass = 0; residualPass < 2 && usedCleanupRequests <= 10; residualPass += 1) {
        try {
          setNotice(`Controllo residui ${residualPass + 1} di 2: cerco lampade, mobili, elettrodomestici e piccoli frammenti…`);
          const residualImage = await createGeometryInput(protectedPreview);
          const residualForm = new FormData();
          residualForm.append('image', residualImage, 'room-residuals.jpg');
          residualForm.append('mode', 'all');
          const residualDetection = await requestJson<{
            regions?: CleanupRegion[];
            roomAudit?: RoomEmptyingAudit | null;
            message?: string;
          }>(endpoint('/api/detect-object'), { method: 'POST', body: residualForm }, 90000);
          if (!residualDetection.response.ok) {
            throw new Error(residualDetection.result.message ?? 'Il controllo dei residui non è disponibile.');
          }
          const residualRegions = (residualDetection.result.regions ?? [])
            .filter((region) => isValidPolygon(region.points));
          const residualAudit = residualDetection.result.roomAudit;
          if (!residualRegions.length || (residualAudit && !residualAudit.needsEmptying && residualAudit.confidence >= .7)) break;
          const cumulativeRegions = [...finalRegions, ...residualRegions];
          const cumulativePlanCount = planRoomCleanupPass(cumulativeRegions, 12, cleanupResult.sourceSize).length;
          if (usedCleanupRequests + cumulativePlanCount > 12) break;
          setNotice(`Sono rimaste ${residualRegions.length} zone. Ricostruisco dall’originale con la maschera cumulativa, senza sovrapporre toppe…`);
          const rebuilt = await generateCleanupTiles(room.previewUrl, cumulativeRegions, architecturalAnchors, 'automatic');
          usedCleanupRequests += rebuilt.planCount;
          URL.revokeObjectURL(protectedPreview);
          cleanupResult = rebuilt;
          protectedPreview = rebuilt.previewUrl;
          finalRegions = cumulativeRegions;
          if (residualPass === 1) {
            setNotice('Seconda ricostruzione completata: avvio il controllo fotografico finale.');
          }
        } catch (caught) {
          if (caught instanceof Error && /limite temporaneo|rate.?limit/i.test(caught.message)) throw caught;
          // The final verifier still decides whether the first pass is safe.
          // A failed optional residual inventory must never discard a valid
          // cleanup or make the original unavailable.
        }
      }
      try {
        setNotice('Controllo che inquadratura, pareti, porte e finestre siano rimaste identiche…');
        await verifyCleanupPreview(
          room.previewUrl,
          protectedPreview,
          finalRegions.map((region) => region.label).join(', '),
          finalRegions,
          cleanupResult.authorizationReference,
        );
      } catch (caught) {
        if (new URLSearchParams(window.location.search).has('qa')) {
          cleanupHistoryRef.current = finalRegions.map((region) => ({ ...region, points: region.points.map((point) => ({ ...point })) }));
          if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
          processedBlobRef.current = protectedPreview;
          setProcessedPreview(protectedPreview);
          const failureCode = (caught as Error & { cleanupFailureCode?: string }).cleanupFailureCode;
          setProcessedLabel(failureCode === 'cleanup_quality_rejected'
            ? 'Anteprima QA rifiutata'
            : 'Anteprima QA non verificata');
          setShowProcessedPreview(true);
        } else {
          URL.revokeObjectURL(protectedPreview);
        }
        throw caught;
      }
      if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
      processedBlobRef.current = protectedPreview;
      setProcessedPreview(protectedPreview); setProcessedLabel('Stanza vuota'); setShowProcessedPreview(true);
      cleanupHistoryRef.current = finalRegions.map((region) => ({ ...region, points: region.points.map((point) => ({ ...point })) }));
      const approved = geometryForDerivedImage(baselineSurfaces);
      originalSurfacesRef.current = geometryForDerivedImage(baselineSurfaces);
      processedSurfacesRef.current = approved;
      setSurfaces(approved); setPastSurfaces([]); setFutureSurfaces([]);
      const preferred = approved.find((surface) => surface.kind === 'floor') ?? approved[0] ?? null;
      setSelectedId(preferred?.id ?? null); setRenameDraft(preferred?.name ?? '');
      setNotice(`Stanza pulita in ${finalRegions.length} zone. Fuori dai contorni dei mobili i pixel, le linee e le misure sono rimasti identici.`);
    } catch (caught) {
      setError(friendlyRequestError(caught).message);
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
      if (!result.region || !isValidPolygon(result.region.points)) {
        // A cleanup residue is often a shadow, reflection or generated smear,
        // not a recognizable piece of furniture.  The user's tap is still an
        // explicit authorization: create a small editable patch around it
        // instead of making “Pulisci un residuo” a no-op.
        const protectedAtTap = surfaces.find((surface) => (
          surface.frozen || surface.kind === 'door' || surface.kind === 'window'
        ) && pointInsidePolygon(point, surface.points));
        if (protectedAtTap) {
          setIsPickingCleanup(false);
          setCleanupRegion(null);
          setNotice(`${protectedAtTap.name} è protetta e non verrà modificata. Tocca soltanto il residuo sulla parete o sul pavimento.`);
          return;
        }
        const halfWidth = .075;
        const halfHeight = .09;
        const left = Math.max(0, point.x - halfWidth);
        const right = Math.min(1, point.x + halfWidth);
        const top = Math.max(0, point.y - halfHeight);
        const bottom = Math.min(1, point.y + halfHeight);
        setCleanupRegion({
          label: 'residuo indicato',
          confidence: 1,
          points: [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
          ],
        });
        setIsPickingCleanup(false);
        setNotice('Non è un mobile riconoscibile: ho preparato una piccola zona attorno al punto indicato. Premi “Pulisci selezione” per correggere anche ombre, riflessi o residui.');
        return;
      }
      setCleanupRegion(result.region); setIsPickingCleanup(false);
      setNotice(`${result.region.label} riconosciuto. Controlla il contorno evidenziato e premi “Pulisci selezione”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito a riconoscere l’oggetto.'); setNotice(null);
    } finally { setIsDetectingCleanup(false); }
  }

  async function cleanResidualRegion() {
    if (!cleanupRegion || !room?.previewUrl || isCleaningRegion) return;
    const previousRegions = cleanupHistoryRef.current;
    const rebuildFromOriginal = previousRegions.length > 0;
    const sourceUrl = rebuildFromOriginal ? room.previewUrl : showProcessedPreview && processedPreview ? processedPreview : room.previewUrl;
    const cumulativeRegions = rebuildFromOriginal ? [...previousRegions, cleanupRegion] : [cleanupRegion];
    setIsCleaningRegion(true); setError(null); setNotice(rebuildFromOriginal
      ? `Aggiungo “${cleanupRegion.label}” alla maschera completa e ricostruisco dall’originale, senza applicare una toppa sopra l’altra.`
      : `Pulisco soltanto “${cleanupRegion.label}”. Tutto il resto viene ricopiato pixel per pixel.`);
    try {
      const architecturalAnchors = surfaces.filter((surface) => surface.frozen || surface.kind === 'door' || surface.kind === 'window');
      const cleanupResult = await generateCleanupTiles(sourceUrl, cumulativeRegions, architecturalAnchors, cumulativeRegions.length > 1 ? 'automatic' : 'local');
      const protectedPreview = cleanupResult.previewUrl;
      try {
        setNotice('Controllo che la pulizia locale non abbia alterato la stanza…');
        await verifyCleanupPreview(
          sourceUrl,
          protectedPreview,
          cumulativeRegions.map((region) => region.label).join(', '),
          cumulativeRegions,
          cleanupResult.authorizationReference,
        );
      } catch (caught) {
        if (new URLSearchParams(window.location.search).has('qa')) {
          if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
          processedBlobRef.current = protectedPreview;
          setProcessedPreview(protectedPreview);
          setProcessedLabel('Anteprima QA rifiutata');
          setShowProcessedPreview(true);
        } else {
          URL.revokeObjectURL(protectedPreview);
        }
        throw caught;
      }
      if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
      processedBlobRef.current = protectedPreview;
      cleanupHistoryRef.current = cumulativeRegions.map((region) => ({ ...region, points: region.points.map((point) => ({ ...point })) }));
      setProcessedPreview(protectedPreview); setProcessedLabel(rebuildFromOriginal ? 'Stanza vuota' : 'Pulizia locale'); setShowProcessedPreview(true); setCleanupRegion(null);
      processedSurfacesRef.current = geometryForDerivedImage(surfaces);
      setNotice(`${cleanupRegion.label} rimosso. Il risultato è stato ricostruito dalla foto originale con una maschera cumulativa; fuori dai contorni autorizzati i pixel sono rimasti identici.`);
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

  function skipEmptyRoom() {
    if (!room) return;
    if (geometryDetectionBlocked) {
      setError('Prima correggi o rifai i contorni della stanza. Con una geometria non sicura non posso applicare prodotti in modo affidabile.');
      setNotice(null);
      return;
    }
    // Skipping the optional cleanup must never be blocked by the slower
    // automatic geometry request. Give the product step a safe local base
    // immediately; Grok may refine it when its in-flight request completes.
    if (surfaces.length === 0) {
      const image = roomImageRef.current;
      const bounds = image?.naturalWidth && image.naturalHeight ? detectRoomBounds(image) : undefined;
      const guided = createGuidedSurfaces(bounds);
      originalSurfacesRef.current = guided;
      setSurfaces(guided); setPastSurfaces([]); setFutureSurfaces([]);
      setSelectedId(guided[0]?.id ?? null); setRenameDraft(guided[0]?.name ?? '');
      setGeometryDetectionStatus('fallback');
      setIsCorrectingEdges(true);
    }
    if (showProcessedPreview) showOriginalRoom();
    setCleanupRegion(null); setIsPickingCleanup(false); setDrawKind(null); setDraft([]); setShowSurfaceGuides(true); setError(null);
    shellRef.current?.classList.remove('is-moving-vertex');
    setNotice('Foto originale mantenuta. Ora puoi scegliere materiali e mobili senza svuotare la stanza.');
    setActiveStep(3);
  }

  async function createFinalRender() {
    if (!room?.previewUrl || room.sourceType !== 'photo' || isRendering) return;
    if (isClassifyingProduct) {
      setActiveStep(3); setRenderSummaryOpen(false);
      setError('Attendi il riconoscimento della foto prodotto prima di creare il render.');
      setNotice(null);
      return;
    }
    if (pendingFurniture) {
      setActiveStep(3); setRenderSummaryOpen(false);
      setError(`Prima posiziona “${pendingFurniture.name}” toccando il pavimento, oppure premi Annulla.`);
      setNotice(null);
      window.requestAnimationFrame(() => canvasRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
      return;
    }
    const frozenSurfaces = surfaces.filter((surface) => surface.frozen);
    const sourceUrl = showProcessedPreview && processedPreview ? processedPreview : room.previewUrl;
    const editableMaterialSurfaces = surfaces.filter((surface) => surface.materialId && !surface.frozen);
    const protectedSurfaces = surfaces.filter((surface) => surface.frozen
      || ((surface.kind === 'door' || surface.kind === 'window') && !surface.materialId)
      || (surface.kind === 'ceiling' && !surface.materialId));
    const materialAssignments = surfaces.filter((surface) => surface.materialId).map((surface) => {
      const assigned = materialMap.get(surface.materialId!);
      return `${surface.name}: ${assigned?.brand ? `${assigned.brand} ` : ''}${assigned?.name ?? 'materiale scelto'} (${assigned?.description ?? 'mantieni il campione selezionato'}; ${assigned ? materialReferenceLabel(assigned) : 'riferimento non disponibile'})`;
    });
    const furnitureAssignments = placedFurniture.map((item) => [
      item.name,
      item.description ? `exact product data: ${item.description}` : 'product dimensions not supplied; do not claim exact physical scale',
      `anchor at x ${Math.round(item.x * 100)}%, y ${Math.round(item.y * 100)}% of the source image`,
      `approximate visible width ${Math.round(item.scale)}%`,
      furnitureFacingInstructions[item.facing],
      `additional user yaw ${Math.round(item.rotation)} degrees relative to that wall; keep the furniture upright on the floor`,
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
      const { inputImage, mask, maskReference } = await createMaskedInput({
        editableSurfaces: editableMaterialSurfaces,
        editableFurniture: placedFurniture,
        protectedSurfaces,
        sourceUrl,
      });
      const form = new FormData();
      form.append('image', inputImage, 'render-input.jpg');
      form.append('mask', mask, 'controlled-edit-mask.png');
      form.append('maskReference', maskReference, 'controlled-edit-mask-reference.png');
      form.append('materials', materialAssignments.join('\n'));
      form.append('furniture', furnitureAssignments.join('\n'));
      form.append('requests', customRequests.join(', '));
      form.append('protectedAreas', frozenSurfaces.map((surface) => surface.name).join(', '));
      form.append('roomMeasurements', `width ${roomMeasurement.widthMeters} m; depth ${roomMeasurement.depthMeters} m; height ${roomMeasurement.heightMeters} m; confidence ${Math.round(roomMeasurement.confidence * 100)}%; reference ${roomMeasurement.referenceLabel}`);

      const furnitureWithPhoto = placedFurniture.find((item) => furnitureFilesRef.current.has(item.id));
      const originalFurnitureReference = furnitureWithPhoto ? furnitureFilesRef.current.get(furnitureWithPhoto.id) : null;
      const furnitureWithCutout = placedFurniture.find((item) => item.cutoutUrl);
      let furnitureReference: Blob | null = null;
      let furnitureReferenceName = '';
      let furnitureReferenceFilename = 'furniture-reference.png';
      if (furnitureWithCutout?.cutoutUrl) {
        const cutoutResponse = await fetch(furnitureWithCutout.cutoutUrl);
        if (!cutoutResponse.ok) throw new Error('Non riesco a rileggere il ritaglio del mobile. Ricarica la foto prodotto e riprova.');
        furnitureReference = await cutoutResponse.blob();
        furnitureReferenceName = furnitureWithCutout.name;
        furnitureReferenceFilename = 'furniture-cutout.png';
      } else if (originalFurnitureReference && furnitureWithPhoto) {
        furnitureReference = originalFurnitureReference;
        furnitureReferenceName = furnitureWithPhoto.name;
        furnitureReferenceFilename = originalFurnitureReference.name;
      }

      const referenceUrl = material?.textureUrl;
      const uploadedMaterialReference = materialAssignments.length
        && material?.referenceKind === 'uploaded-sample'
        && materialSampleRef.current
        ? materialSampleRef.current
        : null;
      if (uploadedMaterialReference) {
        form.append('materialReference', uploadedMaterialReference, 'campione-materiale.png');
      } else if (referenceUrl && materialAssignments.length) {
        form.append('imageUrl', referenceUrl);
      }
      if (materialAssignments.length) form.append('referenceType', material?.referenceKind ?? 'metadata-only');
      if (furnitureReference) {
        form.append('furnitureReference', furnitureReference, furnitureReferenceFilename);
        form.append('furnitureReferenceName', furnitureReferenceName);
      }
      if (uploadedMaterialReference && furnitureReference) {
        const combinedReference = await createCombinedRenderReference(
          uploadedMaterialReference,
          furnitureReference,
          material?.name ?? 'campione scelto',
          furnitureReferenceName || 'mobile scelto',
        );
        form.append('combinedReference', combinedReference, 'riferimenti-materiale-mobile.png');
        form.append('combinedReferenceMaterialName', material?.name ?? 'campione scelto');
      }
      const furnitureWithRemotePhoto = placedFurniture.find((item) => item.previewUrl?.startsWith('http'));
      if (!furnitureReference && furnitureWithRemotePhoto?.previewUrl) {
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
      setError(friendlyRequestError(caught).message);
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
    cleanupHistoryRef.current = [];
    setRoom({ file, kind: 'image', canPreview: true, displaySize: 'esempio incluso', projectName: 'Stanza vuota con finestra', previewUrl: '/demo-room.jpg', sourceType: 'photo' });
    setPlacedFurniture([]); setPastFurniture([]); setPendingFurniture(null); setSelectedFurnitureId(null); furnitureFilesRef.current.clear();
    setRoomRatio(16 / 10); setSurfaces(created); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(created[0].id); setRenameDraft(created[0].name); setProcessedPreview(null); setShowProcessedPreview(false); setProcessedLabel('Stanza vuota'); setError(null);
    setIsCorrectingEdges(false);
    setGeometryDetectionStatus('ai');
    setNotice('Esempio pronto: finestra, soffitto, pavimento e tre muri sono proposti e modificabili.');
    setActiveStep(2);
  }

  async function loadLocalCleaningTest() {
    setError(null); setNotice('Apro nell’app la prova reale eseguita da Grok…');
    try {
      const [originalResponse, generatedResponse, geometryResponse] = await Promise.all([
        fetch('/local-room-test-original.jpeg', { cache: 'no-store' }),
        fetch('/local-room-test-empty.jpg', { cache: 'no-store' }),
        fetch('/local-room-test-geometry.json', { cache: 'no-store' }),
      ]);
      if (!originalResponse.ok || !generatedResponse.ok || !geometryResponse.ok) throw new Error('Anteprima locale non disponibile.');
      const [originalBlob, generatedBlob] = await Promise.all([originalResponse.blob(), generatedResponse.blob()]);
      const geometry = await geometryResponse.json() as { surfaces?: DetectedSurface[] };
      const originalUrl = URL.createObjectURL(originalBlob);
      const generatedUrl = URL.createObjectURL(generatedBlob);
      const [originalImage, generatedImage] = await Promise.all([
        loadImageSource(originalUrl),
        loadImageSource(generatedUrl),
      ]);
      const stabilizedCanvas = colorStabilizedRoomLayer(
        originalImage,
        generatedImage,
        originalImage.naturalWidth,
        originalImage.naturalHeight,
      );
      const stabilizedBlob = await new Promise<Blob | null>((resolve) => stabilizedCanvas.toBlob(resolve, 'image/jpeg', .92));
      URL.revokeObjectURL(generatedUrl);
      if (!stabilizedBlob) throw new Error('Non posso correggere i colori dell’anteprima.');
      const stabilizedUrl = URL.createObjectURL(stabilizedBlob);
      if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
      if (processedBlobRef.current) URL.revokeObjectURL(processedBlobRef.current);
      roomBlobRef.current = originalUrl;
      processedBlobRef.current = stabilizedUrl;
      const file = new File([originalBlob], 'stanza-camera.jpeg', { type: 'image/jpeg' });
      const created = clientValidatedSurfaces(geometry.surfaces ?? [], 'verified');
      if (!created.length) throw new Error('La geometria verificata non è disponibile.');
      projectIdRef.current = crypto.randomUUID();
      originalSurfacesRef.current = created;
      processedSurfacesRef.current = created;
      cleanupHistoryRef.current = [];
      setRoom({ file, kind: 'image', canPreview: true, displaySize: formatBytes(originalBlob.size), projectName: 'Prova stanza ripulita', previewUrl: originalUrl, sourceType: 'photo' });
      setRoomRatio(originalImage.naturalWidth / originalImage.naturalHeight);
      setSurfaces(created); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(created[0].id); setRenameDraft(created[0].name);
      setPlacedFurniture([]); setPastFurniture([]); setPendingFurniture(null); setSelectedFurnitureId(null); furnitureFilesRef.current.clear();
      setProcessedPreview(stabilizedUrl); setProcessedLabel('Stanza vuota'); setShowProcessedPreview(true);
      setCleanupRegion(null); setIsPickingCleanup(false); setIsCorrectingEdges(false);
      autoFitPreviewRef.current = originalUrl;
      setNotice('Risultato Grok aperto dentro Materia. I colori sono riallineati automaticamente alla foto originale.');
      setActiveStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non riesco ad aprire la prova locale.');
      setNotice(null);
    }
  }

  function goToStep(step: number) {
    if (step > 1 && !room) return;
    if (step > 2 && surfaces.length === 0) {
      setNotice('Prima crea o disegna almeno una superficie.');
      return;
    }
    if (step > 2 && geometryDetectionBlocked) {
      setActiveStep(2); setRenderSummaryOpen(false);
      setError('Pareti o aperture non hanno ancora confini sicuri. Correggi le linee oppure riprova il riconoscimento prima di usare prodotti e render.');
      setNotice(null);
      return;
    }
    if (isClassifyingProduct && step !== 3) {
      setActiveStep(3); setRenderSummaryOpen(false);
      setError('Attendi il riconoscimento della foto prodotto prima di cambiare passaggio.');
      setNotice(null);
      return;
    }
    if (step === 4 && pendingFurniture) {
      setActiveStep(3); setRenderSummaryOpen(false);
      setError(`Prima posiziona “${pendingFurniture.name}” toccando il pavimento, oppure premi Annulla.`);
      setNotice(null);
      window.requestAnimationFrame(() => canvasRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
      return;
    }
    if (step < 3 && pendingFurniture) {
      setPendingFurniture(null);
      setNotice('Inserimento del mobile annullato.');
    }
    if (step !== 2 && step !== 3) {
      if (geometryDragRef.current) finishGeometryDrag(geometryDragRef.current.pointerId);
      setIsCorrectingEdges(false);
      setDragVertex(null);
      setDragEdge(null);
      shellRef.current?.classList.remove('is-moving-vertex');
    }
    if (step === 2 || step === 3) setShowSurfaceGuides(true);
    setError(null);
    setActiveStep(step);
    if (step === 4) setRenderSummaryOpen(true);
  }

  const activeDrawingLabel = drawKind === 'door' && manualOpeningMode === 'arch'
    ? 'Arco'
    : drawKind ? surfaceLabels[drawKind] : '';
  const aiServicesDescription = aiServiceLabels.length
    ? aiServiceLabels.join(' · ')
    : aiProviderLabel ?? 'Servizi IA';
  const aiStatusLabel = aiStatus === 'ready'
    ? aiServiceLabels.length >= 3 ? `${aiServiceLabels.length} IA attive` : `${aiProviderLabel ?? 'IA'} attiva`
    : aiStatus === 'checking' ? 'Verifica IA'
      : isLocalPreview() ? 'Anteprima locale · IA online' : 'IA non raggiungibile';

  return (
    <main ref={shellRef} className={`app-shell simple-mode step-${activeStep} ${(activeStep === 2 && (drawKind || selected)) || (activeStep === 3 && isCorrectingEdges && selected) ? 'has-mobile-surface-actions' : ''}`}>
      <header className="topbar">
        <a href="/projects" className="brand-lockup" aria-label="Vai ai progetti"><div className="brand-mark" aria-hidden="true"><span /><span /></div><div><p className="eyebrow">Studio materiali</p><p className="brand-name">Materia</p></div></a>
        <div className="project-heading"><span className="status-dot" /><div><p>{projectName}</p><span>{room ? `${room.sourceType === 'floorplan' ? 'Planimetria' : 'Foto'} · originale protetto` : 'Nuovo progetto locale'}</span></div></div>
        <div className="top-actions"><span className={`ai-status ${aiStatus}`} title={aiServicesDescription} aria-label={`${aiStatusLabel}: ${aiServicesDescription}`}><i />{aiStatusLabel}</span><button className="avatar" type="button" aria-label="Profilo locale">AG</button></div>
      </header>

      <nav className="simple-steps" aria-label="Passaggi del progetto">{[
        ['1', 'Foto'], ['2', 'Prepara'], ['3', 'Prodotti'], ['4', 'Render'],
      ].map(([number, label], index) => <button type="button" key={number} className={activeStep === index + 1 ? 'is-active' : activeStep > index + 1 ? 'is-done' : ''} onClick={() => goToStep(index + 1)} disabled={(index > 0 && !room) || (index > 1 && (surfaces.length === 0 || geometryDetectionBlocked))}><span>{activeStep > index + 1 ? '✓' : number}</span><strong>{label}</strong></button>)}</nav>

      <div className="workspace">
        <aside className="surface-panel" aria-label="Superfici della stanza">
          <div className="panel-heading"><div><p className="eyebrow">Aree riconosciute</p><h2>Tocca cosa vuoi mantenere</h2></div><span className="count-badge">{surfaces.length}</span></div>
          <button className="detect-button" type="button" onClick={() => void autoFitSurfaces()} disabled={!room || room.sourceType !== 'photo' || isAutoFitting || showProcessedPreview}><span className="spark">✦</span>{isAutoFitting ? 'Sto adattando…' : 'Adatta automaticamente'}<span className="soon">Foto</span></button>
          {surfaces.length ? <div className="surface-list">{surfaces.map((surface) => <button className={`surface-item ${surface.id === selectedId ? 'is-active' : ''}`} key={surface.id} type="button" onClick={() => { setSelectedId(surface.id); setRenameDraft(surface.name); setDrawKind(null); setQuickDraw(false); setDraft([]); setShowSurfaceGuides(true); }}><span className="surface-swatch" style={{ background: kindColors[surface.kind] }} /><span className="surface-copy"><strong>{surface.name}</strong><small>{surface.frozen ? 'Freeze attivo' : surface.materialId ? 'Prodotto applicato' : 'Tocca per selezionare'}</small></span><span className="lock-state" aria-label={surface.frozen ? 'Bloccata' : 'Modificabile'}>{surface.frozen ? '🔒' : '◇'}</span></button>)}</div> : <div className="surface-empty"><span>✦</span><strong>Riconoscimento automatico</strong><p>L’app divide la foto in pavimento, muri e soffitto.</p></div>}
          {selected && activeStep === 2 && <div className="simple-freeze-actions"><button type="button" className={selected.frozen ? 'is-frozen' : ''} onClick={toggleFreeze}>{selected.frozen ? `Consenti modifiche a ${selected.name}` : `Mantieni identico ${selected.name}`}</button><button type="button" onClick={freezeAllExceptSelected}>Mantieni tutto tranne questa</button><p>Freeze significa: questa zona non viene rigenerata dall’IA.</p></div>}
          <div className="panel-note"><span>i</span><p>Automatico per iniziare, manuale per rifinire: trascina i pallini direttamente sui bordi della foto.</p></div>
        </aside>

        <section className="stage" aria-labelledby="editor-title">
          <div className="editor-toolbar">
            <div className="tool-group"><button className={`tool-button ${!drawKind ? 'is-selected' : ''}`} type="button" onClick={cancelDrawing} aria-label="Seleziona">↖</button><button className="tool-button history-button" type="button" onClick={undo} disabled={!pastSurfaces.length} aria-label="Annulla ultima modifica">↶</button><button className="tool-button history-button" type="button" onClick={redo} disabled={!futureSurfaces.length} aria-label="Ripristina modifica">↷</button>{room?.sourceType === 'photo' && <button className="draw-button auto-fit-button" type="button" onClick={() => void autoFitSurfaces()} disabled={!room || isAutoFitting || showProcessedPreview}>✦ {isAutoFitting ? 'Adatto…' : 'Adatta alla foto'}</button>}{room?.sourceType === 'floorplan' ? <button className={`draw-button easy-draw-button ${lineWallDraw ? 'is-selected' : ''}`} type="button" onClick={startFloorplanWall}>＋ Parete con 2 tocchi</button> : <button className={`draw-button easy-draw-button ${quickDraw ? 'is-selected' : ''}`} type="button" onClick={() => startDrawing('wall', true)} disabled={!room}>＋ Aggiungi muro</button>}</div>
            {drawKind ? <div className="drawing-actions"><span>{lineWallDraw ? `${draft.length}/2 punti` : manualOpeningMode === 'arch' ? `${draft.length} punti · minimo 5` : `${draft.length}/4 angoli`}</span><button type="button" onClick={cancelDrawing}>Annulla</button></div> : <span className="mode-label">{selected ? `Trascina i pallini di ${selected.name}` : room?.sourceType === 'floorplan' ? 'Aggiungi le pareti interne con due tocchi' : room ? 'Adatta automaticamente o trascina i pallini a mano' : 'Carica una foto o una planimetria per iniziare'}</span>}
          </div>

          <div className="canvas-wrap">
            {activeStep === 3 && selectedFurniture && <div className="furniture-pencil-toolbar" role="group" aria-label="Comandi Apple Pencil per il mobile">
              <div className="furniture-pencil-heading">
                <div><strong>{selectedFurniture.name}</strong><span>Tastiera semplice · tocca un comando</span></div>
                <div className="furniture-pencil-heading-actions">
                  <button type="button" className={`pencil-auto-size ${selectedFurniture.autoScale ? 'is-active' : ''}`} aria-label={`Misura automatica per ${selectedFurniture.name}`} onClick={restoreAutomaticFurnitureScale} disabled={selectedFurniture.frozen || selectedFurniture.autoScale}>{selectedFurniture.autoScale ? `✓ AUTO ${Math.round(selectedFurniture.scale)}%` : '◎ AUTO'}</button>
                  <button type="button" className="pencil-undo" aria-label="Torna indietro di una modifica del mobile" onClick={undoFurnitureChange} disabled={!pastFurniture.length || isPreparingFurniture}>↶ Indietro</button>
                  <button type="button" className={`pencil-freeze ${selectedFurniture.frozen ? 'is-active' : ''}`} aria-label={selectedFurniture.frozen ? `Sblocca ${selectedFurniture.name}` : `Blocca ${selectedFurniture.name}`} onClick={() => updateSelectedFurniture({ frozen: !selectedFurniture.frozen })}>{selectedFurniture.frozen ? '◇' : '◆'}</button>
                  <button type="button" className="pencil-delete" aria-label={`Elimina ${selectedFurniture.name}`} onClick={removeSelectedFurniture} disabled={selectedFurniture.frozen || isPreparingFurniture}>⌫ Cancella</button>
                </div>
              </div>
              <div className="furniture-pencil-walls" role="group" aria-label="Scegli il muro del mobile">
                {(Object.keys(furnitureFacingLabels) as FurnitureFacing[]).map((facing) => <button type="button" key={facing} aria-label={`Orienta ${selectedFurniture.name}: ${furnitureFacingLabels[facing]}`} className={selectedFurniture.facing === facing ? 'is-active' : ''} onClick={() => void orientSelectedFurniture(facing)} disabled={selectedFurniture.frozen || isPreparingFurniture}>{isPreparingFurniture && selectedFurniture.facing === facing ? 'Creo vista…' : facing === 'front-wall' ? '↑ FRONTE' : facing === 'left-wall' ? '↙ MURO SX' : 'MURO DX ↘'}</button>)}
              </div>
              <div className="furniture-pencil-actions">
                <button type="button" aria-label={`Ruota ${selectedFurniture.name} a sinistra`} onClick={() => rotateSelectedFurniture(-10)} disabled={selectedFurniture.frozen}>↶ <small>RUOTA SX</small></button>
                <button type="button" aria-label={`Sposta ${selectedFurniture.name} in alto`} onClick={() => nudgeSelectedFurniture(0, -.04)} disabled={selectedFurniture.frozen}>↑ <small>SU</small></button>
                <button type="button" aria-label={`Ruota ${selectedFurniture.name} a destra`} onClick={() => rotateSelectedFurniture(10)} disabled={selectedFurniture.frozen}>↷ <small>RUOTA DX</small></button>
                <button type="button" aria-label={`Sposta ${selectedFurniture.name} a sinistra`} onClick={() => nudgeSelectedFurniture(-.04, 0)} disabled={selectedFurniture.frozen}>← <small>SINISTRA</small></button>
                <button type="button" className="straight-button" aria-label={`Raddrizza ${selectedFurniture.name}`} onClick={straightenSelectedFurniture} disabled={selectedFurniture.frozen}>0° <small>DRITTO</small></button>
                <button type="button" aria-label={`Sposta ${selectedFurniture.name} a destra`} onClick={() => nudgeSelectedFurniture(.04, 0)} disabled={selectedFurniture.frozen}>→ <small>DESTRA</small></button>
                <button type="button" className="pencil-size-button" aria-label={`Rimpicciolisci ${selectedFurniture.name}`} onClick={() => resizeSelectedFurniture(-6)} disabled={selectedFurniture.frozen}>− <small>PICCOLO</small></button>
                <button type="button" aria-label={`Sposta ${selectedFurniture.name} in basso`} onClick={() => nudgeSelectedFurniture(0, .04)} disabled={selectedFurniture.frozen}>↓ <small>GIÙ</small></button>
                <button type="button" className="pencil-size-button" aria-label={`Ingrandisci ${selectedFurniture.name}`} onClick={() => resizeSelectedFurniture(6)} disabled={selectedFurniture.frozen}>＋ <small>GRANDE</small></button>
              </div>
            </div>}
            <div ref={canvasRef} className={`canvas ${isDraggingFile ? 'is-dragging' : ''} ${pendingFurniture ? 'is-placing-furniture' : ''} ${isPickingCleanup ? 'is-picking-cleanup' : ''}`} id="editor-title" style={room ? { aspectRatio: roomRatio } : undefined} onClick={handleCanvasClick} onDragEnter={() => setIsDraggingFile(true)} onDragLeave={() => setIsDraggingFile(false)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            {room?.previewUrl ? <div className="editor-media">
              <img ref={roomImageRef} src={showProcessedPreview && processedPreview ? processedPreview : room.previewUrl} alt={showProcessedPreview ? `Anteprima elaborata: ${processedLabel}` : `Originale importato: ${room.file.name}`} onLoad={(event) => onRoomImageLoad(event.currentTarget)} />
              <svg ref={surfaceOverlayRef} className={`surface-overlay ${drawKind ? 'is-drawing' : ''} ${isCorrectingEdges ? 'is-correcting' : ''} ${isPickingCleanup ? 'is-cleanup-picking' : ''} ${!showSurfaceGuides ? 'hide-product-guides' : ''}`} viewBox="0 0 1000 625" preserveAspectRatio="none" onPointerDown={addDraftPoint} onPointerMove={handleGeometryPointerMove} onPointerUp={handleGeometryPointerEnd} onPointerCancel={handleGeometryPointerEnd} onLostPointerCapture={handleGeometryPointerEnd}>
                <defs>
                  {catalogMaterials.filter((item) => item.pattern).map((item) => <pattern id={`catalog-material-${item.id}`} key={item.id} width={item.pattern === 'wood' ? 180 : 120} height={item.pattern === 'wood' ? 42 : 120} patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill={item.color} /><path d={item.pattern === 'wood' ? 'M0 2H180 M0 40H180 M45 2V40 M135 2V40' : 'M0 1H120 M1 0V120'} stroke="rgba(67,55,43,.22)" strokeWidth="3" /><path d={item.pattern === 'stone' ? 'M8 38 C38 17 64 55 110 25 M14 92 C45 68 77 106 116 74' : ''} fill="none" stroke="rgba(255,255,255,.24)" strokeWidth="5" /></pattern>)}
                  {material?.previewUrl && <pattern id={`uploaded-material-${material.id}`} width="140" height="140" patternUnits="userSpaceOnUse"><image href={material.previewUrl} width="140" height="140" preserveAspectRatio="xMidYMid slice" /></pattern>}
                </defs>
                {surfaces.map((surface) => {
                  const labelPoint = surfaceLabelPoint(surface);
                  const showLabel = surface.kind === 'window' || surface.kind === 'door';
                  const inferredOpening = surface.thresholdInferred && surface.kind === 'door' && surface.points.length > 4;
                  const verifiedOpeningCurve = inferredOpening ? surface.points.slice(0, -2) : [];
                  const inferredOpeningEdges = inferredOpening
                    ? [verifiedOpeningCurve.at(-1), ...surface.points.slice(-2), verifiedOpeningCurve[0]].filter((point): point is Point => Boolean(point))
                    : [];
                  return <g key={surface.id} data-parent-id={surface.parentId} data-source={surface.source} data-threshold={inferredOpening ? 'inferred' : 'verified'} className={`surface-kind-${surface.kind} ${surface.frozen ? 'is-frozen ' : ''}${surface.id === selectedId ? 'is-selected-surface' : ''}`}><polygon aria-label={`Contorno ${surface.name}`} points={pointsToSvg(surface.points)} fill={materialFill(surface)} stroke={inferredOpening ? 'transparent' : surface.id === selectedId ? '#d7f05c' : kindColors[surface.kind]} strokeWidth={surface.id === selectedId ? 6 : 3} vectorEffect="non-scaling-stroke" onPointerDown={(event) => { if (!drawKind) { event.stopPropagation(); setSelectedId(surface.id); setRenameDraft(surface.name); setQuickDraw(false); } }} />{inferredOpening && <><polyline className="surface-opening-verified" points={pointsToSvg(verifiedOpeningCurve)} vectorEffect="non-scaling-stroke" /><polyline className="surface-opening-inferred" points={pointsToSvg(inferredOpeningEdges)} vectorEffect="non-scaling-stroke" /></>}{showLabel && <text className="surface-name" x={labelPoint.x * 1000} y={labelPoint.y * 625}>{surface.name}{inferredOpening ? ' · verifica soglia' : ''}</text>}</g>;
                })}
                {isCorrectingEdges && selected && !selected.frozen && <g className="surface-correction-controls" data-surface-id={selected.id}>
                  {selected.points.map((point, index) => { const next = selected.points[(index + 1) % selected.points.length]; return <g className="surface-edge-control" key={`${selected.id}-edge-${index}`}><line x1={point.x * 1000} y1={point.y * 625} x2={next.x * 1000} y2={next.y * 625} className="surface-edge" vectorEffect="non-scaling-stroke" aria-hidden="true" /><line x1={point.x * 1000} y1={point.y * 625} x2={next.x * 1000} y2={next.y * 625} className="surface-edge-hit" vectorEffect="non-scaling-stroke" aria-label={`Sposta linea ${index + 1} di ${selected.name}`} onPointerDown={(event) => beginEdgeDrag(event, selected.id, index)} /></g>; })}
                  {selected.points.map((point, index) => {
                    const next = selected.points[(index + 1) % selected.points.length];
                    const edgeLength = Math.hypot((next.x - point.x) * canvasCssSize.width, (next.y - point.y) * canvasCssSize.height);
                    if (edgeLength < 28) return null;
                    const midpointX = (point.x + next.x) * 500; const midpointY = (point.y + next.y) * 312.5;
                    return <circle key={`${selected.id}-midpoint-${index}`} cx={midpointX} cy={midpointY} r="13" className="surface-edge-grip" aria-hidden="true" onPointerDown={(event) => beginMidpointDrag(event, selected.id, index)} />;
                  })}
                  {selected.points.map((point, index) => <g key={`${selected.id}-vertex-${index}`}><circle cx={point.x * 1000} cy={point.y * 625} r="34" className="surface-vertex-hit" aria-label={`Sposta punto ${index + 1} di ${selected.name}`} onPointerDown={(event) => beginVertexDrag(event, selected.id, index)} /><circle cx={point.x * 1000} cy={point.y * 625} r="16" className="surface-vertex" aria-hidden="true" /></g>)}
                </g>}
                {draft.length > 0 && <><polyline points={pointsToSvg(draft)} fill="none" stroke="#d7f05c" strokeWidth="5" vectorEffect="non-scaling-stroke" />{draft.map((point, index) => <circle key={index} cx={point.x * 1000} cy={point.y * 625} r="9" className="draft-vertex" />)}</>}
                {cleanupRegion && <polygon className="cleanup-region" points={pointsToSvg(cleanupRegion.points)} aria-label={`Zona da pulire: ${cleanupRegion.label}`} />}
              </svg>
              {isCorrectingEdges && selected && !selected.frozen && <div className="surface-correction-hit-layer" aria-label={`Controlli linee di ${selected.name}`}>
                {selected.points.map((point, index) => {
                  const next = selected.points[(index + 1) % selected.points.length];
                  const edgeLength = Math.hypot((next.x - point.x) * canvasCssSize.width, (next.y - point.y) * canvasCssSize.height);
                  if (edgeLength < 28) return null;
                  const hitSize = Math.min(56, Math.max(24, edgeLength - 2));
                  const hitInset = Math.max(0, hitSize / 2 - 2);
                  return <button
                    key={`${selected.id}-midpoint-hit-${index}`}
                    type="button"
                    className="surface-edge-grip-hit"
                    data-testid={`edge-grip-hit-${index}`}
                    style={{
                      width: `${hitSize}px`, height: `${hitSize}px`,
                      left: `clamp(${hitInset}px, ${((point.x + next.x) / 2) * 100}%, calc(100% - ${hitInset}px))`,
                      top: `clamp(${hitInset}px, ${((point.y + next.y) / 2) * 100}%, calc(100% - ${hitInset}px))`,
                      touchAction: 'none',
                    }}
                    aria-label={`Crea e sposta un nuovo punto sulla linea ${index + 1} di ${selected.name}`}
                    onPointerDown={(event) => beginMidpointDrag(event, selected.id, index)}
                    onPointerMove={handleGeometryPointerMove}
                    onPointerUp={handleGeometryPointerEnd}
                    onPointerCancel={handleGeometryPointerEnd}
                    onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                  />;
                })}
              </div>}
              {activeStep === 3 && <div className="furniture-placement-layer" aria-label="Mobili posizionati">{placedFurniture.map((item) => {
                const preparedView = item.preparedViews?.[item.facing];
                const usesSideAsset = !preparedView && item.facing !== 'front-wall' && Boolean(item.sidePreviewUrl);
                const imageUrl = preparedView ?? (usesSideAsset ? item.sidePreviewUrl : item.cutoutUrl ?? item.previewUrl);
                const hasPerspectiveView = Boolean(preparedView || usesSideAsset);
                return <button key={item.id} type="button" className={`placed-furniture facing-${item.facing} ${hasPerspectiveView ? 'has-perspective-view' : ''} ${usesSideAsset ? 'has-side-preview' : ''} ${selectedFurnitureId === item.id ? 'is-selected' : ''} ${item.frozen ? 'is-frozen' : ''}`} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.scale}%`, transform: item.rotation ? `translate(-50%,-100%) rotate(${item.rotation}deg)` : 'translate(-50%,-100%)' }} aria-label={`Sposta ${item.name}`} onClick={(event) => { event.stopPropagation(); selectFurnitureForEditing(item); }} onPointerDown={(event) => beginFurnitureDrag(event, item.id)} onPointerMove={moveFurniture} onPointerUp={endFurnitureDrag} onPointerCancel={endFurnitureDrag}>{imageUrl ? <img src={imageUrl} alt="" /> : <span className="placed-furniture-placeholder">▰</span>}<strong>{item.name}</strong><span className="furniture-facing-badge">{furnitureFacingLabels[item.facing]}</span><i aria-hidden="true" /></button>;
              })}</div>}
              {activeStep === 3 && pendingFurniture && <div className="placement-hint" role="status"><strong>Tocca il punto sul pavimento</strong><span>“{pendingFurniture.name}” verrà agganciato automaticamente al muro frontale.</span><div><button type="button" onClick={(event) => { event.stopPropagation(); setPendingFurniture(null); setError(null); setNotice('Sei tornato alla scelta dei prodotti.'); document.querySelector('.product-search-section')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }}>← Torna ai prodotti</button><button type="button" className="cancel-placement" aria-label="Annulla" onClick={(event) => { event.stopPropagation(); setPendingFurniture(null); setError(null); setNotice('Inserimento mobile annullato.'); }}>✕ Annulla</button></div></div>}
              <div className="import-status"><span className="status-dot" /><div><strong>{showProcessedPreview ? processedLabel : 'Originale intatto'}</strong><small>{showProcessedPreview ? 'Elaborazione IA · originale sempre disponibile' : importedCaption}</small></div></div>
              <button className="replace-button" type="button" onClick={() => roomInputRef.current?.click()}>↑ Carica la tua foto</button>
              {processedPreview && <div className="before-after-toggle" aria-label="Confronta originale e risultato"><button type="button" className={!showProcessedPreview ? 'is-active' : ''} onClick={showOriginalRoom}>Originale</button><button type="button" className={showProcessedPreview ? 'is-active' : ''} onClick={showProcessedRoom}>{processedLabel}</button></div>}
            </div> : <><div className="room-demo" aria-label="Anteprima schematica della stanza"><div className="room-ceiling"><span>Soffitto</span></div><div className="room-wall left"><span>Muro 2</span></div><div className="room-wall center"><span>Muro 1</span></div><div className="room-wall right"><span>Muro 3</span></div><div className="room-floor"><span>Pavimento</span></div></div><div className="upload-card"><div className="upload-icon">↑</div><p className="eyebrow">Inizia da ciò che hai</p><h1>Cosa vuoi caricare?</h1><p>Scegli una foto della stanza oppure una planimetria. L’originale resterà sempre intatto.</p><div className="source-actions"><label className="source-card is-primary" htmlFor="room-file"><span>▣</span><strong>Libreria foto</strong><small>Scegli una foto già presente su iPhone o iPad</small></label><label className="source-card" htmlFor="camera-file"><span>●</span><strong>Scatta foto</strong><small>Usa direttamente la fotocamera posteriore</small></label><label className="source-card" htmlFor="floorplan-file"><span>⌗</span><strong>Planimetria</strong><small>Crea automaticamente la stanza vuota</small></label></div>{localCleaningTestAvailable && <button className="demo-button" type="button" onClick={() => void loadLocalCleaningTest()}>Apri questa prova dentro Materia</button>}<button className="demo-button" type="button" onClick={loadDemoRoom}>Prova con la stanza esempio</button><small>JPG, PNG, WEBP o HEIC · massimo 20 MB</small></div></>}
            {isDraggingFile && <div className="drop-overlay"><strong>Rilascia per importare</strong><span>La foto resterà nel browser.</span></div>}
            {(isImportingRoom || isCreatingFloorplanRoom) && <div className="processing-overlay" role="status"><span className="processing-spinner" /><strong>{isCreatingFloorplanRoom ? 'Creo la stanza dalla planimetria…' : 'Preparo la foto…'}</strong><small>{isCreatingFloorplanRoom ? 'Riconosco pareti, porte e finestre. Può richiedere circa un minuto.' : 'Le immagini grandi vengono ottimizzate per evitare blocchi.'}</small></div>}
          </div>{error && <div className="file-error" role="alert"><strong>Operazione non completata</strong><span>{error}</span>{activeStep === 4 && <button className="file-error-retry" type="button" onClick={() => void createFinalRender()} disabled={isRendering}>{isRendering ? 'Riprovo…' : 'Riprova render'}</button>}<button className="file-error-close" type="button" onClick={() => setError(null)} aria-label="Chiudi errore">×</button></div>}</div>
          <input ref={roomInputRef} id="room-file" className="visually-hidden" type="file" accept="image/*,.heic,.heif,.webp" onChange={onRoomInput} /><input ref={cameraInputRef} id="camera-file" className="visually-hidden" type="file" accept="image/jpeg,image/png" capture="environment" onChange={onRoomInput} /><input ref={floorplanInputRef} id="floorplan-file" className="visually-hidden" type="file" accept="image/*,.heic,.heif,.webp" onChange={onFloorplanInput} /><input ref={materialInputRef} id="material-file" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={onMaterialInput} /><input ref={furnitureInputRef} id="furniture-file" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={onFurnitureInput} />
          {room?.sourceType === 'photo' && activeStep === 2 && <section className="empty-room-choice" aria-label="Svuota la stanza oppure continua"><div><strong>Vuoi svuotare la stanza?</strong><span>È facoltativo: puoi mantenere la foto originale e andare subito ai prodotti.</span></div><div className="empty-room-actions"><button className="skip-empty-room" type="button" onClick={skipEmptyRoom} disabled={isEmptyingRoom || isCleaningRegion || geometryDetectionBlocked}>Salta · usa foto originale →</button><button className="empty-room-button" type="button" onClick={() => void emptyRoom()} disabled={isEmptyingRoom || isCleaningRegion || geometryDetectionBlocked}>{isEmptyingRoom ? 'Svuoto la stanza…' : processedLabel === 'Stanza vuota' && processedPreview ? '↻ Rigenera stanza vuota' : '⌂ Svuota la stanza'}</button>{!cleanupRegion && <button type="button" className={isPickingCleanup ? 'is-active' : ''} onClick={() => { setIsPickingCleanup((current) => !current); setError(null); setNotice(isPickingCleanup ? 'Selezione annullata.' : processedPreview ? 'Tocca il centro dell’oggetto rimasto nella foto.' : 'Tocca il centro di un mobile nella foto: lo delimito e lo rimuovo.'); }} disabled={isDetectingCleanup || isCleaningRegion}>{isDetectingCleanup ? 'Riconosco…' : isPickingCleanup ? 'Annulla selezione' : processedPreview ? '◎ Pulisci un residuo' : '◎ Indica un mobile'}</button>}{cleanupRegion && <><button type="button" className="cleanup-confirm" onClick={() => void cleanResidualRegion()} disabled={isCleaningRegion}>{isCleaningRegion ? 'Pulisco…' : 'Pulisci selezione'}</button><button type="button" onClick={() => setCleanupRegion(null)} disabled={isCleaningRegion}>Annulla</button></>}</div></section>}
          {geometryDetectionStatus === 'fallback' && room?.sourceType === 'photo' && (activeStep === 2 || activeStep === 3) && <div className="geometry-fallback-warning" role="status"><div><strong>Contorni provvisori</strong><span>Il riconoscimento IA di questa foto non è riuscito. Non li presento come misure automatiche: correggili trascinando linee o pallini, oppure riprova.</span></div><button type="button" onClick={() => void autoFitSurfaces()} disabled={isAutoFitting || showProcessedPreview}>{isAutoFitting ? 'Riconosco…' : '✦ Riprova IA'}</button></div>}
          {geometryHasOpeningIssue && room?.sourceType === 'photo' && (activeStep === 2 || activeStep === 3) && <div className="geometry-fallback-warning opening-invalid-warning" role="alert"><div><strong>Apertura non sicura</strong><span>La curva è visibile, ma soglia o stipiti sono ricostruiti dietro mobili: le parti arancioni tratteggiate richiedono conferma. Se coincidono, seleziona l’arco e conferma; altrimenti sposta i punti.</span></div><button type="button" onClick={() => void autoFitSurfaces()} disabled={isAutoFitting || showProcessedPreview}>{isAutoFitting ? 'Riconosco…' : '✦ Riprova IA'}</button></div>}
          {geometryHasShellIssue && room?.sourceType === 'photo' && (activeStep === 2 || activeStep === 3) && <div className="geometry-fallback-warning opening-invalid-warning" role="alert"><div><strong>Geometria stanza non sicura</strong><span>I confini tra muri, soffitto e pavimento non coincidono oppure seguono gli arredi. Misure, prodotti e svuotamento restano bloccati finché non rifai o correggi i contorni.</span></div><button type="button" onClick={() => void autoFitSurfaces()} disabled={isAutoFitting || showProcessedPreview}>{isAutoFitting ? 'Riconosco…' : '✦ Riprova IA'}</button></div>}
          <div className={`status-bar ${activeStep === 2 ? 'prepare-status' : ''}`}><span className="status-icon">{notice ? '✓' : 'i'}</span><p>{notice ?? 'Carica la foto, scegli cosa mantenere e poi cerca il prodotto.'}</p>{drawKind && <button className="opening-undo-inline" type="button" onClick={undoDraftPoint} disabled={draft.length === 0}>↶ Ultimo punto</button>}{drawKind && !quickDraw && <button className="opening-confirm-inline" type="button" onClick={() => completeSurface(draft, drawKind)} disabled={draft.length < (manualOpeningMode === 'arch' ? 5 : 3)}>✓ Conferma {activeDrawingLabel.toLowerCase()}</button>}{room && (activeStep === 2 || activeStep === 3) && !drawKind && <button className={`edge-edit-button ${isCorrectingEdges ? 'is-active' : ''}`} type="button" onClick={toggleEdgeCorrection}>{isCorrectingEdges ? '✓ Fine correzione' : activeStep === 3 ? '↔ Sposta linee' : room.sourceType === 'floorplan' ? 'Correggi il perimetro' : 'Correggi i bordi'}</button>}{room?.sourceType === 'photo' && activeStep === 2 && <><button className={`opening-draw-button ${drawKind === 'door' && manualOpeningMode !== 'arch' ? 'is-active' : ''}`} type="button" onClick={() => drawKind === 'door' && manualOpeningMode !== 'arch' ? cancelDrawing() : startDrawing('door', true, 'rectangle')}>{drawKind === 'door' && manualOpeningMode !== 'arch' ? '✕ Cancella porta' : '＋ Porta'}</button><button className={`opening-draw-button ${drawKind === 'door' && manualOpeningMode === 'arch' ? 'is-active' : ''}`} type="button" onClick={() => drawKind === 'door' && manualOpeningMode === 'arch' ? cancelDrawing() : startDrawing('door', false, 'arch')}>{drawKind === 'door' && manualOpeningMode === 'arch' ? '✕ Cancella arco' : '＋ Arco'}</button><button className={`opening-draw-button ${drawKind === 'window' ? 'is-active' : ''}`} type="button" onClick={() => drawKind === 'window' ? cancelDrawing() : startDrawing('window', true, 'rectangle')}>{drawKind === 'window' ? '✕ Cancella finestra' : '＋ Finestra'}</button></>}{activeStep === 2 && !drawKind && selected?.kind === 'door' && selected.thresholdInferred && <button className="opening-confirm-inline" type="button" onClick={confirmInferredOpeningThreshold}>✓ Conferma soglia stimata</button>}{activeStep === 2 && !drawKind && selected && (selected.kind === 'door' || selected.kind === 'window') && <button className="opening-delete-inline" type="button" onClick={deleteSelected} disabled={selected.frozen}>⌫ Elimina {selected.name}</button>}{room?.sourceType === 'floorplan' && activeStep === 2 && !drawKind && <button type="button" onClick={startFloorplanWall}>Aggiungi parete interna</button>}{room && surfaces.length > 0 && activeStep === 4 && <button className="render-flow-button" type="button" aria-label="Prova flusso render" onClick={() => setRenderSummaryOpen(true)} disabled={geometryDetectionBlocked}>Controlla e crea render</button>}{activeStep === 2 && surfaces.length > 0 && !drawKind && <button className="continue-products-button" type="button" onClick={() => goToStep(3)} disabled={geometryDetectionBlocked}>Continua ai prodotti</button>}{activeStep === 3 && <button className="render-flow-button" type="button" aria-label="Prova flusso render" onClick={() => goToStep(4)} disabled={geometryDetectionBlocked}>Continua: crea render</button>}</div>
        </section>

        <aside className="properties-panel" aria-label="Proprietà">
          <div className="panel-heading"><div><p className="eyebrow">Controlli</p><h2>{selected?.name ?? (room ? 'Nessuna selezione' : 'Importa una stanza')}</h2></div>{selected && <span className="type-badge">{surfaceLabels[selected.kind]}</span>}</div>
          {room && <div className="asset-card"><span>{room.sourceType === 'floorplan' ? 'PLAN' : 'IMG'}</span><div><strong>{room.file.name}</strong><small>{room.sourceType === 'floorplan' ? 'Planimetria originale' : importedCaption}</small></div><label htmlFor={room.sourceType === 'floorplan' ? 'floorplan-file' : 'room-file'}>Sostituisci</label></div>}
          {selected ? <><div className="property-section"><div className="property-title"><span>Nome superficie</span><span className="editable-badge">Personalizzabile</span></div><div className="rename-control"><input aria-label="Nome superficie" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} /><button type="button" onClick={renameSelected} disabled={!renameDraft.trim() || renameDraft.trim() === selected.name}>Salva</button></div></div><div className="property-section"><div className="property-title"><span>Protezione superficie</span><span className={`editable-badge ${selected.frozen ? 'frozen' : ''}`}>{selected.frozen ? 'Frozen' : 'Modificabile'}</span></div><button className={`freeze-button ${selected.frozen ? 'is-active' : ''}`} type="button" aria-label={selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'} onClick={toggleFreeze}><span>{selected.frozen ? '◆' : '◇'}</span>{selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'}<small>{selected.frozen ? 'Protetta' : 'Attivo subito'}</small></button><button className="freeze-others-button" type="button" onClick={freezeAllExceptSelected}>Blocca tutto tranne {selected.name}</button></div>
            <div className="property-section product-search-section">
              {activeStep === 3 && !geometryDetectionBlocked && <div className="room-measurement-card">
                <div className="room-measurement-heading"><div><span>{manualRoomWidth ? 'Confermate' : 'Automatiche'}</span><strong>Misure della stanza</strong></div><b>{Math.round(roomMeasurement.confidence * 100)}% affidabile</b></div>
                <div className="room-measurement-values"><div><span>Larghezza</span><strong>{roomMeasurement.widthMeters.toLocaleString('it-IT')} m</strong></div><div><span>Profondità</span><strong>{roomMeasurement.depthMeters.toLocaleString('it-IT')} m</strong></div><div><span>Altezza</span><strong>{roomMeasurement.heightMeters.toLocaleString('it-IT')} m</strong></div></div>
                <p>Calcolate da {roomMeasurement.referenceLabel}. I mobili con dimensioni trovate nel prodotto cambiano scala automaticamente mentre li sposti.</p>
                {isEditingRoomMeasure ? <div className="room-measurement-edit"><label htmlFor="room-width-reference">Quanto misura la parete principale?</label><div><input id="room-width-reference" aria-label="Larghezza reale parete principale" inputMode="decimal" value={roomWidthDraft} onChange={(event) => setRoomWidthDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') confirmRoomWidth(); }} placeholder={roomMeasurement.widthMeters.toLocaleString('it-IT')} /><span>metri</span><button type="button" onClick={confirmRoomWidth}>Conferma</button></div><button type="button" className="cancel-measure-edit" onClick={() => setIsEditingRoomMeasure(false)}>Annulla</button></div> : <div className="room-measurement-actions"><button type="button" onClick={() => { setRoomWidthDraft(String(roomMeasurement.widthMeters).replace('.', ',')); setIsEditingRoomMeasure(true); }}>✎ Correggi una misura</button>{manualRoomWidth && <button type="button" onClick={restoreAutomaticRoomMeasurement}>↻ Torna automatico</button>}</div>}
              </div>}
              {activeStep === 3 && !selectedFurniture && !pendingFurniture && <div className="surface-target-card">
                <div className="surface-target-heading"><span>1</span><div><strong>Dove vuoi applicarlo?</strong><small>Scegli pavimento o muro. La linea verde indica la zona attiva.</small></div></div>
                <div className="surface-target-buttons" role="group" aria-label="Scegli superficie da modificare">
                  {productTargetSurfaces.map((surface) => <button type="button" key={surface.id} className={surface.id === selectedId ? 'is-active' : ''} onClick={() => { setSelectedId(surface.id); setRenameDraft(surface.name); setShowSurfaceGuides(true); setError(null); setNotice(`${surface.name} selezionato.`); if (isCorrectingEdges) window.requestAnimationFrame(() => canvasRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })); }} disabled={surface.frozen}><span style={{ background: kindColors[surface.kind] }} />{surface.name}{surface.frozen ? ' · bloccato' : ''}</button>)}
                </div>
                <div className="surface-guide-actions"><button type="button" className={isCorrectingEdges ? 'is-active' : ''} onClick={toggleEdgeCorrection}>{isCorrectingEdges ? '✓ Fine' : '↔ Sposta linee'}</button><button type="button" onClick={undo} disabled={!pastSurfaces.length}>↶ Annulla ultima modifica</button><button type="button" onClick={() => setShowSurfaceGuides((current) => !current)}>{showSurfaceGuides ? '◎ Nascondi linee' : '◎ Mostra linee'}</button>{room?.sourceType === 'photo' && <button type="button" onClick={() => void autoFitSurfaces()} disabled={isAutoFitting || showProcessedPreview}>✦ Rifai contorni</button>}</div>
              </div>}
              <div className="property-title"><span>Come vuoi inserire il prodotto?</span></div>
              <div className="product-entry-cards" aria-label="Modalità inserimento prodotto">
                <button type="button" className="product-entry-card is-primary" onClick={() => document.querySelector<HTMLInputElement>('.guided-search input')?.focus()}><span>⌕</span><strong>Cerca online</strong><small>Marca, modello, colore o link</small></button>
                <button type="button" className="product-entry-card" onClick={() => furnitureInputRef.current?.click()} disabled={isClassifyingProduct || isPreparingFurniture}><span>▣</span><strong>{isClassifyingProduct || isPreparingFurniture ? 'Riconosco e preparo…' : 'Foto prodotto'}</strong><small>Capisce materiale o mobile</small></button>
                <button type="button" className="product-entry-card" onClick={() => materialInputRef.current?.click()}><span>▦</span><strong>Campione materiale</strong><small>Per pavimenti e pareti</small></button>
              </div>
              <div className="product-search-heading"><strong>Ricerca normale</strong><span>oppure incolla il link del prodotto</span></div>
              {aiStatus !== 'ready' && <div className="ai-setup-banner"><strong>{isLocalPreview() ? 'Anteprima locale' : aiStatus === 'missing' ? 'IA non configurata sul server' : 'IA momentaneamente non raggiungibile'}</strong><span>{isLocalPreview() ? 'Grok è configurata sul sito online; qui verifichi interfaccia e posizionamento senza usare credenziali.' : 'La chiave resta protetta sul server. Puoi comunque premere il comando: l’app riproverà il collegamento.'}</span></div>}
              <div className="guided-search" aria-label="Criteri di ricerca prodotto"><label><span>Marca o produttore</span><input aria-label="Marca o produttore" value={searchBrand} onChange={(event) => setSearchBrand(event.target.value)} placeholder="Es. Lea Ceramiche" /></label><label><span>Modello o collezione</span><input aria-label="Modello o collezione" value={searchModel} onChange={(event) => setSearchModel(event.target.value)} placeholder="Es. Intense" /></label><label><span>Colore</span><input aria-label="Colore prodotto" value={searchColor} onChange={(event) => setSearchColor(event.target.value)} placeholder="Es. Clair" /></label><label><span>Tipo prodotto</span><select aria-label="Tipo prodotto" value={searchCategory} onChange={(event) => setSearchCategory(event.target.value as ProductSearchCategory)}><option value="">Tutti</option><option value="Pavimenti">Pavimenti</option><option value="Rivestimenti">Rivestimenti</option><option value="Colori">Colori parete</option><option value="Arredi">Mobili e arredi</option></select></label></div>
              <label className="free-search-label"><span>Altri dettagli facoltativi</span><input className="material-search" aria-label="Cerca materiali, colori o mobili" value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchProductsOnline(); }} placeholder="Es. effetto pietra, 60 × 120, opaco" /></label>
              <label className="free-search-label"><span>Link prodotto facoltativo · ricerca più veloce</span><input className="material-search" type="url" inputMode="url" aria-label="Link prodotto" value={searchSourceUrl} onChange={(event) => setSearchSourceUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchProductsOnline(); }} placeholder="https://sito-produttore.it/prodotto" /></label>
              <div className="guided-search-actions"><button type="button" className="reset-search-button" onClick={resetProductSearch}>Azzera</button><button type="button" className="guided-search-button" onClick={() => void searchProductsOnline()} disabled={isSearchingProducts}>{isSearchingProducts ? 'Cerco nei cataloghi…' : `Cerca con ${aiProviderLabel ?? 'IA'}`}</button></div>
              <div className="search-scope"><span>Materiali</span><span>Colori</span><span>Arredi</span><span className="internet-ready">Prodotti reali con fonte</span></div>
              {onlineMaterials.length > 0 && <div className="online-results"><strong>Risultati online</strong>{onlineMaterials.map((item) => { const missingFurnitureImage = item.category === 'Arredi' && !item.previewUrl; const needsSurfaceSample = requiresVerifiedSurfaceSample(item); const target = recommendedSurface(item); return <div className={`online-product ${material?.id === item.id ? 'is-selected' : ''}`} key={item.id}>{item.previewUrl ? <img src={item.previewUrl} alt={`Riferimento ${item.name}`} /> : <span className="catalog-swatch tile" /> }<button className="online-product-info" type="button" onClick={() => void chooseOnlineProduct(item)} disabled={missingFurnitureImage} title={missingFurnitureImage ? 'Serve una foto prodotto prima di inserire questo mobile' : undefined}><strong>{item.brand} · {item.name}</strong><span className={`reference-badge reference-${item.referenceKind ?? 'metadata-only'}`}>{materialReferenceLabel(item)}</span><small>{item.description}</small></button><a href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte</a><button className="online-product-try" type="button" onClick={() => item.category === 'Arredi' ? void chooseOnlineProduct(item) : void applyMaterialAutomatically(item)} disabled={missingFurnitureImage || isApplyingProduct}>{item.category === 'Arredi' ? 'Inserisci nella stanza' : needsSurfaceSample ? 'Aggiungi campione per provarlo' : `Prova ora su ${target?.name ?? 'una superficie'}`}</button></div>; })}</div>}
              <div className="material-results">{filteredMaterials.length > 0 && <div className="included-results-heading"><strong>Esempi compatibili</strong><span>Seleziona per provarli subito nella stanza</span></div>}{filteredMaterials.map((item) => <button type="button" key={item.id} className={`material-result ${material?.id === item.id ? 'is-selected' : ''}`} onClick={() => chooseMaterial(item)}><span className={`catalog-swatch ${item.pattern ?? 'color'}`} style={{ '--swatch-color': item.color } as CSSProperties} /><span><strong>{item.name}</strong><small>{item.category} · {item.description}</small></span></button>)}{filteredFurniture.map((item) => <button type="button" key={item.name} className={`material-result furniture-result ${pendingFurniture?.name === item.name ? 'is-selected' : ''}`} onClick={() => startFurniturePlacement(item.name, item.previewUrl, item.description, undefined, item.previewUrl, item.sidePreviewUrl)}>{item.previewUrl ? <img className="furniture-result-preview" src={item.previewUrl} alt="" /> : <span className="furniture-icon">＋</span>}<span><strong>{item.name}</strong><small>Tocca e poi scegli il punto nella stanza · {item.description}</small></span></button>)}{filteredMaterials.length === 0 && filteredFurniture.length === 0 && onlineMaterials.length === 0 && <div className="custom-search-result"><p>Nessun campione incluso corrisponde. Per trovare marca e prodotto esatti serve la ricerca IA attiva.</p><button type="button" onClick={addCustomRequest}>Aggiungi “{materialQuery.trim()}” alla richiesta</button></div>}</div>
              <div className="custom-color"><input type="color" aria-label="Scegli colore personalizzato" value={customColor} onChange={(event) => setCustomColor(event.target.value)} /><button type="button" onClick={chooseCustomColor}>Usa questo colore</button></div>
              {!selectedFurniture && !pendingFurniture ? <>
                {material && <div className="loaded-material">{material.previewUrl ? <img src={material.previewUrl} alt={`Campione ${material.name}`} /> : <span className="catalog-swatch tile" />}<div><strong>{material.name}</strong><small>{materialReferenceLabel(material)}</small></div></div>}
                {materialNeedsSample && <div className="indicative-product-note"><div><strong>Serve un campione prima della prova.</strong><span>La fonte verifica il prodotto, ma non fornisce una texture applicabile. L’app non inventa il disegno dal solo nome.</span></div><button type="button" onClick={() => materialInputRef.current?.click()}>＋ Carica campione materiale</button></div>}
                <button className="auto-apply-product-button" type="button" onClick={() => void applyMaterialAutomatically()} disabled={!material || isApplyingProduct}>{isApplyingProduct ? 'Adatto il prodotto alla stanza…' : materialNeedsSample ? 'Aggiungi campione per provarlo' : `Prova ora su ${materialTarget?.name ?? 'la superficie scelta'}`}</button>
                <button className="apply-button secondary-apply" type="button" aria-label={`Applica a ${selected.name}`} onClick={applyMaterial} disabled={!material || selected.frozen || materialNeedsSample}>Oppure applica solo a {selected.name}</button>
                <p className="material-search-note">L’app sceglie pavimento o muro, corregge prospettiva e scala, e lascia identiche tutte le zone Freeze. La resa è fedele al prodotto solo quando compare “Texture ufficiale verificata” o usi un tuo campione.</p>
              </> : <div className="furniture-mode-note"><strong>Modalità mobile attiva</strong><span>I comandi di pavimento e rivestimento sono nascosti per evitare di applicare per errore la foto del mobile a un muro.</span></div>}
            </div>
            <div className="property-section furniture-section"><div className="property-title"><span>Mobili nella stanza</span><span className="editable-badge">{placedFurniture.length + customRequests.length} scelti</span></div><button className="upload-furniture-button" type="button" onClick={() => furnitureInputRef.current?.click()} disabled={isClassifyingProduct || isPreparingFurniture}>{isClassifyingProduct || isPreparingFurniture ? 'Riconosco, scontorno e preparo la prospettiva…' : '＋ Carica la foto di un prodotto'}</button>{placedFurniture.length || customRequests.length ? <div className="selected-assets">{placedFurniture.map((item, index) => <button type="button" className={selectedFurnitureId === item.id ? 'is-selected' : ''} key={item.id} onClick={() => selectFurnitureForEditing(item)}>{item.name} {placedFurniture.filter((candidate) => candidate.name === item.name).length > 1 ? index + 1 : ''}<span>{item.frozen ? '◆' : '›'}</span></button>)}{customRequests.map((item) => <button type="button" key={item} onClick={() => setCustomRequests((current) => current.filter((name) => name !== item))}>{item}<span>×</span></button>)}</div> : <p className="no-results">Carica una foto: l’app riconosce se è un mobile oppure un materiale e sceglie il flusso corretto.</p>}{selectedFurniture && <div className="furniture-controls"><div className="furniture-control-heading"><strong>{selectedFurniture.name}</strong><span>{selectedFurniture.frozen ? 'Posizione bloccata' : 'Tocca i comandi per sistemarlo'}</span></div><div className="furniture-real-size"><label htmlFor="furniture-real-width">Larghezza reale</label><div><input id="furniture-real-width" aria-label="Larghezza reale del mobile" inputMode="decimal" value={furnitureWidthDraft} onChange={(event) => setFurnitureWidthDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') confirmFurnitureWidth(); }} placeholder="es. 140" disabled={selectedFurniture.frozen} /><span>cm</span><button type="button" onClick={confirmFurnitureWidth} disabled={selectedFurniture.frozen}>Applica misura</button></div><small>Per una scala esatta usa la misura del prodotto; senza quote l’app può soltanto stimarla.</small></div><div className="furniture-facing-controls" role="group" aria-label="Parete di orientamento"><span>Schienale verso</span>{(Object.keys(furnitureFacingLabels) as FurnitureFacing[]).map((facing) => <button type="button" key={facing} className={selectedFurniture.facing === facing ? 'is-active' : ''} onClick={() => void orientSelectedFurniture(facing)} disabled={selectedFurniture.frozen || isPreparingFurniture}>{facing === 'front-wall' ? '↑ Frontale' : facing === 'left-wall' ? '↙ Sinistra' : '↘ Destra'}</button>)}</div><div className="furniture-ipad-pad" role="group" aria-label="Comandi rapidi per il mobile"><button type="button" onClick={() => rotateSelectedFurniture(-5)} disabled={selectedFurniture.frozen || selectedFurniture.rotation <= -35} aria-label="Ruota mobile a sinistra">↶</button><button type="button" onClick={() => nudgeSelectedFurniture(0, -.025)} disabled={selectedFurniture.frozen} aria-label="Sposta mobile in alto">↑</button><button type="button" onClick={() => rotateSelectedFurniture(5)} disabled={selectedFurniture.frozen || selectedFurniture.rotation >= 35} aria-label="Ruota mobile a destra">↷</button><button type="button" onClick={() => nudgeSelectedFurniture(-.025, 0)} disabled={selectedFurniture.frozen} aria-label="Sposta mobile a sinistra">←</button><button type="button" className="furniture-angle-reset" onClick={() => updateSelectedFurniture({ rotation: 0 })} disabled={selectedFurniture.frozen || selectedFurniture.rotation === 0} aria-label="Raddrizza mobile">{Math.round(selectedFurniture.rotation)}°</button><button type="button" onClick={() => nudgeSelectedFurniture(.025, 0)} disabled={selectedFurniture.frozen} aria-label="Sposta mobile a destra">→</button><button type="button" onClick={() => resizeSelectedFurniture(-6)} disabled={selectedFurniture.frozen} aria-label="Rimpicciolisci mobile">−</button><button type="button" onClick={() => nudgeSelectedFurniture(0, .025)} disabled={selectedFurniture.frozen} aria-label="Sposta mobile in basso">↓</button><button type="button" onClick={() => resizeSelectedFurniture(6)} disabled={selectedFurniture.frozen} aria-label="Ingrandisci mobile">＋</button></div><div className="furniture-quick-actions"><button type="button" onClick={undoFurnitureChange} disabled={!pastFurniture.length}>↶ Indietro</button><button className={`auto-size-furniture-button ${selectedFurniture.autoScale ? 'is-active' : ''}`} type="button" onClick={restoreAutomaticFurnitureScale} disabled={selectedFurniture.frozen || selectedFurniture.autoScale} aria-label="Misura automatica">{selectedFurniture.autoScale ? `✓ Auto ${Math.round(selectedFurniture.scale)}%` : '◎ Auto'}</button><button className={`freeze-furniture-button ${selectedFurniture.frozen ? 'is-active' : ''}`} type="button" onClick={() => updateSelectedFurniture({ frozen: !selectedFurniture.frozen })}>{selectedFurniture.frozen ? '◇ Sblocca' : '◆ Blocca'}</button><button className="remove-furniture-button" type="button" onClick={removeSelectedFurniture} disabled={selectedFurniture.frozen} aria-label="Rimuovi mobile">⌫ Cancella</button></div></div>}<p className="material-search-note">La vista fotografica viene ricostruita per la parete scelta; posizione, scala e contatto col pavimento sono controllati di nuovo nel render finale.</p></div>
            <div className="property-section metrics"><div><span>Vertici</span><strong>{selected.points.length}</strong></div><div><span>Stato</span><strong>{selected.frozen ? 'Lock' : 'Edit'}</strong></div><div><span>Texture</span><strong>{selected.materialId ? 'Sì' : 'No'}</strong></div></div><button className="remove-button" type="button" onClick={deleteSelected} disabled={selected.frozen}>Elimina superficie</button></> : room ? <div className="empty-properties"><strong>Seleziona un contorno</strong><p>Tocca una superficie sulla foto o sceglila dall’elenco. Puoi anche disegnarne una nuova.</p></div> : null}
          {room && <button className="remove-room-button" type="button" onClick={removeRoom}>Chiudi progetto</button>}
          <div className="phase-card"><span className="phase-index">0.3</span><div><p className="eyebrow">Modalità prova</p><strong>IA e Freeze pronti</strong><p>Ricerca prodotti, stanza vuota e render vengono elaborati dal server senza mostrare chiavi nell’app.</p></div></div>
        </aside>
      </div>
      {activeStep === 2 && drawKind && <div className={`mobile-surface-actions is-drawing ${!quickDraw ? 'has-finish' : ''}`} role="toolbar" aria-label={`Correggi disegno ${activeDrawingLabel}`}>
        <div className="mobile-surface-action-state"><strong>{activeDrawingLabel}</strong><span>{lineWallDraw ? `${draft.length}/2 punti` : manualOpeningMode === 'arch' ? `${draft.length} punti · minimo 5` : `${draft.length}/4 punti`}</span></div>
        <button type="button" onClick={undoDraftPoint} disabled={draft.length === 0} aria-label="Cancella ultimo punto"><span aria-hidden="true">↶</span><small>Ultimo punto</small></button>
        <button className="cancel-surface-action" type="button" onClick={cancelDrawing} aria-label={`Cancella tutto il disegno ${surfaceLabels[drawKind]}`}><span aria-hidden="true">⌫</span><small>Cancella tutto</small></button>
        {!quickDraw && <button className="finish-surface-action" type="button" onClick={() => completeSurface(draft, drawKind)} disabled={draft.length < (manualOpeningMode === 'arch' ? 5 : 3)} aria-label={`Conferma ${activeDrawingLabel}`}><span aria-hidden="true">✓</span><small>Conferma</small></button>}
      </div>}
      {(activeStep === 2 || (activeStep === 3 && isCorrectingEdges)) && !drawKind && selected && <div className="mobile-surface-actions is-selected" role="toolbar" aria-label={`Azioni per ${selected.name}`}>
        <div className="mobile-surface-action-state"><strong>{selected.name}</strong><span>{selected.kind === 'door' || selected.kind === 'window' ? 'Modifica o elimina' : 'Correggi i contorni'}</span></div>
        <button type="button" onClick={undo} disabled={!pastSurfaces.length} aria-label={`Annulla ultima modifica a ${selected.name}`}><span aria-hidden="true">↶</span><small>Indietro</small></button>
        {selected.kind === 'door' || selected.kind === 'window' ? <button className="delete-surface-action" type="button" onClick={deleteSelected} disabled={selected.frozen} aria-label={`Elimina ${selected.name}`}><span aria-hidden="true">⌫</span><small>Elimina</small></button> : <button type="button" onClick={() => void autoFitSurfaces()} disabled={isAutoFitting || showProcessedPreview} aria-label="Rifai riconoscimento automatico"><span aria-hidden="true">✦</span><small>Rifai</small></button>}
        <button className="finish-surface-action" type="button" onClick={toggleEdgeCorrection} aria-label={`Termina modifica di ${selected.name}`}><span aria-hidden="true">✓</span><small>Fine</small></button>
      </div>}
      {renderSummaryOpen && <div className="render-modal" role="dialog" aria-modal="true" aria-labelledby="render-summary-title"><div className="render-modal-card"><button className="modal-close" type="button" onClick={() => setRenderSummaryOpen(false)} aria-label="Chiudi riepilogo">×</button><p className="eyebrow">Richiesta pronta</p><h2 id="render-summary-title">Crea il render reale</h2><div className="render-checks"><div><span>Superfici con materiale</span><strong>{surfaces.filter((surface) => surface.materialId).length}</strong></div><div><span>Zone protette</span><strong>{surfaces.filter((surface) => surface.frozen).length}</strong></div><div><span>Mobili posizionati</span><strong>{placedFurniture.length}</strong></div></div><div className="render-list"><strong>Il motore riceverà:</strong><p>{surfaces.filter((surface) => surface.materialId).map((surface) => `${surface.name}: ${materialMap.get(surface.materialId!)?.name ?? 'materiale'}`).join(' · ') || 'Nessun materiale ancora applicato'}</p><p>{placedFurniture.length || customRequests.length ? `Da inserire: ${[...placedFurniture.map((item) => `${item.name} nel punto scelto`), ...customRequests].join(', ')}` : 'Nessun arredo aggiunto'}</p></div><div className="engine-warning"><span>AI</span><p><strong>{aiStatus === 'ready' ? `${aiProviderLabel ?? 'IA'} attiva` : 'L’app riproverà il collegamento'}</strong>L’IA riceve una maschera limitata a prodotti e mobili. Il resto della stanza, incluse aperture e Freeze, viene ricopiato pixel per pixel.</p></div><button className="modal-primary" type="button" onClick={() => void createFinalRender()} disabled={isRendering}>{isRendering ? 'Creo il render…' : 'Crea render reale con IA'}</button><button className="modal-secondary" type="button" onClick={() => setRenderSummaryOpen(false)}>Torna alle modifiche</button></div></div>}
    </main>
  );
}
