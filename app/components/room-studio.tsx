'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AcceptedRoomFile, validateRoomFile } from '../lib/file-validation';

const demoSurfaces = [
  { name: 'Muro 1', tone: 'cool', confidence: '98%', vertices: 4 },
  { name: 'Muro 2', tone: 'warm', confidence: '94%', vertices: 4 },
  { name: 'Muro 3', tone: 'cool', confidence: '91%', vertices: 4 },
  { name: 'Pavimento', tone: 'accent', confidence: '96%', vertices: 4 },
  { name: 'Soffitto', tone: 'quiet', confidence: '89%', vertices: 4 },
];

type ImportedRoom = AcceptedRoomFile & { previewUrl?: string };

export function RoomStudio() {
  const [room, setRoom] = useState<ImportedRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedSurface, setSelectedSurface] = useState(3);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (room?.previewUrl) URL.revokeObjectURL(room.previewUrl);
  }, [room]);

  const activeSurface = demoSurfaces[selectedSurface];
  const projectName = room?.projectName ?? 'Progetto senza titolo';
  const surfaces = room ? [] : demoSurfaces;
  const importedCaption = useMemo(() => room ? `${room.kind === 'pdf' ? 'Documento PDF' : 'Immagine'} · ${room.displaySize}` : null, [room]);

  function importFile(file?: File) {
    if (!file) return;
    const result = validateRoomFile(file);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setRoom((previous) => {
      if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
      return { ...result.value, previewUrl: result.value.canPreview ? URL.createObjectURL(file) : undefined };
    });
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    importFile(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    importFile(event.dataTransfer.files?.[0]);
  }

  function removeRoom() {
    setRoom(null);
    setError(null);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a href="/projects" className="brand-lockup" aria-label="Vai ai progetti">
          <div className="brand-mark" aria-hidden="true"><span /><span /></div>
          <div><p className="eyebrow">Studio materiali</p><p className="brand-name">Materia</p></div>
        </a>
        <div className="project-heading">
          <span className="status-dot" aria-hidden="true" />
          <div><p>{projectName}</p><span>{room ? 'Originale pronto · solo locale' : 'Bozza salvata localmente'}</span></div>
        </div>
        <div className="top-actions">
          <a className="ghost-button" href="/projects">Tutti i progetti</a>
          <button className="avatar" type="button" aria-label="Profilo locale">AG</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="surface-panel" aria-label="Superfici della stanza">
          <div className="panel-heading"><div><p className="eyebrow">Geometria</p><h2>Superfici</h2></div><span className="count-badge">{surfaces.length}</span></div>
          <button className="detect-button" type="button" disabled><span className="spark" aria-hidden="true">✦</span>Riconosci stanza<span className="soon">Fase 6</span></button>
          {surfaces.length > 0 ? (
            <div className="surface-list">
              {surfaces.map((surface, index) => (
                <button className={`surface-item ${index === selectedSurface ? 'is-active' : ''}`} key={surface.name} type="button" onClick={() => setSelectedSurface(index)}>
                  <span className={`surface-swatch ${surface.tone}`} />
                  <span className="surface-copy"><strong>{surface.name}</strong><small>{surface.confidence} confidenza</small></span>
                  <span className="lock-state" aria-label="Modificabile">○</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="surface-empty"><span aria-hidden="true">◇</span><strong>Nessuna superficie</strong><p>Il riconoscimento sarà aggiunto nella Fase 6. L’originale non viene interpretato ora.</p></div>
          )}
          <div className="panel-note"><span aria-hidden="true">i</span><p>{room ? 'Il file resta nel browser e non viene inviato a servizi esterni.' : 'Le superfici demo mostrano soltanto la futura struttura dell’editor.'}</p></div>
        </aside>

        <section className="stage" aria-labelledby="editor-title">
          <div className="editor-toolbar">
            <div className="tool-group"><button className="tool-button is-selected" type="button" aria-label="Seleziona">↖</button><button className="tool-button" type="button" aria-label="Sposta vista" disabled>✣</button><span className="tool-divider" /><button className="tool-button text-tool" type="button" disabled>Smart Edge</button></div>
            <div className="zoom-control" aria-label="Controlli zoom"><button type="button" disabled>−</button><span>100%</span><button type="button" disabled>+</button></div>
          </div>

          <div className="canvas-wrap">
            <div className={`canvas ${isDragging ? 'is-dragging' : ''}`} id="editor-title" onDragEnter={() => setIsDragging(true)} onDragLeave={() => setIsDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
              {room ? (
                <div className="imported-room">
                  {room.previewUrl ? (
                    // Blob locali di sessione non possono passare dal loader immagini remoto.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={room.previewUrl} alt={`Originale importato: ${room.file.name}`} />
                  ) : <div className="document-preview"><span>{room.kind === 'pdf' ? 'PDF' : 'HEIC'}</span><strong>{room.file.name}</strong><p>L’originale è valido. L’anteprima di questo formato sarà elaborata in una fase successiva.</p></div>}
                  <div className="import-status"><span className="status-dot" /><div><strong>Originale importato</strong><small>{importedCaption}</small></div></div>
                  <button className="replace-button" type="button" onClick={() => inputRef.current?.click()}>Sostituisci file</button>
                </div>
              ) : (
                <>
                  <div className="room-demo" aria-label="Anteprima schematica della stanza">
                    <div className="room-ceiling"><span>Soffitto</span></div><div className="room-wall left"><span>Muro 2</span></div><div className="room-wall center"><span>Muro 1</span></div><div className="room-wall right"><span>Muro 3</span></div><div className="room-floor"><span>Pavimento</span></div>
                    <span className="vertex v1" /><span className="vertex v2" /><span className="vertex v3" /><span className="vertex v4" />
                  </div>
                  <div className="upload-card"><div className="upload-icon" aria-hidden="true">↑</div><p className="eyebrow">Inizia dall’originale</p><h1>Carica la stanza</h1><p>Una foto nitida è sufficiente per iniziare. L’originale resterà sempre intatto.</p><label className="primary-button" htmlFor="room-file">Scegli una foto o un PDF</label><small>oppure trascina il file qui</small><small>JPG, PNG, HEIC o PDF · massimo 20 MB</small></div>
                </>
              )}
              {isDragging && <div className="drop-overlay"><strong>Rilascia per importare</strong><span>Il file resterà soltanto in questa sessione.</span></div>}
            </div>
            {error && <div className="file-error" role="alert"><strong>File non importato</strong><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Chiudi errore">×</button></div>}
          </div>
          <input ref={inputRef} id="room-file" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf,.heic,.heif" onChange={onInputChange} />
          <div className="command-bar"><span className="command-icon" aria-hidden="true">⌘</span><input aria-label="Comando naturale" disabled placeholder="Es. Muro 2 in travertino beige" /><span className="soon">Disponibile più avanti</span></div>
        </section>

        <aside className="properties-panel" aria-label="Proprietà">
          {room ? (
            <>
              <div className="panel-heading"><div><p className="eyebrow">Asset originale</p><h2>File importato</h2></div></div>
              <div className="asset-card"><span>{room.kind === 'pdf' ? 'PDF' : 'IMG'}</span><div><strong>{room.file.name}</strong><small>{importedCaption}</small></div></div>
              <div className="property-section"><div className="property-title"><span>Privacy</span><span className="editable-badge">Solo locale</span></div><p className="property-copy">Nessun upload remoto e nessuna elaborazione AI in questa fase.</p></div>
              <button className="remove-button" type="button" onClick={removeRoom}>Rimuovi dalla sessione</button>
            </>
          ) : (
            <>
              <div className="panel-heading"><div><p className="eyebrow">Selezione demo</p><h2>{activeSurface.name}</h2></div><button className="more-button" type="button" aria-label="Altre opzioni" disabled>•••</button></div>
              <div className="property-section"><div className="property-title"><span>Stato superficie</span><span className="editable-badge">Modificabile</span></div><button className="freeze-button" type="button" disabled><span aria-hidden="true">◇</span>Freeze superficie<small>Fase 5</small></button></div>
              <div className="property-section"><div className="property-title"><span>Materiale</span><button type="button" disabled>Modifica</button></div><div className="material-empty"><div className="material-sample" /><div><strong>Nessun materiale</strong><p>Assegna una finitura dopo aver confermato la geometria.</p></div></div></div>
              <div className="property-section metrics"><div><span>Vertici</span><strong>{activeSurface.vertices}</strong></div><div><span>Confidenza</span><strong>{activeSurface.confidence}</strong></div><div><span>Revisione</span><strong>01</strong></div></div>
            </>
          )}
          <div className="phase-card"><span className="phase-index">01</span><div><p className="eyebrow">Fase attuale</p><strong>Fondamenta dell’editor</strong><p>Caricamento locale e interfaccia responsive, senza elaborazione AI.</p></div></div>
        </aside>
      </div>
    </main>
  );
}
