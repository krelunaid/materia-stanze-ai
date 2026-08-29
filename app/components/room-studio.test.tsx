import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mergeDetectedSurfaces, RoomStudio } from './room-studio';
import { geometryForDerivedImage, surfacesMatch } from '../geometry/model';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:room-preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('does not let a generated empty-room image replace approved contours', () => {
    const previous = [
      { id: 'old-floor', name: 'Pavimento', kind: 'floor' as const, frozen: false, points: [{ x: 0, y: .6 }, { x: 1, y: .6 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    const detected = [
      { id: 'new-floor', name: 'Pavimento', kind: 'floor' as const, frozen: false, points: [{ x: 0, y: .4 }, { x: 1, y: .4 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    const kept = geometryForDerivedImage(previous);
    expect(surfacesMatch(kept, previous)).toBe(true);
    expect(surfacesMatch(kept, mergeDetectedSurfaces(detected, previous))).toBe(false);
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

  it('continues moving a correction handle from window pointer events', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Correggi i bordi' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    const selectedPolygon = document.querySelector('.is-selected-surface polygon') as SVGPolygonElement;
    const before = selectedPolygon.getAttribute('points');
    const handle = document.querySelector('.surface-vertex-hit') as SVGCircleElement;
    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 218, clientY: 81 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 300, clientY: 125 });
    fireEvent.pointerUp(window, { pointerId: 9 });
    expect(selectedPolygon.getAttribute('points')).not.toBe(before);
  });

  it('keeps every shared corner linked across repeated pointer moves', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Correggi i bordi' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    const handle = screen.getByLabelText('Sposta punto 1 di Muro 1');
    fireEvent.pointerDown(handle, { pointerId: 17, clientX: 218, clientY: 81 });
    fireEvent.pointerMove(window, { pointerId: 17, clientX: 300, clientY: 120 });
    fireEvent.pointerMove(window, { pointerId: 17, clientX: 330, clientY: 150 });
    fireEvent.pointerUp(window, { pointerId: 17 });
    const polygons = document.querySelectorAll('.surface-overlay polygon');
    expect(polygons[0]).toHaveAttribute('points', expect.stringContaining('330,150'));
    expect(polygons[1]).toHaveAttribute('points', expect.stringContaining('330,150'));
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

  it('shows a real side preview and on-canvas controls when furniture orientation changes', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continua ai prodotti' }));
    fireEvent.change(screen.getByLabelText('Cerca materiali, colori o mobili'), { target: { value: 'divano' } });
    fireEvent.click(screen.getByRole('button', { name: /Divano chiaro/ }));
    const canvas = document.querySelector('.canvas') as HTMLDivElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.click(canvas, { clientX: 500, clientY: 500 });
    expect(screen.getByRole('button', { name: 'Muro frontale' })).toHaveClass('is-active');
    const initiallyFront = screen.getByRole('button', { name: 'Sposta Divano chiaro' });
    expect(initiallyFront.querySelector('img')).toHaveAttribute('src', '/demo-sofa.png');
    expect(Number.parseFloat((initiallyFront as HTMLElement).style.width)).toBeGreaterThan(30);
    expect(screen.getByRole('group', { name: 'Dimensione del mobile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Misura automatica attiva per Divano chiaro' })).toBeDisabled();
    const automaticWidth = Number.parseFloat((initiallyFront as HTMLElement).style.width);
    fireEvent.click(screen.getByRole('button', { name: 'Ingrandisci Divano chiaro' }));
    expect(Number.parseFloat((initiallyFront as HTMLElement).style.width)).toBeGreaterThan(automaticWidth);
    const restoreAuto = screen.getByRole('button', { name: 'Ripristina misura automatica per Divano chiaro' });
    expect(restoreAuto).toBeEnabled();
    fireEvent.click(restoreAuto);
    expect(Number.parseFloat((initiallyFront as HTMLElement).style.width)).toBe(automaticWidth);
    expect(screen.getByRole('button', { name: 'Misura automatica attiva per Divano chiaro' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Muro sinistro' }));
    const furniture = screen.getByRole('button', { name: 'Sposta Divano chiaro' });
    expect(furniture).toHaveClass('facing-left-wall');
    expect(furniture.getAttribute('style')).not.toContain('rotate(');
    expect(furniture.querySelector('img')).toHaveAttribute('src', '/demo-sofa-side.png');
    expect(screen.getByRole('group', { name: 'Gira il mobile' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sposta il mobile con i pulsanti' })).toBeInTheDocument();
    const initialLeft = Number.parseFloat((furniture as HTMLElement).style.left);
    fireEvent.click(screen.getByRole('button', { name: 'Sposta mobile a destra' }));
    expect(Number.parseFloat((furniture as HTMLElement).style.left)).toBeGreaterThan(initialLeft);
    fireEvent.click(screen.getByRole('button', { name: 'Ruota mobile a destra' }));
    expect(furniture.getAttribute('style')).toContain('rotate(5deg)');
    expect(screen.getByRole('button', { name: 'Raddrizza mobile' })).toHaveTextContent('5°');
    fireEvent.click(screen.getByRole('button', { name: 'Orienta Divano chiaro: Muro destro' }));
    expect(furniture).toHaveClass('facing-right-wall');
  });

  it('keeps the grabbed point stable while auto-scaling furniture in depth', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continua ai prodotti' }));
    fireEvent.change(screen.getByLabelText('Cerca materiali, colori o mobili'), { target: { value: 'divano' } });
    fireEvent.click(screen.getByRole('button', { name: /Divano chiaro/ }));
    const canvas = document.querySelector('.canvas') as HTMLDivElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.click(canvas, { clientX: 500, clientY: 500 });
    const furniture = screen.getByRole('button', { name: 'Sposta Divano chiaro' });
    const initialWidth = Number.parseFloat((furniture as HTMLElement).style.width);
    const initialTop = Number.parseFloat((furniture as HTMLElement).style.top);
    fireEvent.pointerDown(furniture, { pointerId: 21, clientX: 500, clientY: 400 });
    fireEvent.pointerMove(furniture, { pointerId: 21, clientX: 500, clientY: 420 });
    fireEvent.pointerUp(furniture, { pointerId: 21 });
    const movedTop = Number.parseFloat((furniture as HTMLElement).style.top);
    expect(movedTop).toBeGreaterThan(initialTop);
    expect(movedTop - initialTop).toBeLessThan(8);
    expect(Number.parseFloat((furniture as HTMLElement).style.width)).toBeGreaterThan(initialWidth);
  });

  it('offers separate brand, model, color and product type criteria', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continua ai prodotti' }));

    fireEvent.change(screen.getByLabelText('Marca o produttore'), { target: { value: 'Lea Ceramiche' } });
    fireEvent.change(screen.getByLabelText('Modello o collezione'), { target: { value: 'Intense' } });
    fireEvent.change(screen.getByLabelText('Colore prodotto'), { target: { value: 'Clair' } });
    fireEvent.change(screen.getByLabelText('Tipo prodotto'), { target: { value: 'Pavimenti' } });
    fireEvent.change(screen.getByLabelText('Link prodotto'), { target: { value: 'https://example.com/prodotto' } });

    expect(screen.getByLabelText('Marca o produttore')).toHaveValue('Lea Ceramiche');
    expect(screen.getByLabelText('Modello o collezione')).toHaveValue('Intense');
    expect(screen.getByLabelText('Colore prodotto')).toHaveValue('Clair');
    expect(screen.getByLabelText('Tipo prodotto')).toHaveValue('Pavimenti');
    expect(screen.getByLabelText('Link prodotto')).toHaveValue('https://example.com/prodotto');

    fireEvent.click(screen.getByRole('button', { name: 'Azzera' }));
    expect(screen.getByLabelText('Marca o produttore')).toHaveValue('');
    expect(screen.getByLabelText('Modello o collezione')).toHaveValue('');
    expect(screen.getByLabelText('Colore prodotto')).toHaveValue('');
    expect(screen.getByLabelText('Link prodotto')).toHaveValue('');
  });

  it('offers search, product photo and material sample as clear entry cards', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continua ai prodotti' }));
    expect(screen.getByLabelText('Modalità inserimento prodotto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cerca online/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Foto prodotto/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Campione materiale/ })).toBeInTheDocument();
  });

  it('does not place an online furniture result when its product image is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok' }), { status: 200 });
      }
      if (url.includes('/api/search-products')) {
        return new Response(JSON.stringify({ products: [{
          name: 'Divano Dorian', brand: 'divani.store', collection: '', category: 'Arredi', color: 'Beige', effect: '', format: '', finish: '',
          description: 'Divano beige', sourceUrl: 'https://divani.store/products/dorian', productImageUrl: '', textureImageUrl: '', roomImageUrls: [],
          confidence: .7, official: false, correction: '',
        }] }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continua ai prodotti' }));
    fireEvent.change(screen.getByLabelText('Tipo prodotto'), { target: { value: 'Arredi' } });
    fireEvent.change(screen.getByLabelText('Cerca materiali, colori o mobili'), { target: { value: 'divano beige' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca con Grok' }));

    const unavailable = await screen.findByRole('button', { name: /divani\.store · Divano Dorian.*Foto prodotto non disponibile/ });
    expect(unavailable).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Fonte' })).toHaveAttribute('href', 'https://divani.store/products/dorian');
    expect(document.querySelector('.placed-furniture-placeholder')).not.toBeInTheDocument();
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
