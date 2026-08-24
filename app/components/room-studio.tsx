'use client';

/* eslint-disable @next/next/no-img-element -- room and material previews are local blob URLs */

import {
  ChangeEvent,
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

type ImportedRoom = AcceptedRoomFile & { previewUrl?: string };
type LocalMaterial = { id: string; name: string; previewUrl: string };
type DragVertex = { surfaceId: string; vertexIndex: number; pointerId: number };

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
  const [draft, setDraft] = useState<Point[]>([]);
  const [material, setMaterial] = useState<LocalMaterial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [dragVertex, setDragVertex] = useState<DragVertex | null>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);
  const materialInputRef = useRef<HTMLInputElement>(null);
  const roomBlobRef = useRef<string | null>(null);
  const materialBlobRef = useRef<string | null>(null);
  const dragStartRef = useRef<Surface[] | null>(null);

  useEffect(() => () => {
    if (roomBlobRef.current) URL.revokeObjectURL(roomBlobRef.current);
    if (materialBlobRef.current) URL.revokeObjectURL(materialBlobRef.current);
  }, []);

  const selected = surfaces.find((surface) => surface.id === selectedId) ?? null;
  const projectName = room?.projectName ?? 'Progetto senza titolo';
  const importedCaption = useMemo(() => room ? `Immagine · ${room.displaySize}` : null, [room]);

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

  function importRoom(file?: File) {
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
    setRoom({ ...result.value, previewUrl });
    setSurfaces([]); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(null); setDraft([]); setDrawKind(null); setError(null);
    setNotice('Foto pronta. Scegli “Disegna superficie” e tocca almeno tre punti.');
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
    setRoom(null); setSurfaces([]); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(null); setDraft([]); setDrawKind(null); setNotice(null);
  }

  function startDrawing(kind: SurfaceKind = 'wall') {
    if (!room) return;
    setDrawKind(kind); setDraft([]); setSelectedId(null); setRenameDraft('');
    setNotice(`Disegno ${surfaceLabels[kind].toLowerCase()}: tocca i vertici e poi “Chiudi superficie”.`);
  }

  function addDraftPoint(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drawKind || dragVertex) return;
    const point = eventPoint(event);
    setDraft((points) => [...points, point]);
  }

  function finishSurface() {
    if (!drawKind || !isValidPolygon(draft)) {
      setError('Servono almeno tre punti non allineati per chiudere la superficie.'); return;
    }
    const id = `surface-${Date.now()}-${surfaces.length}`;
    const surface: Surface = { id, name: nextSurfaceName(drawKind, surfaces), kind: drawKind, points: draft, frozen: false };
    commitSurfaces([...surfaces, surface]); setSelectedId(id); setRenameDraft(surface.name); setDraft([]); setDrawKind(null); setError(null);
    setNotice(`${surface.name} creata. Trascina i punti per correggerla.`);
  }

  function cancelDrawing() { setDraft([]); setDrawKind(null); setNotice(null); }

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
    const next = { id: `material-${Date.now()}`, name: file.name.replace(/\.[^.]+$/, ''), previewUrl };
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

  function seedGuidedSurfaces() {
    if (!room || surfaces.length > 0) return;
    const created = createGuidedSurfaces();
    commitSurfaces(created); setSelectedId(created[0].id); setRenameDraft(created[0].name);
    setNotice('Tracciatura guidata inserita. Adatta ogni vertice alla fotografia trascinandolo.');
  }

  function loadDemoRoom() {
    const file = new File(['demo'], 'stanza-esempio.png', { type: 'image/png' });
    const created = createGuidedSurfaces();
    setRoom({ file, kind: 'image', canPreview: true, displaySize: 'esempio incluso', projectName: 'Stanza esempio', previewUrl: '/og.png' });
    setRoomRatio(16 / 9); setSurfaces(created); setPastSurfaces([]); setFutureSurfaces([]); setSelectedId(created[0].id); setRenameDraft(created[0].name); setError(null);
    setNotice('Esempio pronto. Prova a spostare i vertici, bloccare un muro o caricare un campione.');
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a href="/projects" className="brand-lockup" aria-label="Vai ai progetti"><div className="brand-mark" aria-hidden="true"><span /><span /></div><div><p className="eyebrow">Studio materiali</p><p className="brand-name">Materia</p></div></a>
        <div className="project-heading"><span className="status-dot" /><div><p>{projectName}</p><span>{room ? 'Editor manuale attivo · originale protetto' : 'Nuovo progetto locale'}</span></div></div>
        <div className="top-actions"><a className="ghost-button" href="/projects">Tutti i progetti</a><button className="avatar" type="button" aria-label="Profilo locale">AG</button></div>
      </header>

      <div className="workspace">
        <aside className="surface-panel" aria-label="Superfici della stanza">
          <div className="panel-heading"><div><p className="eyebrow">Geometria reale</p><h2>Superfici</h2></div><span className="count-badge">{surfaces.length}</span></div>
          <button className="detect-button" type="button" disabled><span className="spark">✦</span>Riconoscimento AI<span className="soon">Più avanti</span></button>
          {surfaces.length ? <div className="surface-list">{surfaces.map((surface) => <button className={`surface-item ${surface.id === selectedId ? 'is-active' : ''}`} key={surface.id} type="button" onClick={() => { setSelectedId(surface.id); setRenameDraft(surface.name); setDrawKind(null); setDraft([]); }}><span className="surface-swatch" style={{ background: kindColors[surface.kind] }} /><span className="surface-copy"><strong>{surface.name}</strong><small>{surface.points.length} vertici · {surface.materialId ? 'materiale applicato' : 'senza materiale'}</small></span><span className="lock-state" aria-label={surface.frozen ? 'Bloccata' : 'Modificabile'}>{surface.frozen ? '◆' : '◇'}</span></button>)}</div> : <div className="surface-empty"><span>◇</span><strong>Disegna la prima superficie</strong><p>Parti da zero o usa la tracciatura guidata e correggi i punti.</p></div>}
          <div className="panel-note"><span>i</span><p>Il riconoscimento automatico non è ancora collegato. Tutti i contorni sono modificabili manualmente.</p></div>
        </aside>

        <section className="stage" aria-labelledby="editor-title">
          <div className="editor-toolbar">
            <div className="tool-group"><button className={`tool-button ${!drawKind ? 'is-selected' : ''}`} type="button" onClick={cancelDrawing} aria-label="Seleziona">↖</button><button className="tool-button history-button" type="button" onClick={undo} disabled={!pastSurfaces.length} aria-label="Annulla ultima modifica">↶</button><button className="tool-button history-button" type="button" onClick={redo} disabled={!futureSurfaces.length} aria-label="Ripristina modifica">↷</button><button className={`draw-button ${drawKind ? 'is-selected' : ''}`} type="button" onClick={() => startDrawing(drawKind ?? 'wall')} disabled={!room}>＋ Disegna superficie</button>{drawKind && <select className="kind-select" aria-label="Tipo superficie" value={drawKind} onChange={(event) => { setDrawKind(event.target.value as SurfaceKind); setDraft([]); }}>{kinds.map((kind) => <option value={kind} key={kind}>{surfaceLabels[kind]}</option>)}</select>}</div>
            {drawKind ? <div className="drawing-actions"><span>{draft.length} punti</span><button type="button" onClick={cancelDrawing}>Annulla</button><button className="finish-button" type="button" onClick={finishSurface} disabled={draft.length < 3}>Chiudi superficie</button></div> : <span className="mode-label">{selected ? `Selezionata: ${selected.name}` : room ? 'Seleziona o disegna una superficie' : 'Carica una fotografia per iniziare'}</span>}
          </div>

          <div className="canvas-wrap"><div className={`canvas ${isDraggingFile ? 'is-dragging' : ''}`} id="editor-title" style={room ? { aspectRatio: roomRatio } : undefined} onDragEnter={() => setIsDraggingFile(true)} onDragLeave={() => setIsDraggingFile(false)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            {room?.previewUrl ? <div className="editor-media">
              <img src={room.previewUrl} alt={`Originale importato: ${room.file.name}`} onLoad={(event) => setRoomRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
              <svg className={`surface-overlay ${drawKind ? 'is-drawing' : ''}`} viewBox="0 0 1000 625" preserveAspectRatio="none" onPointerDown={addDraftPoint} onPointerMove={moveDraggedVertex} onPointerUp={endVertexDrag} onPointerCancel={endVertexDrag}>
                <defs>{material && <pattern id="active-material" width="140" height="140" patternUnits="userSpaceOnUse"><image href={material.previewUrl} width="140" height="140" preserveAspectRatio="xMidYMid slice" /></pattern>}</defs>
                {surfaces.map((surface) => <g key={surface.id} className={surface.frozen ? 'is-frozen' : ''}><polygon points={pointsToSvg(surface.points)} fill={surface.materialId && material?.id === surface.materialId ? 'url(#active-material)' : `${kindColors[surface.kind]}44`} stroke={surface.id === selectedId ? '#d7f05c' : kindColors[surface.kind]} strokeWidth={surface.id === selectedId ? 6 : 3} vectorEffect="non-scaling-stroke" onPointerDown={(event) => { if (!drawKind) { event.stopPropagation(); setSelectedId(surface.id); setRenameDraft(surface.name); } }} />{surface.id === selectedId && surface.points.map((point, index) => <circle key={`${surface.id}-${index}`} cx={point.x * 1000} cy={point.y * 625} r="10" className="surface-vertex" onPointerDown={(event) => beginVertexDrag(event, surface.id, index)} />)}</g>)}
                {draft.length > 0 && <><polyline points={pointsToSvg(draft)} fill="none" stroke="#d7f05c" strokeWidth="5" vectorEffect="non-scaling-stroke" />{draft.map((point, index) => <circle key={index} cx={point.x * 1000} cy={point.y * 625} r="9" className="draft-vertex" />)}</>}
              </svg><div className="import-status"><span className="status-dot" /><div><strong>Originale intatto</strong><small>{importedCaption}</small></div></div>
            </div> : <><div className="room-demo" aria-label="Anteprima schematica della stanza"><div className="room-ceiling"><span>Soffitto</span></div><div className="room-wall left"><span>Muro 2</span></div><div className="room-wall center"><span>Muro 1</span></div><div className="room-wall right"><span>Muro 3</span></div><div className="room-floor"><span>Pavimento</span></div></div><div className="upload-card"><div className="upload-icon">↑</div><p className="eyebrow">Versione operativa</p><h1>Carica la stanza</h1><p>Usa una foto JPG o PNG. Poi disegna o adatta i contorni delle superfici.</p><label className="primary-button" htmlFor="room-file">Scegli una fotografia</label><button className="demo-button" type="button" onClick={loadDemoRoom}>Prova con la stanza esempio</button><small>oppure trascina il file qui</small><small>JPG o PNG · massimo 20 MB</small></div></>}
            {isDraggingFile && <div className="drop-overlay"><strong>Rilascia per importare</strong><span>La foto resterà nel browser.</span></div>}
          </div>{error && <div className="file-error" role="alert"><strong>Operazione non completata</strong><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Chiudi errore">×</button></div>}</div>
          <input ref={roomInputRef} id="room-file" className="visually-hidden" type="file" accept="image/jpeg,image/png" onChange={onRoomInput} /><input ref={materialInputRef} id="material-file" className="visually-hidden" type="file" accept="image/jpeg,image/png" onChange={onMaterialInput} />
          <div className="status-bar"><span className="status-icon">{notice ? '✓' : 'i'}</span><p>{notice ?? 'La foto originale resta sotto le superfici e non viene modificata.'}</p>{room && surfaces.length === 0 && <button type="button" onClick={seedGuidedSurfaces}>Inserisci tracciatura guidata</button>}</div>
        </section>

        <aside className="properties-panel" aria-label="Proprietà">
          <div className="panel-heading"><div><p className="eyebrow">Controlli</p><h2>{selected?.name ?? (room ? 'Nessuna selezione' : 'Importa una stanza')}</h2></div>{selected && <span className="type-badge">{surfaceLabels[selected.kind]}</span>}</div>
          {room && <div className="asset-card"><span>IMG</span><div><strong>{room.file.name}</strong><small>{importedCaption}</small></div><button type="button" onClick={() => roomInputRef.current?.click()}>Sostituisci</button></div>}
          {selected ? <><div className="property-section"><div className="property-title"><span>Nome superficie</span><span className="editable-badge">Personalizzabile</span></div><div className="rename-control"><input aria-label="Nome superficie" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} /><button type="button" onClick={renameSelected} disabled={!renameDraft.trim() || renameDraft.trim() === selected.name}>Salva</button></div></div><div className="property-section"><div className="property-title"><span>Protezione superficie</span><span className={`editable-badge ${selected.frozen ? 'frozen' : ''}`}>{selected.frozen ? 'Frozen' : 'Modificabile'}</span></div><button className={`freeze-button ${selected.frozen ? 'is-active' : ''}`} type="button" aria-label={selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'} onClick={toggleFreeze}><span>{selected.frozen ? '◆' : '◇'}</span>{selected.frozen ? 'Sblocca superficie' : 'Freeze superficie'}<small>{selected.frozen ? 'Protetta' : 'Attivo subito'}</small></button><button className="freeze-others-button" type="button" onClick={freezeAllExceptSelected}>Blocca tutto tranne {selected.name}</button></div>
            <div className="property-section"><div className="property-title"><span>Materiale locale</span><button type="button" onClick={() => materialInputRef.current?.click()}>Carica campione</button></div>{material ? <div className="loaded-material"><img src={material.previewUrl} alt="Campione materiale" /><div><strong>{material.name}</strong><small>JPG/PNG locale</small></div></div> : <div className="material-empty"><div className="material-sample" /><div><strong>Nessun campione</strong><p>Carica la foto ravvicinata di una finitura.</p></div></div>}<button className="apply-button" type="button" onClick={applyMaterial} disabled={!material || selected.frozen}>Applica a {selected.name}</button><p className="material-search-note">Ricerca per nome e cataloghi online: prevista dopo il database materiali.</p></div>
            <div className="property-section metrics"><div><span>Vertici</span><strong>{selected.points.length}</strong></div><div><span>Stato</span><strong>{selected.frozen ? 'Lock' : 'Edit'}</strong></div><div><span>Texture</span><strong>{selected.materialId ? 'Sì' : 'No'}</strong></div></div><button className="remove-button" type="button" onClick={deleteSelected} disabled={selected.frozen}>Elimina superficie</button></> : room ? <div className="empty-properties"><strong>Seleziona un contorno</strong><p>Tocca una superficie sulla foto o sceglila dall’elenco. Puoi anche disegnarne una nuova.</p></div> : null}
          {room && <button className="remove-room-button" type="button" onClick={removeRoom}>Chiudi progetto</button>}
          <div className="phase-card"><span className="phase-index">0.1</span><div><p className="eyebrow">Versione di prova</p><strong>Editor manuale funzionante</strong><p>Disegno, correzione, Freeze e materiali locali. AI e ricerca online non ancora attive.</p></div></div>
        </aside>
      </div>
    </main>
  );
}
