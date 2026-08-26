import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mergeDetectedSurfaces, RoomStudio } from './room-studio';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:room-preview');
  URL.revokeObjectURL = vi.fn();
});

describe('RoomStudio', () => {
  it('replaces editable geometry after emptying while preserving Freeze areas', () => {
    const previous = [
      { id: 'old-floor', name: 'Pavimento', kind: 'floor' as const, frozen: false, points: [{ x: 0, y: .6 }, { x: 1, y: .6 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      { id: 'frozen-wall', name: 'Muro 1', kind: 'wall' as const, frozen: true, points: [{ x: 0, y: 0 }, { x: .4, y: .2 }, { x: .4, y: .7 }, { x: 0, y: 1 }] },
    ];
    const detected = [
      { id: 'new-floor', name: 'Pavimento', kind: 'floor' as const, frozen: false, points: [{ x: 0, y: .55 }, { x: 1, y: .55 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      { id: 'duplicate-wall', name: 'Parete sinistra', kind: 'wall' as const, frozen: false, points: [{ x: 0, y: 0 }, { x: .42, y: .2 }, { x: .42, y: .7 }, { x: 0, y: 1 }] },
      { id: 'new-wall', name: 'Muro 2', kind: 'wall' as const, frozen: false, points: [{ x: .4, y: .2 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: .4, y: .7 }] },
    ];

    const merged = mergeDetectedSurfaces(detected, previous);

    expect(merged.find((surface) => surface.kind === 'floor')).toMatchObject({ id: 'old-floor', points: detected[0].points });
    expect(merged.find((surface) => surface.id === 'frozen-wall')).toEqual(previous[1]);
    expect(merged.some((surface) => surface.id === 'duplicate-wall')).toBe(false);
    expect(merged.some((surface) => surface.id === 'new-wall')).toBe(true);
  });

  it('shows the product-specific import flow', () => {
    render(<RoomStudio />);
    expect(screen.getByRole('heading', { name: 'Cosa vuoi caricare?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Superfici della stanza')).toBeInTheDocument();
  });

  it('rejects an unsupported file with an accessible error', () => {
    render(<RoomStudio />);
    const input = document.querySelector('#room-file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['bad'], 'notes.txt', { type: 'text/plain' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Formato non supportato');
  });

  it('rejects a PDF before import instead of accepting it and failing later', () => {
    render(<RoomStudio />);
    fireEvent.change(document.querySelector('#room-file') as HTMLInputElement, {
      target: { files: [new File(['%PDF'], 'planimetria.pdf', { type: 'application/pdf' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Il PDF non è ancora modificabile');
  });

  it('imports a valid image locally and updates the project title', () => {
    render(<RoomStudio />);
    const input = document.querySelector('#room-file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['room'], 'soggiorno-verde.jpg', { type: 'image/jpeg' })] } });
    expect(screen.getByText('Soggiorno verde')).toBeInTheDocument();
    expect(screen.getByText('Originale intatto')).toBeInTheDocument();
    expect(screen.getByText('Riconoscimento automatico')).toBeInTheDocument();
    expect(screen.getByText('Vuoi svuotare la stanza?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '⌂ Svuota la stanza' })).toBeInTheDocument();
  });

  it('imports a floorplan, creates its perimeter and offers two-tap internal walls', () => {
    render(<RoomStudio />);
    fireEvent.change(document.querySelector('#floorplan-file') as HTMLInputElement, { target: { files: [new File(['plan'], 'casa.png', { type: 'image/png' })] } });
    expect(screen.getAllByText('Perimetro planimetria').length).toBeGreaterThan(0);
    expect(screen.getByText(/Planimetria riprodotta/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi parete interna' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.pointerDown(overlay, { clientX: 250, clientY: 250 });
    fireEvent.pointerDown(overlay, { clientX: 750, clientY: 250 });
    expect(screen.getAllByText('Muro 1').length).toBeGreaterThan(0);
  });

  it('creates guided surfaces and freezes the selected wall', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    expect(screen.getByRole('button', { name: '↑ Carica la tua foto' })).toBeInTheDocument();
    expect(screen.getAllByText('Muro 1').length).toBeGreaterThan(0);
    const polygons = document.querySelectorAll('.surface-overlay polygon');
    expect(polygons[1]).toHaveAttribute('points', expect.stringContaining('0,0'));
    expect(polygons[2]).toHaveAttribute('points', expect.stringContaining('1000,0'));
    expect(polygons[3]).toHaveAttribute('points', expect.stringContaining('1000,625 0,625'));
    expect(polygons).toHaveLength(6);
    expect(screen.getByRole('button', { name: /^Finestra/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Soffitto/ })).toBeInTheDocument();
    expect(polygons[5]).toHaveAttribute('points', expect.stringContaining('334,112.5 667,112.5 667,345'));
    fireEvent.click(screen.getByRole('button', { name: 'Mantieni identico Muro 1' }));
    expect(screen.getByText('Frozen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Consenti modifiche a Muro 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elimina superficie' })).toBeDisabled();
  });

  it('keeps correction handles hidden until the user asks to edit the borders', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    expect(document.querySelector('.surface-vertex-hit')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Correggi i bordi' }));
    expect(document.querySelectorAll('.surface-vertex-hit')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '✓ Fine correzione' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '✓ Fine correzione' }));
    expect(document.querySelector('.surface-vertex-hit')).not.toBeInTheDocument();
  });

  it('loads a local material and applies it to one surface', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.change(document.querySelector('#material-file') as HTMLInputElement, { target: { files: [new File(['tile'], 'travertino.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Applica a Muro 1' }));
    expect(screen.getByText(/travertino applicato a Muro 1/i)).toBeInTheDocument();
  });

  it('removes the problematic advanced drawing mode', () => {
    render(<RoomStudio />);
    expect(screen.queryByText('Modalità semplice')).not.toBeInTheDocument();
    expect(screen.queryByText('Modalità avanzata')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Avanzato' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Strumenti avanzati' })).not.toBeInTheDocument();
  });

  it('closes an easy wall automatically after four taps', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi muro/ }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 200 });
    fireEvent.pointerDown(overlay, { clientX: 700, clientY: 200 });
    fireEvent.pointerDown(overlay, { clientX: 700, clientY: 500 });
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 500 });
    expect(screen.getAllByText('Muro 4').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Chiudi superficie' })).not.toBeInTheDocument();
  });

  it('renames an internal wall and supports undo and redo', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.change(screen.getByLabelText('Nome superficie'), { target: { value: 'Divisorio cucina' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(screen.getAllByText('Divisorio cucina').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla ultima modifica' }));
    expect(screen.getAllByText('Muro 1').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ripristina modifica' }));
    expect(screen.getAllByText('Divisorio cucina').length).toBeGreaterThan(0);
  });

  it('freezes every surface except the selected wall', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mantieni tutto tranne questa' }));
    fireEvent.click(screen.getByRole('button', { name: /^Muro 2/ }));
    expect(screen.getByText('Frozen')).toBeInTheDocument();
  });

  it('searches demo materials and prepares an honest render summary', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continua ai prodotti' }));
    const search = screen.getByLabelText('Cerca materiali, colori o mobili');
    fireEvent.change(search, { target: { value: 'salvia' } });
    fireEvent.click(screen.getByRole('button', { name: /Verde salvia/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Applica a Muro 1' }));
    fireEvent.change(search, { target: { value: 'divano' } });
    fireEvent.click(screen.getByRole('button', { name: /Divano chiaro/ }));
    const canvas = document.querySelector('.canvas') as HTMLDivElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.click(canvas, { clientX: 650, clientY: 500 });
    fireEvent.click(screen.getByRole('button', { name: 'Prova flusso render' }));
    expect(screen.getByRole('dialog', { name: 'Crea il render reale' })).toHaveTextContent('Muro 1: Verde salvia');
    expect(screen.getByRole('dialog', { name: 'Crea il render reale' })).toHaveTextContent('Da inserire: Divano chiaro nel punto scelto');
    expect(screen.getByRole('dialog', { name: 'Crea il render reale' })).toHaveTextContent('L’app riproverà il collegamento');
    expect(screen.getByRole('button', { name: 'Crea render reale con IA' })).toBeInTheDocument();
  });

  it('uses one search for furniture and accepts a free-form render request', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continua ai prodotti' }));
    const search = screen.getByLabelText('Cerca materiali, colori o mobili');
    fireEvent.change(search, { target: { value: 'cucina' } });
    fireEvent.click(screen.getByRole('button', { name: /Cucina/ }));
    const canvas = document.querySelector('.canvas') as HTMLDivElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.click(canvas, { clientX: 500, clientY: 470 });
    expect(screen.getByRole('button', { name: 'Sposta Cucina' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'pianoforte nero a coda' } });
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi “pianoforte nero a coda” alla richiesta/ }));
    expect(screen.getByText('pianoforte nero a coda', { selector: '.selected-assets button' })).toBeInTheDocument();
  });

  it('offers separate brand, model, color and product type criteria', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continua ai prodotti' }));

    fireEvent.change(screen.getByLabelText('Marca o produttore'), { target: { value: 'Lea Ceramiche' } });
    fireEvent.change(screen.getByLabelText('Modello o collezione'), { target: { value: 'Intense' } });
    fireEvent.change(screen.getByLabelText('Colore prodotto'), { target: { value: 'Clair' } });
    fireEvent.change(screen.getByLabelText('Tipo prodotto'), { target: { value: 'Pavimenti' } });

    expect(screen.getByLabelText('Marca o produttore')).toHaveValue('Lea Ceramiche');
    expect(screen.getByLabelText('Modello o collezione')).toHaveValue('Intense');
    expect(screen.getByLabelText('Colore prodotto')).toHaveValue('Clair');
    expect(screen.getByLabelText('Tipo prodotto')).toHaveValue('Pavimenti');

    fireEvent.click(screen.getByRole('button', { name: 'Azzera' }));
    expect(screen.getByLabelText('Marca o produttore')).toHaveValue('');
    expect(screen.getByLabelText('Modello o collezione')).toHaveValue('');
    expect(screen.getByLabelText('Colore prodotto')).toHaveValue('');
  });

  it('starts with a four-step workflow and only exposes the simple mode', () => {
    render(<RoomStudio />);
    expect(screen.getByRole('navigation', { name: 'Passaggi del progetto' })).toHaveTextContent('1Foto2Prepara3Prodotti4Render');
    expect(screen.queryByText(/Modalità (semplice|avanzata)/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Strumenti avanzati' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prepara/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    expect(screen.getByRole('button', { name: /Prepara/ })).toBeEnabled();
  });
});
