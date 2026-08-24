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
type StudioMaterial = {
  id: string;
  name: string;
  category: 'Pavimenti' | 'Rivestimenti' | 'Colori' | 'Arredi';
  description: string;
  color?: string;
  pattern?: 'wood' | 'stone' | 'tile';
  previewUrl?: string;
  brand?: string;
  sourceUrl?: string;
};
type DragVertex = { surfaceId: string; vertexIndex: number; pointerId: number; origin: Point };

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

const guidedPresets: Array<Omit<Surface, 'id'>> = [
  { name: 'Muro 1', kind: 'wall', frozen: false, points: [{ x: .25, y: .2 }, { x: .75, y: .2 }, { x: .75, y: .68 }, { x: .25, y: .68 }] },
  { name: 'Muro 2', kind: 'wall', frozen: false, points: [{ x: .03, y: .05 }, { x: .25, y: .2 }, { x: .25, y: .68 }, { x: .03, y: .95 }] },
  { name: 'Muro 3', kind: 'wall', frozen: false, points: [{ x: .75, y: .2 }, { x: .97, y: .05 }, { x: .97, y: .95 }, { x: .75, y: .68 }] },
  { name: 'Pavimento', kind: 'floor', frozen: false, points: [{ x: .25, y: .68 }, { x: .75, y: .68 }, { x: .97, y: .95 }, { x: .03, y: .95 }] },
];

function createGuidedSurfaces(bounds?: { left: number; right: number; top: number; floor: number }) {
  if (!bounds) return guidedPresets.map((surface, index) => ({ ...surface, id: `guided-${Date.now()}-${index}` }));
  const { left, right, top, floor } = bounds;
  const outerTop = Math.max(.025, top - .16);
  const bottom = .965;
  const presets: Array<Omit<Surface, 'id'>> = [
    { name: 'Muro 1', kind: 'wall', frozen: false, points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: floor }, { x: left, y: floor }] },
    { name: 'Muro 2', kind: 'wall', frozen: false, points: [{ x: .02, y: outerTop }, { x: left, y: top }, { x: left, y: floor }, { x: .02, y: bottom }] },
    { name: 'Muro 3', kind: 'wall', frozen: false, points: [{ x: right, y: top }, { x: .98, y: outerTop }, { x: .98, y: bottom }, { x: right, y: floor }] },
    { name: 'Pavimento', kind: 'floor', frozen: false, points: [{ x: left, y: floor }, { x: right, y: floor }, { x: .98, y: bottom }, { x: .02, y: bottom }] },
  ];
  return presets.map((surface, index) => ({ ...surface, id: `guided-${Date.now()}-${index}` }));
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
  for (let x = 1; x < width - 1; x += 1) {
    for (let y = Math.round(height * .12); y < height * .9; y += 2) verticalScores[x] += Math.abs(luminance(x + 1, y) - luminance(x - 1, y));
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = Math.round(width * .05); x < width * .95; x += 2) horizontalScores[y] += Math.abs(luminance(x, y + 1) - luminance(x, y - 1));
  }
  const left = strongestEdge(verticalScores, .12, .46, .25);
  const right = strongestEdge(verticalScores, Math.max(.54, left + .2), .9, .75);
  const top = strongestEdge(horizontalScores, .12, .48, .2);
  const floor = strongestEdge(horizontalScores, Math.max(.52, top + .2), .86, .68);
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
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
}

function optimizedPreviewUrl(file: File): string | Promise<string> {
  const isApplePhoto = ['image/heic', 'image/heif'].includes(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (file.size < 2 * 1024 * 1024 && !isApplePhoto) return URL.createObjectURL(file);

  return (async () => {
    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = 'async';
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('decode'));
        image.src = sourceUrl;
      });
      const maximumSide = 2600;
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
  const [processedPreview, setProcessedPreview] = useState<string | null>(null);
  const [processedLabel, setProcessedLabel] = useState('Stanza vuota');
  const [showProcessedPreview, setShowProcessedPreview] = useState(false);
  const [dragVertex, setDragVertex] = useState<DragVertex | null>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);
  const floorplanInputRef = useRef<HTMLInputElement>(null);
  const materialInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const roomBlobRef = useRef<string | null>(null);
  const materialBlobRef = useRef<string | null>(null);
  const dragStartRef = useRef<Surface[] | null>(null);
  const roomImageRef = useRef<HTMLImageElement>(null);
  const autoFitPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    shellRef.current?.setAttribute('data-hydrated', 'true');
    return () => {
      if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
      if (materialBlobRef.current) URL.revokeObjectURL(materialBlobRef.current);
    };
  }, []);

  useEffect(() => {
    shellRef.current?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }, [activeStep]);

  const selected = surfaces.find((surface) => surface.id === selectedId) ?? null;
  const projectName = room?.projectName ?? 'Progetto senza titolo';
  const importedCaption = useMemo(() => room ? `Immagine · ${room.displaySize}` : null, [room]);
  const filteredMaterials = useMemo(() => {
    const query = materialQuery.trim().toLocaleLowerCase('it');
    return catalogMaterials.filter((item) => !query || `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase('it').includes(query));
  }, [materialQuery]);
  const filteredFurniture = useMemo(() => {
    const query = materialQuery.trim().toLocaleLowerCase('it');
    return furnitureCatalog.filter((item) => !query || `${item.name} ${item.description}`.toLocaleLowerCase('it').includes(query));
  }, [materialQuery]);
  const materialMap = useMemo(() => new Map(catalogMaterials.concat(material ? [material] : []).map((item) => [item.id, item])), [material]);

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
      roomBlobRef.current = previewUrl;
      const initialSurfaces = sourceType === 'floorplan' ? createFloorplanOutline() : [];
      setRoom({ ...result.value, previewUrl, sourceType });
      setProcessedPreview(null); setShowProcessedPreview(false); setProcessedLabel('Stanza vuota'); setOnlineMaterials([]);
      autoFitPreviewRef.current = null;
      setSurfaces(initialSurfaces); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(initialSurfaces[0]?.id ?? null); setRenameDraft(initialSurfaces[0]?.name ?? ''); setDraft([]); setDrawKind(null); setQuickDraw(false); setLineWallDraw(false); setError(null);
      setNotice(sourceType === 'floorplan'
        ? 'Planimetria riprodotta. Adatta il perimetro con i pallini e aggiungi le pareti interne con due tocchi.'
        : 'Foto pronta. Crea le superfici automaticamente oppure aggiungi un muro con quattro tocchi.');
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
    roomBlobRef.current = null;
    setRoom(null); setSurfaces([]); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(null); setDraft([]); setDrawKind(null); setQuickDraw(false); setLineWallDraw(false); setProcessedPreview(null); setShowProcessedPreview(false); setProcessedLabel('Stanza vuota'); setOnlineMaterials([]); setNotice(null);
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
    if (!surface || surface.frozen) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = surfaces;
    setDragVertex({ surfaceId, vertexIndex, pointerId: event.pointerId, origin: surface.points[vertexIndex] });
  }

  function moveDraggedVertex(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragVertex || event.pointerId !== dragVertex.pointerId) return;
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
    }
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
    const next: StudioMaterial = { id: `material-${Date.now()}`, name: file.name.replace(/\.[^.]+$/, ''), category: 'Rivestimenti', description: 'Campione fotografico personale', previewUrl };
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
      const response = await fetch(endpoint('/api/search-products'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
      });
      const result = await response.json() as { products?: Array<{ name: string; brand: string; category: StudioMaterial['category']; description: string; sourceUrl: string; imageUrl?: string }>; message?: string };
      if (!response.ok) throw new Error(result.message ?? 'Ricerca non disponibile.');
      const found = (result.products ?? []).map((item, index) => ({
        id: `online-${Date.now()}-${index}`,
        name: item.name,
        brand: item.brand,
        category: item.category,
        description: item.description,
        sourceUrl: item.sourceUrl,
        previewUrl: item.imageUrl || undefined,
      }));
      setOnlineMaterials(found);
      setNotice(found.length ? `${found.length} prodotti reali trovati. Scegline uno e premi “Applica automaticamente”.` : 'Nessun prodotto affidabile trovato. Prova con marca e collezione più precise.');
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

  async function createMaskedInput(options: { editableSurface?: Surface; frozenSurfaces?: Surface[] }) {
    const image = roomImageRef.current;
    if (!image) throw new Error('La foto della stanza non è pronta.');
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
      if (material.previewUrl) form.append('imageUrl', material.previewUrl);
      const response = await fetch(endpoint('/api/apply-product'), { method: 'POST', body: form });
      const result = await response.json() as { image?: string; message?: string };
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Render non disponibile.');
      commitSurfaces(surfaces.map((surface) => surface.id === target.id ? { ...surface, materialId: material.id } : surface));
      setProcessedPreview(result.image); setProcessedLabel(material.name); setShowProcessedPreview(true);
      setNotice(`${material.name} adattato a ${target.name}. Tutte le zone Freeze sono rimaste protette.`);
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
    if (!room || room.sourceType !== 'photo' || !roomImageRef.current) return;
    setIsAutoFitting(true); setError(null);
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    try {
      const detected = createGuidedSurfaces(detectRoomBounds(roomImageRef.current));
      const byName = new Map(detected.map((surface) => [surface.name, surface]));
      const existingNames = new Set(surfaces.map((surface) => surface.name));
      const adjusted = surfaces.length
        ? surfaces.map((surface) => surface.frozen ? surface : byName.has(surface.name) ? { ...surface, points: byName.get(surface.name)!.points } : surface)
        : detected;
      const missing = detected.filter((surface) => !existingNames.has(surface.name));
      commitSurfaces([...adjusted, ...(surfaces.length ? missing : [])]);
      const first = adjusted[0] ?? detected[0];
      setSelectedId(first?.id ?? null); setRenameDraft(first?.name ?? '');
      setNotice('Allineamento automatico completato. Se serve, trascina un pallino: gli angoli collegati resteranno uniti.');
    } catch {
      if (surfaces.length === 0) seedGuidedSurfaces();
      setNotice('Ho inserito una base modificabile. Trascina i pallini sui bordi della stanza.');
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
      const response = await fetch(endpoint('/api/empty-room'), { method: 'POST', body: form });
      const result = await response.json() as { image?: string; message?: string };
      if (!response.ok || !result.image) throw new Error(result.message ?? 'Immagine non disponibile.');
      setProcessedPreview(result.image); setProcessedLabel('Stanza vuota'); setShowProcessedPreview(true);
      setNotice('Stanza vuota pronta. Confrontala con l’originale e scegli quale usare.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Non sono riuscito a svuotare la stanza.');
      setNotice(null);
    } finally {
      setIsEmptyingRoom(false);
    }
  }

  function loadDemoRoom() {
    const file = new File(['demo'], 'stanza-esempio.png', { type: 'image/png' });
    const created = createGuidedSurfaces();
    setRoom({ file, kind: 'image', canPreview: true, displaySize: 'esempio incluso', projectName: 'Stanza esempio', previewUrl: '/og.png', sourceType: 'photo' });
    setRoomRatio(16 / 9); setSurfaces(created); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(created[0].id); setRenameDraft(created[0].name); setError(null);
    setNotice('Esempio pronto. Prova a spostare i vertici, bloccare un muro o caricare un campione.');
    setActiveStep(2);
  }

  function goToStep(step: number) {
    if (step > 1 && !room) return;
    if (step > 2 && surfaces.length === 0) {
      setNotice('Prima crea o disegna almeno una superficie.');
      return;
    }
    setActiveStep(step);
    if (step === 4) setRenderSummaryOpen(true);
  }

  return (
    <main ref={shellRef} className={`app-shell simple-mode step-${activeStep}`}>
      <header className="topbar">
        <a href="/projects" className="brand-lockup" aria-label="Vai ai progetti"><div className="brand-mark" aria-hidden="true"><span /><span /></div><div><p className="eyebrow">Studio materiali</p><p className="brand-name">Materia</p></div></a>
        <div className="project-heading"><span className="status-dot" /><div><p>{projectName}</p><span>{room ? `${room.sourceType === 'floorplan' ? 'Planimetria' : 'Foto'} · originale protetto` : 'Nuovo progetto locale'}</span></div></div>
        <div className="top-actions"><button className="avatar" type="button" aria-label="Profilo locale">AG</button></div>
      </header>

      <nav className="simple-steps" aria-label="Passaggi del progetto">{[
        ['1', 'Foto'], ['2', 'Prepara'], ['3', 'Prodotti'], ['4', 'Render'],
      ].map(([number, label], index) => <button type="button" key={number} className={activeStep === index + 1 ? 'is-active' : activeStep > index + 1 ? 'is-done' : ''} onClick={() => goToStep(index + 1)} disabled={(index > 0 && !room) || (index > 1 && surfaces.length === 0)}><span>{activeStep > index + 1 ? '✓' : number}</span><strong>{label}</strong></button>)}</nav>

      <div className="workspace">
        <aside className="surface-panel" aria-label="Superfici della stanza">
          <div className="panel-heading"><div><p className="eyebrow">Aree riconosciute</p><h2>Cosa vuoi proteggere?</h2></div><span className="count-badge">{surfaces.length}</span></div>
          <button className="detect-button" type="button" onClick={() => void autoFitSurfaces()} disabled={!room || room.sourceType !== 'photo' || isAutoFitting}><span className="spark">✦</span>{isAutoFitting ? 'Sto adattando…' : 'Adatta automaticamente'}<span className="soon">Foto</span></button>
          {surfaces.length ? <div className="surface-list">{surfaces.map((surface) => <button className={`surface-item ${surface.id === selectedId ? 'is-active' : ''}`} key={surface.id} type="button" onClick={() => { setSelectedId(surface.id); setRenameDraft(surface.name); setDrawKind(null); setQuickDraw(false); setDraft([]); }}><span className="surface-swatch" style={{ background: kindColors[surface.kind] }} /><span className="surface-copy"><strong>{surface.name}</strong><small>{surface.frozen ? 'Freeze attivo' : surface.materialId ? 'Prodotto applicato' : 'Tocca per selezionare'}</small></span><span className="lock-state" aria-label={surface.frozen ? 'Bloccata' : 'Modificabile'}>{surface.frozen ? '🔒' : '◇'}</span></button>)}</div> : <div className="surface-empty"><span>✦</span><strong>Riconoscimento automatico</strong><p>L’app divide la foto in pavimento, muri e soffitto.</p></div>}
          {selected && activeStep === 2 && <div className="simple-freeze-actions"><button type="button" className={selected.frozen ? 'is-frozen' : ''} onClick={toggleFreeze}>{selected.frozen ? `Sblocca ${selected.name}` : `🔒 Blocca ${selected.name}`}</button><button type="button" onClick={freezeAllExceptSelected}>Proteggi tutto il resto</button><p>Freeze mantiene identica questa zona nei render successivi.</p></div>}
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
              <svg className={`surface-overlay ${drawKind ? 'is-drawing' : ''}`} viewBox="0 0 1000 625" preserveAspectRatio="none" onPointerDown={addDraftPoint} onPointerMove={moveDraggedVertex} onPointerUp={endVertexDrag} onPointerCancel={endVertexDrag}>
                <defs>
                  {catalogMaterials.filter((item) => item.pattern).map((item) => <pattern id={`catalog-material-${item.id}`} key={item.id} width={item.pattern === 'wood' ? 180 : 120} height={item.pattern === 'wood' ? 42 : 120} patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill={item.color} /><path d={item.pattern === 'wood' ? 'M0 2H180 M0 40H180 M45 2V40 M135 2V40' : 'M0 1H120 M1 0V120'} stroke="rgba(67,55,43,.22)" strokeWidth="3" /><path d={item.pattern === 'stone' ? 'M8 38 C38 17 64 55 110 25 M14 92 C45 68 77 106 116 74' : ''} fill="none" stroke="rgba(255,255,255,.24)" strokeWidth="5" /></pattern>)}
                  {material?.previewUrl && <pattern id={`uploaded-material-${material.id}`} width="140" height="140" patternUnits="userSpaceOnUse"><image href={material.previewUrl} width="140" height="140" preserveAspectRatio="xMidYMid slice" /></pattern>}
                </defs>
                {surfaces.map((surface) => <g key={surface.id} className={surface.frozen ? 'is-frozen' : ''}><polygon points={pointsToSvg(surface.points)} fill={materialFill(surface)} stroke={surface.id === selectedId ? '#d7f05c' : kindColors[surface.kind]} strokeWidth={surface.id === selectedId ? 6 : 3} vectorEffect="non-scaling-stroke" onPointerDown={(event) => { if (!drawKind) { event.stopPropagation(); setSelectedId(surface.id); setRenameDraft(surface.name); setQuickDraw(false); } }} />{surface.id === selectedId && surface.points.map((point, index) => <circle key={`${surface.id}-${index}`} cx={point.x * 1000} cy={point.y * 625} r="14" className="surface-vertex" onPointerDown={(event) => beginVertexDrag(event, surface.id, index)} />)}</g>)}
                {draft.length > 0 && <><polyline points={pointsToSvg(draft)} fill="none" stroke="#d7f05c" strokeWidth="5" vectorEffect="non-scaling-stroke" />{draft.map((point, index) => <circle key={index} cx={point.x * 1000} cy={point.y * 625} r="9" className="draft-vertex" />)}</>}
              </svg><div className="import-status"><span className="status-dot" /><div><strong>{showProcessedPreview ? processedLabel : 'Originale intatto'}</strong><small>{showProcessedPreview ? 'Elaborazione IA · originale sempre disponibile' : importedCaption}</small></div></div>
              {processedPreview && <div className="before-after-toggle" aria-label="Confronta originale e risultato"><button type="button" className={!showProcessedPreview ? 'is-active' : ''} onClick={() => setShowProcessedPreview(false)}>Originale</button><button type="button" className={showProcessedPreview ? 'is-active' : ''} onClick={() => setShowProcessedPreview(true)}>{processedLabel}</button></div>}
            </div> : <><div className="room-demo" aria-label="Anteprima schematica della stanza"><div className="room-ceiling"><span>Soffitto</span></div><div className="room-wall left"><span>Muro 2</span></div><div className="room-wall center"><span>Muro 1</span></div><div className="room-wall right"><span>Muro 3</span></div><div className="room-floor"><span>Pavimento</span></div></div><div className="upload-card"><div className="upload-icon">↑</div><p className="eyebrow">Inizia da ciò che hai</p><h1>Cosa vuoi caricare?</h1><p>Scegli una foto della stanza oppure una planimetria. L’originale resterà sempre intatto.</p><div className="source-actions"><label className="source-card is-primary" htmlFor="room-file"><span>▣</span><strong>Foto stanza</strong><small>Apri direttamente Foto su iPhone e iPad</small></label><label className="source-card" htmlFor="floorplan-file"><span>⌗</span><strong>Planimetria</strong><small>Ricalca perimetro e pareti interne</small></label></div><button className="demo-button" type="button" onClick={loadDemoRoom}>Prova con la stanza esempio</button><small>JPG, PNG o HEIC · massimo 20 MB</small></div></>}
            {isDraggingFile && <div className="drop-overlay"><strong>Rilascia per importare</strong><span>La foto resterà nel browser.</span></div>}
            {isImportingRoom && <div className="processing-overlay" role="status"><span className="processing-spinner" /><strong>Preparo la foto…</strong><small>Le immagini grandi vengono ottimizzate per evitare blocchi.</small></div>}
          </div>{error && <div className="file-error" role="alert"><strong>Operazione non completata</strong><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Chiudi errore">×</button></div>}</div>
          <input ref={roomInputRef} id="room-file" className="visually-hidden" type="file" accept="image/*,.heic,.heif" onChange={onRoomInput} /><input ref={floorplanInputRef} id="floorplan-file" className="visually-hidden" type="file" accept="image/*,.heic,.heif" onChange={onFloorplanInput} /><input ref={materialInputRef} id="material-file" className="visually-hidden" type="file" accept="image/jpeg,image/png" onChange={onMaterialInput} />
          <div className="status-bar"><span className="status-icon">{notice ? '✓' : 'i'}</span><p>{notice ?? 'Carica, svuota, scegli cosa proteggere e cerca il prodotto.'}</p>{room?.sourceType === 'photo' && activeStep === 2 && <button className="empty-room-button" type="button" onClick={() => void emptyRoom()} disabled={isEmptyingRoom}>{isEmptyingRoom ? 'Svuoto la stanza…' : processedLabel === 'Stanza vuota' && processedPreview ? '↻ Rigenera stanza vuota' : '⌂ Svuota la stanza'}</button>}{room?.sourceType === 'floorplan' && activeStep === 2 && !drawKind && <button type="button" onClick={startFloorplanWall}>Aggiungi parete interna</button>}{room && surfaces.length > 0 && activeStep === 4 && <button className="render-flow-button" type="button" aria-label="Prova flusso render" onClick={() => setRenderSummaryOpen(true)}>Controlla e crea render</button>}{activeStep === 2 && surfaces.length > 0 && <button type="button" onClick={() => goToStep(3)}>Cerca i prodotti</button>}{activeStep === 3 && <button className="render-flow-button" type="button" aria-label="Prova flusso render" onClick={() => goToStep(4)}>Continua: crea render</button>}</div>
        </section>

        <aside className="properties-panel" aria-label="Proprietà">
          <div className="panel-heading"><div><p className="eyebrow">Controlli</p><h2>{selected?.name ?? (room ? 'Nessuna selezione' : 'Importa una stanza')}</h2></div>{selected && <span className="type-badge">{surfaceLabels[selected.kind]}</span>}</div>
          {room && <div className="asset-card"><span>{room.sourceType === 'floorplan' ? 'PLAN' : 'IMG'}</span><div><strong>{room.file.name}</strong><small>{room.sourceType === 'floorplan' ? 'Planimetria originale' : importedCaption}</small></div><label htmlFor={room.sourceType === 'floorplan' ? 'floorplan-file' : 'room-file'}>Sostituisci</label></div>}
          {selected ? <><div className="property-section"><div className="property-title"><span>Nome superficie</span><span className="editable-badge">Personalizzabile</span></div><div className="rename-control"><input aria-label="Nome superficie" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} /><button type="button" onClick={renameSelected} disabled={!renameDraft.trim() || renameDraft.trim() === selected.name}>Salva</button></div></div><div className="property-section"><div className="property-title"><span>Protezione superficie</span><span className={`editable-badge ${selected.frozen ? 'frozen' : ''}`}>{selected.frozen ? 'Frozen' : 'Modificabile'}</span></div><button className={`freeze-button ${selected.frozen ? 'is-active' : ''}`} type="button" aria-label={selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'} onClick={toggleFreeze}><span>{selected.frozen ? '◆' : '◇'}</span>{selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'}<small>{selected.frozen ? 'Protetta' : 'Attivo subito'}</small></button><button className="freeze-others-button" type="button" onClick={freezeAllExceptSelected}>Blocca tutto tranne {selected.name}</button></div>
            <div className="property-section product-search-section">
              <div className="property-title"><span>Cerca un prodotto preciso</span><button type="button" onClick={() => materialInputRef.current?.click()}>Carica campione</button></div>
              <div className="online-search-control"><input className="material-search" aria-label="Cerca materiali, colori o mobili" value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchProductsOnline(); }} placeholder="Es. mattonelle rovere chiaro Biason" /><button type="button" onClick={() => void searchProductsOnline()} disabled={isSearchingProducts}>{isSearchingProducts ? 'Cerco…' : 'Cerca online'}</button></div>
              <div className="search-scope"><span>Materiali</span><span>Colori</span><span>Arredi</span><span className="internet-ready">Prodotti reali con fonte</span></div>
              {onlineMaterials.length > 0 && <div className="online-results"><strong>Risultati online</strong>{onlineMaterials.map((item) => <div className={`online-product ${material?.id === item.id ? 'is-selected' : ''}`} key={item.id}>{item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="catalog-swatch tile" /> }<button type="button" onClick={() => chooseMaterial(item)}><strong>{item.brand} · {item.name}</strong><small>{item.description}</small></button><a href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte</a></div>)}</div>}
              <div className="material-results">{filteredMaterials.map((item) => <button type="button" key={item.id} className={`material-result ${material?.id === item.id ? 'is-selected' : ''}`} onClick={() => chooseMaterial(item)}><span className={`catalog-swatch ${item.pattern ?? 'color'}`} style={{ '--swatch-color': item.color } as CSSProperties} /><span><strong>{item.name}</strong><small>{item.category} · {item.description}</small></span></button>)}{filteredFurniture.map((item) => <button type="button" key={item.name} className={`material-result furniture-result ${furniture.includes(item.name) ? 'is-selected' : ''}`} onClick={() => toggleFurniture(item.name)}><span className="furniture-icon">{furniture.includes(item.name) ? '✓' : '+'}</span><span><strong>{item.name}</strong><small>Mobili · {item.description}</small></span></button>)}{filteredMaterials.length === 0 && filteredFurniture.length === 0 && onlineMaterials.length === 0 && <div className="custom-search-result"><p>Nessun elemento locale. Premi “Cerca online” per trovare marca e prodotto esatti.</p><button type="button" onClick={addCustomRequest}>Aggiungi “{materialQuery.trim()}” alla richiesta</button></div>}</div>
              <div className="custom-color"><input type="color" aria-label="Scegli colore personalizzato" value={customColor} onChange={(event) => setCustomColor(event.target.value)} /><button type="button" onClick={chooseCustomColor}>Usa questo colore</button></div>
              {material?.previewUrl && <div className="loaded-material"><img src={material.previewUrl} alt="Campione materiale" /><div><strong>{material.name}</strong><small>{material.description}</small></div></div>}
              <button className="auto-apply-product-button" type="button" onClick={() => void applyMaterialAutomatically()} disabled={!material || isApplyingProduct}>{isApplyingProduct ? 'Adatto il prodotto alla stanza…' : `Applica automaticamente ${material?.name ?? 'il prodotto'}`}</button>
              <button className="apply-button secondary-apply" type="button" aria-label={`Applica a ${selected.name}`} onClick={applyMaterial} disabled={!material || selected.frozen}>Oppure applica solo a {selected.name}</button>
              <p className="material-search-note">L’app sceglie pavimento o muro, corregge prospettiva e scala, e lascia identiche tutte le zone Freeze.</p>
            </div>
            <div className="property-section"><div className="property-title"><span>Elementi nel render</span><span className="editable-badge">{furniture.length + customRequests.length} scelti</span></div>{furniture.length || customRequests.length ? <div className="selected-assets">{furniture.map((item) => <button type="button" key={item} onClick={() => toggleFurniture(item)}>{item}<span>×</span></button>)}{customRequests.map((item) => <button type="button" key={item} onClick={() => setCustomRequests((current) => current.filter((name) => name !== item))}>{item}<span>×</span></button>)}</div> : <p className="no-results">Cerca un mobile o scrivi liberamente ciò che vuoi inserire.</p>}<p className="material-search-note">Con il motore AI potrai caricare anche la foto esatta del mobile e indicarne la posizione.</p></div>
            <div className="property-section metrics"><div><span>Vertici</span><strong>{selected.points.length}</strong></div><div><span>Stato</span><strong>{selected.frozen ? 'Lock' : 'Edit'}</strong></div><div><span>Texture</span><strong>{selected.materialId ? 'Sì' : 'No'}</strong></div></div><button className="remove-button" type="button" onClick={deleteSelected} disabled={selected.frozen}>Elimina superficie</button></> : room ? <div className="empty-properties"><strong>Seleziona un contorno</strong><p>Tocca una superficie sulla foto o sceglila dall’elenco. Puoi anche disegnarne una nuova.</p></div> : null}
          {room && <button className="remove-room-button" type="button" onClick={removeRoom}>Chiudi progetto</button>}
          <div className="phase-card"><span className="phase-index">0.2</span><div><p className="eyebrow">Modalità prova</p><strong>Flusso render pronto</strong><p>Ricerca online, adattamento fotografico e Freeze sono collegati; per attivarli sul server serve la chiave AI.</p></div></div>
        </aside>
      </div>
      {renderSummaryOpen && <div className="render-modal" role="dialog" aria-modal="true" aria-labelledby="render-summary-title"><div className="render-modal-card"><button className="modal-close" type="button" onClick={() => setRenderSummaryOpen(false)} aria-label="Chiudi riepilogo">×</button><p className="eyebrow">Richiesta pronta</p><h2 id="render-summary-title">Prima del render reale</h2><div className="render-checks"><div><span>Superfici con materiale</span><strong>{surfaces.filter((surface) => surface.materialId).length}</strong></div><div><span>Zone protette</span><strong>{surfaces.filter((surface) => surface.frozen).length}</strong></div><div><span>Elementi richiesti</span><strong>{furniture.length + customRequests.length}</strong></div></div><div className="render-list"><strong>Il motore riceverà:</strong><p>{surfaces.filter((surface) => surface.materialId).map((surface) => `${surface.name}: ${materialMap.get(surface.materialId!)?.name ?? 'materiale'}`).join(' · ') || 'Nessun materiale ancora applicato'}</p><p>{furniture.length || customRequests.length ? `Da inserire: ${[...furniture, ...customRequests].join(', ')}` : 'Nessun arredo aggiunto'}</p></div><div className="engine-warning"><span>AI</span><p><strong>Motore pronto, chiave server da configurare</strong>L’app invierà foto, prodotto e maschere Freeze al motore fotografico. Senza chiave non mostra risultati inventati.</p></div><button className="modal-primary" type="button" onClick={() => setRenderSummaryOpen(false)}>Continua a configurare</button></div></div>}
    </main>
  );
}
