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
  moveVertex,
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
  category: 'Pavimenti' | 'Rivestimenti' | 'Colori';
  description: string;
  color?: string;
  pattern?: 'wood' | 'stone' | 'tile';
  previewUrl?: string;
};
type DragVertex = { surfaceId: string; vertexIndex: number; pointerId: number };

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

const kinds: SurfaceKind[] = ['wall', 'floor', 'ceiling', 'door', 'window', 'other'];
const kindColors: Record<SurfaceKind, string> = {
  wall: '#4f8f84', floor: '#bf8d58', ceiling: '#8ab8c2', door: '#8b6d9c', window: '#5d93b4', other: '#7f8985',
};

const guidedPresets: Array<Omit<Surface, 'id'>> = [
  { name: 'Muro 1', kind: 'wall', frozen: false, points: [{ x: .25, y: .2 }, { x: .75, y: .2 }, { x: .75, y: .68 }, { x: .25, y: .68 }] },
  { name: 'Muro 2', kind: 'wall', frozen: false, points: [{ x: .03, y: .05 }, { x: .25, y: .2 }, { x: .25, y: .68 }, { x: .03, y: .95 }] },
  { name: 'Muro 3', kind: 'wall', frozen: false, points: [{ x: .75, y: .2 }, { x: .97, y: .05 }, { x: .97, y: .95 }, { x: .75, y: .68 }] },
  { name: 'Pavimento', kind: 'floor', frozen: false, points: [{ x: .25, y: .68 }, { x: .75, y: .68 }, { x: .97, y: .95 }, { x: .03, y: .95 }] },
];

function createGuidedSurfaces() {
  return guidedPresets.map((surface, index) => ({ ...surface, id: `guided-${Date.now()}-${index}` }));
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
  const [furniture, setFurniture] = useState<string[]>([]);
  const [customRequests, setCustomRequests] = useState<string[]>([]);
  const [customColor, setCustomColor] = useState('#c8b9a6');
  const [renderSummaryOpen, setRenderSummaryOpen] = useState(false);
  const [simpleMode, setSimpleMode] = useState(true);
  const [activeStep, setActiveStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [dragVertex, setDragVertex] = useState<DragVertex | null>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);
  const pendingSourceTypeRef = useRef<SourceType>('photo');
  const materialInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const roomBlobRef = useRef<string | null>(null);
  const materialBlobRef = useRef<string | null>(null);
  const dragStartRef = useRef<Surface[] | null>(null);

  useEffect(() => {
    shellRef.current?.setAttribute('data-hydrated', 'true');
    return () => {
      if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
      if (materialBlobRef.current) URL.revokeObjectURL(materialBlobRef.current);
    };
  }, []);

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

  function importRoom(file?: File, sourceType: SourceType = pendingSourceTypeRef.current) {
    if (!file) return;
    const result = validateRoomFile(file);
    if (!result.ok) { setError(result.message); return; }
    if (!result.value.canPreview) {
      setError('Per disegnare subito usa una foto JPG o PNG. HEIC e PDF non sono ancora modificabili.');
      return;
    }
    if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
    const previewUrl = URL.createObjectURL(file);
    roomBlobRef.current = previewUrl;
    const initialSurfaces = sourceType === 'floorplan' ? createFloorplanOutline() : [];
    setRoom({ ...result.value, previewUrl, sourceType });
    setSurfaces(initialSurfaces); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(initialSurfaces[0]?.id ?? null); setRenameDraft(initialSurfaces[0]?.name ?? ''); setDraft([]); setDrawKind(null); setQuickDraw(false); setLineWallDraw(false); setError(null);
    setNotice(sourceType === 'floorplan'
      ? 'Planimetria riprodotta. Adatta il perimetro con i pallini e aggiungi le pareti interne con due tocchi.'
      : 'Foto pronta. Crea le superfici automaticamente oppure aggiungi un muro con quattro tocchi.');
    setActiveStep(2);
  }

  function chooseSourceType(sourceType: SourceType) {
    pendingSourceTypeRef.current = sourceType;
    roomInputRef.current?.click();
  }

  function onRoomInput(event: ChangeEvent<HTMLInputElement>) {
    importRoom(event.currentTarget.files?.[0]); event.currentTarget.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setIsDraggingFile(false); importRoom(event.dataTransfer.files?.[0]);
  }

  function removeRoom() {
    if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
    roomBlobRef.current = null;
    setRoom(null); setSurfaces([]); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(null); setDraft([]); setDrawKind(null); setQuickDraw(false); setLineWallDraw(false); setNotice(null);
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

  function finishSurface() {
    if (!drawKind) return;
    completeSurface(draft, drawKind);
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
    setDragVertex({ surfaceId, vertexIndex, pointerId: event.pointerId });
  }

  function moveDraggedVertex(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragVertex || event.pointerId !== dragVertex.pointerId) return;
    const point = eventPoint(event);
    setSurfaces((current) => current.map((surface) => surface.id === dragVertex.surfaceId ? moveVertex(surface, dragVertex.vertexIndex, point) : surface));
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
    <main ref={shellRef} className={`app-shell ${simpleMode ? `simple-mode step-${activeStep}` : 'advanced-mode'}`}>
      <header className="topbar">
        <a href="/projects" className="brand-lockup" aria-label="Vai ai progetti"><div className="brand-mark" aria-hidden="true"><span /><span /></div><div><p className="eyebrow">Studio materiali</p><p className="brand-name">Materia</p></div></a>
        <div className="project-heading"><span className="status-dot" /><div><p>{projectName}</p><span>{room ? `${room.sourceType === 'floorplan' ? 'Planimetria' : 'Foto'} · originale protetto` : 'Nuovo progetto locale'}</span></div></div>
        <div className="top-actions"><button className="mode-switch" type="button" onClick={() => setSimpleMode((current) => !current)}>{simpleMode ? 'Strumenti avanzati' : 'Modalità semplice'}</button><button className="avatar" type="button" aria-label="Profilo locale">AG</button></div>
      </header>

      {simpleMode && <nav className="simple-steps" aria-label="Passaggi del progetto">{[
        ['1', 'Foto'], ['2', 'Superfici'], ['3', 'Cerca'], ['4', 'Render'],
      ].map(([number, label], index) => <button type="button" key={number} className={activeStep === index + 1 ? 'is-active' : activeStep > index + 1 ? 'is-done' : ''} onClick={() => goToStep(index + 1)} disabled={(index > 0 && !room) || (index > 1 && surfaces.length === 0)}><span>{activeStep > index + 1 ? '✓' : number}</span><strong>{label}</strong></button>)}</nav>}

      <div className="workspace">
        <aside className="surface-panel" aria-label="Superfici della stanza">
          <div className="panel-heading"><div><p className="eyebrow">Geometria reale</p><h2>Superfici</h2></div><span className="count-badge">{surfaces.length}</span></div>
          <button className="detect-button" type="button" disabled><span className="spark">✦</span>Riconoscimento AI<span className="soon">Più avanti</span></button>
          {surfaces.length ? <div className="surface-list">{surfaces.map((surface) => <button className={`surface-item ${surface.id === selectedId ? 'is-active' : ''}`} key={surface.id} type="button" onClick={() => { setSelectedId(surface.id); setRenameDraft(surface.name); setDrawKind(null); setQuickDraw(false); setDraft([]); }}><span className="surface-swatch" style={{ background: kindColors[surface.kind] }} /><span className="surface-copy"><strong>{surface.name}</strong><small>{surface.points.length} vertici · {surface.materialId ? 'materiale applicato' : 'senza materiale'}</small></span><span className="lock-state" aria-label={surface.frozen ? 'Bloccata' : 'Modificabile'}>{surface.frozen ? '◆' : '◇'}</span></button>)}</div> : <div className="surface-empty"><span>◇</span><strong>Partenza semplice</strong><p>Crea automaticamente i contorni base e sposta soltanto i pallini.</p></div>}
          <div className="panel-note"><span>i</span><p>Il riconoscimento automatico non è ancora collegato. Tutti i contorni sono modificabili manualmente.</p></div>
        </aside>

        <section className="stage" aria-labelledby="editor-title">
          <div className="editor-toolbar">
            <div className="tool-group"><button className={`tool-button ${!drawKind ? 'is-selected' : ''}`} type="button" onClick={cancelDrawing} aria-label="Seleziona">↖</button><button className="tool-button history-button" type="button" onClick={undo} disabled={!pastSurfaces.length} aria-label="Annulla ultima modifica">↶</button><button className="tool-button history-button" type="button" onClick={redo} disabled={!futureSurfaces.length} aria-label="Ripristina modifica">↷</button>{room?.sourceType === 'floorplan' ? <button className={`draw-button easy-draw-button ${lineWallDraw ? 'is-selected' : ''}`} type="button" onClick={startFloorplanWall}>＋ Parete con 2 tocchi</button> : <button className={`draw-button easy-draw-button ${quickDraw ? 'is-selected' : ''}`} type="button" onClick={() => startDrawing('wall', true)} disabled={!room}>＋ Aggiungi muro facile</button>}<button className={`advanced-draw-button ${drawKind && !quickDraw && !lineWallDraw ? 'is-selected' : ''}`} type="button" aria-label="Avanzato" onClick={() => startDrawing('wall', false)} disabled={!room}>Disegno libero</button>{drawKind && !quickDraw && !lineWallDraw && <select className="kind-select" aria-label="Tipo superficie" value={drawKind} onChange={(event) => { setDrawKind(event.target.value as SurfaceKind); setDraft([]); }}>{kinds.map((kind) => <option value={kind} key={kind}>{surfaceLabels[kind]}</option>)}</select>}</div>
            {drawKind ? <div className="drawing-actions"><span>{lineWallDraw ? `${draft.length}/2 punti` : quickDraw ? `${draft.length}/4 angoli` : `${draft.length} punti`}</span><button type="button" onClick={cancelDrawing}>Annulla</button>{!quickDraw && !lineWallDraw && <button className="finish-button" type="button" onClick={finishSurface} disabled={draft.length < 3}>Chiudi superficie</button>}</div> : <span className="mode-label">{selected ? `Selezionata: ${selected.name}` : room?.sourceType === 'floorplan' ? 'Tocca “Parete con 2 tocchi” per ricalcare i divisori' : room ? 'Scegli “muro facile” o la creazione automatica' : 'Carica una foto o una planimetria per iniziare'}</span>}
          </div>

          <div className="canvas-wrap"><div className={`canvas ${isDraggingFile ? 'is-dragging' : ''}`} id="editor-title" style={room ? { aspectRatio: roomRatio } : undefined} onDragEnter={() => setIsDraggingFile(true)} onDragLeave={() => setIsDraggingFile(false)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            {room?.previewUrl ? <div className="editor-media">
              <img src={room.previewUrl} alt={`Originale importato: ${room.file.name}`} onLoad={(event) => setRoomRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
              <svg className={`surface-overlay ${drawKind ? 'is-drawing' : ''}`} viewBox="0 0 1000 625" preserveAspectRatio="none" onPointerDown={addDraftPoint} onPointerMove={moveDraggedVertex} onPointerUp={endVertexDrag} onPointerCancel={endVertexDrag}>
                <defs>
                  {catalogMaterials.filter((item) => item.pattern).map((item) => <pattern id={`catalog-material-${item.id}`} key={item.id} width={item.pattern === 'wood' ? 180 : 120} height={item.pattern === 'wood' ? 42 : 120} patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill={item.color} /><path d={item.pattern === 'wood' ? 'M0 2H180 M0 40H180 M45 2V40 M135 2V40' : 'M0 1H120 M1 0V120'} stroke="rgba(67,55,43,.22)" strokeWidth="3" /><path d={item.pattern === 'stone' ? 'M8 38 C38 17 64 55 110 25 M14 92 C45 68 77 106 116 74' : ''} fill="none" stroke="rgba(255,255,255,.24)" strokeWidth="5" /></pattern>)}
                  {material?.previewUrl && <pattern id={`uploaded-material-${material.id}`} width="140" height="140" patternUnits="userSpaceOnUse"><image href={material.previewUrl} width="140" height="140" preserveAspectRatio="xMidYMid slice" /></pattern>}
                </defs>
                {surfaces.map((surface) => <g key={surface.id} className={surface.frozen ? 'is-frozen' : ''}><polygon points={pointsToSvg(surface.points)} fill={materialFill(surface)} stroke={surface.id === selectedId ? '#d7f05c' : kindColors[surface.kind]} strokeWidth={surface.id === selectedId ? 6 : 3} vectorEffect="non-scaling-stroke" onPointerDown={(event) => { if (!drawKind) { event.stopPropagation(); setSelectedId(surface.id); setRenameDraft(surface.name); setQuickDraw(false); } }} />{surface.id === selectedId && surface.points.map((point, index) => <circle key={`${surface.id}-${index}`} cx={point.x * 1000} cy={point.y * 625} r="10" className="surface-vertex" onPointerDown={(event) => beginVertexDrag(event, surface.id, index)} />)}</g>)}
                {draft.length > 0 && <><polyline points={pointsToSvg(draft)} fill="none" stroke="#d7f05c" strokeWidth="5" vectorEffect="non-scaling-stroke" />{draft.map((point, index) => <circle key={index} cx={point.x * 1000} cy={point.y * 625} r="9" className="draft-vertex" />)}</>}
              </svg><div className="import-status"><span className="status-dot" /><div><strong>Originale intatto</strong><small>{importedCaption}</small></div></div>
            </div> : <><div className="room-demo" aria-label="Anteprima schematica della stanza"><div className="room-ceiling"><span>Soffitto</span></div><div className="room-wall left"><span>Muro 2</span></div><div className="room-wall center"><span>Muro 1</span></div><div className="room-wall right"><span>Muro 3</span></div><div className="room-floor"><span>Pavimento</span></div></div><div className="upload-card"><div className="upload-icon">↑</div><p className="eyebrow">Inizia da ciò che hai</p><h1>Cosa vuoi caricare?</h1><p>Scegli una foto della stanza oppure una planimetria. L’originale resterà sempre intatto.</p><div className="source-actions"><button className="source-card is-primary" type="button" onClick={() => chooseSourceType('photo')}><span>▣</span><strong>Foto stanza</strong><small>Per cambiare muri, pavimento e arredi</small></button><button className="source-card" type="button" onClick={() => chooseSourceType('floorplan')}><span>⌗</span><strong>Planimetria</strong><small>Per ricalcare perimetro e pareti interne</small></button></div><button className="demo-button" type="button" onClick={loadDemoRoom}>Prova con la stanza esempio</button><small>JPG o PNG · massimo 20 MB</small></div></>}
            {isDraggingFile && <div className="drop-overlay"><strong>Rilascia per importare</strong><span>La foto resterà nel browser.</span></div>}
          </div>{error && <div className="file-error" role="alert"><strong>Operazione non completata</strong><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Chiudi errore">×</button></div>}</div>
          <input ref={roomInputRef} id="room-file" className="visually-hidden" type="file" accept="image/jpeg,image/png" onChange={onRoomInput} /><input ref={materialInputRef} id="material-file" className="visually-hidden" type="file" accept="image/jpeg,image/png" onChange={onMaterialInput} />
          <div className="status-bar"><span className="status-icon">{notice ? '✓' : 'i'}</span><p>{notice ?? 'L’originale resta sotto i contorni e non viene modificato.'}</p>{room?.sourceType === 'photo' && surfaces.length === 0 && <button className="guided-start-button" type="button" aria-label="Crea 3 muri + pavimento" onClick={seedGuidedSurfaces}>Crea superfici automaticamente</button>}{room?.sourceType === 'floorplan' && simpleMode && activeStep === 2 && !drawKind && <button type="button" onClick={startFloorplanWall}>Aggiungi parete interna</button>}{room && surfaces.length > 0 && (!simpleMode || activeStep === 4) && <button className="render-flow-button" type="button" aria-label="Prova flusso render" onClick={() => setRenderSummaryOpen(true)}>Controlla e crea render</button>}{simpleMode && activeStep === 2 && surfaces.length > 0 && <button type="button" onClick={() => goToStep(3)}>Continua: cerca materiali</button>}{simpleMode && activeStep === 3 && <button className="render-flow-button" type="button" aria-label="Prova flusso render" onClick={() => goToStep(4)}>Continua: crea render</button>}</div>
        </section>

        <aside className="properties-panel" aria-label="Proprietà">
          <div className="panel-heading"><div><p className="eyebrow">Controlli</p><h2>{selected?.name ?? (room ? 'Nessuna selezione' : 'Importa una stanza')}</h2></div>{selected && <span className="type-badge">{surfaceLabels[selected.kind]}</span>}</div>
          {room && <div className="asset-card"><span>{room.sourceType === 'floorplan' ? 'PLAN' : 'IMG'}</span><div><strong>{room.file.name}</strong><small>{room.sourceType === 'floorplan' ? 'Planimetria originale' : importedCaption}</small></div><button type="button" onClick={() => chooseSourceType(room.sourceType)}>Sostituisci</button></div>}
          {selected ? <><div className="property-section"><div className="property-title"><span>Nome superficie</span><span className="editable-badge">Personalizzabile</span></div><div className="rename-control"><input aria-label="Nome superficie" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} /><button type="button" onClick={renameSelected} disabled={!renameDraft.trim() || renameDraft.trim() === selected.name}>Salva</button></div></div><div className="property-section"><div className="property-title"><span>Protezione superficie</span><span className={`editable-badge ${selected.frozen ? 'frozen' : ''}`}>{selected.frozen ? 'Frozen' : 'Modificabile'}</span></div><button className={`freeze-button ${selected.frozen ? 'is-active' : ''}`} type="button" aria-label={selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'} onClick={toggleFreeze}><span>{selected.frozen ? '◆' : '◇'}</span>{selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'}<small>{selected.frozen ? 'Protetta' : 'Attivo subito'}</small></button><button className="freeze-others-button" type="button" onClick={freezeAllExceptSelected}>Blocca tutto tranne {selected.name}</button></div>
            <div className="property-section"><div className="property-title"><span>Ricerca unica</span><button type="button" onClick={() => materialInputRef.current?.click()}>Carica foto</button></div><input className="material-search" aria-label="Cerca materiali, colori o mobili" value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder="Cerca pavimento, colore, divano, cucina…" /><div className="search-scope"><span>Materiali</span><span>Colori</span><span>Mobili</span><span className="internet-pending">Internet dopo la chiave</span></div><div className="material-results">{filteredMaterials.map((item) => <button type="button" key={item.id} className={`material-result ${material?.id === item.id ? 'is-selected' : ''}`} onClick={() => chooseMaterial(item)}><span className={`catalog-swatch ${item.pattern ?? 'color'}`} style={{ '--swatch-color': item.color } as CSSProperties} /><span><strong>{item.name}</strong><small>{item.category} · {item.description}</small></span></button>)}{filteredFurniture.map((item) => <button type="button" key={item.name} className={`material-result furniture-result ${furniture.includes(item.name) ? 'is-selected' : ''}`} onClick={() => toggleFurniture(item.name)}><span className="furniture-icon">{furniture.includes(item.name) ? '✓' : '+'}</span><span><strong>{item.name}</strong><small>Mobili · {item.description}</small></span></button>)}{filteredMaterials.length === 0 && filteredFurniture.length === 0 && <div className="custom-search-result"><p>Nessun elemento locale con questo nome.</p><button type="button" onClick={addCustomRequest}>Aggiungi “{materialQuery.trim()}” al render</button></div>}</div><div className="custom-color"><input type="color" aria-label="Scegli colore personalizzato" value={customColor} onChange={(event) => setCustomColor(event.target.value)} /><button type="button" onClick={chooseCustomColor}>Usa questo colore</button></div>{material?.previewUrl && <div className="loaded-material"><img src={material.previewUrl} alt="Campione materiale" /><div><strong>{material.name}</strong><small>{material.description}</small></div></div>}<button className="apply-button" type="button" aria-label={`Applica a ${selected.name}`} onClick={applyMaterial} disabled={!material || selected.frozen}>Applica {material?.name ?? 'materiale'} a {selected.name}</button><p className="material-search-note">Puoi già configurare tutto. Con la chiave, la stessa ricerca cercherà anche prodotti reali su internet mostrando marca e fonte.</p></div>
            <div className="property-section"><div className="property-title"><span>Elementi nel render</span><span className="editable-badge">{furniture.length + customRequests.length} scelti</span></div>{furniture.length || customRequests.length ? <div className="selected-assets">{furniture.map((item) => <button type="button" key={item} onClick={() => toggleFurniture(item)}>{item}<span>×</span></button>)}{customRequests.map((item) => <button type="button" key={item} onClick={() => setCustomRequests((current) => current.filter((name) => name !== item))}>{item}<span>×</span></button>)}</div> : <p className="no-results">Cerca un mobile o scrivi liberamente ciò che vuoi inserire.</p>}<p className="material-search-note">Con il motore AI potrai caricare anche la foto esatta del mobile e indicarne la posizione.</p></div>
            <div className="property-section metrics"><div><span>Vertici</span><strong>{selected.points.length}</strong></div><div><span>Stato</span><strong>{selected.frozen ? 'Lock' : 'Edit'}</strong></div><div><span>Texture</span><strong>{selected.materialId ? 'Sì' : 'No'}</strong></div></div><button className="remove-button" type="button" onClick={deleteSelected} disabled={selected.frozen}>Elimina superficie</button></> : room ? <div className="empty-properties"><strong>Seleziona un contorno</strong><p>Tocca una superficie sulla foto o sceglila dall’elenco. Puoi anche disegnarne una nuova.</p></div> : null}
          {room && <button className="remove-room-button" type="button" onClick={removeRoom}>Chiudi progetto</button>}
          <div className="phase-card"><span className="phase-index">0.2</span><div><p className="eyebrow">Modalità prova</p><strong>Progetto render configurabile</strong><p>Materiali, colori, mobili e Freeze funzionano. La generazione fotografica richiederà la chiave AI.</p></div></div>
        </aside>
      </div>
      {renderSummaryOpen && <div className="render-modal" role="dialog" aria-modal="true" aria-labelledby="render-summary-title"><div className="render-modal-card"><button className="modal-close" type="button" onClick={() => setRenderSummaryOpen(false)} aria-label="Chiudi riepilogo">×</button><p className="eyebrow">Richiesta pronta</p><h2 id="render-summary-title">Prima del render reale</h2><div className="render-checks"><div><span>Superfici con materiale</span><strong>{surfaces.filter((surface) => surface.materialId).length}</strong></div><div><span>Zone protette</span><strong>{surfaces.filter((surface) => surface.frozen).length}</strong></div><div><span>Elementi richiesti</span><strong>{furniture.length + customRequests.length}</strong></div></div><div className="render-list"><strong>Il motore riceverà:</strong><p>{surfaces.filter((surface) => surface.materialId).map((surface) => `${surface.name}: ${materialMap.get(surface.materialId!)?.name ?? 'materiale'}`).join(' · ') || 'Nessun materiale ancora applicato'}</p><p>{furniture.length || customRequests.length ? `Da inserire: ${[...furniture, ...customRequests].join(', ')}` : 'Nessun arredo aggiunto'}</p></div><div className="engine-warning"><span>AI</span><p><strong>Render fotografico non ancora collegato</strong>Questa schermata prepara una richiesta reale, ma non inventa un’immagine. Dopo la chiave, lo stesso pulsante genererà il risultato.</p></div><button className="modal-primary" type="button" onClick={() => setRenderSummaryOpen(false)}>Continua a configurare</button></div></div>}
    </main>
  );
}
