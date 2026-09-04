import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { friendlyRequestError, mergeDetectedSurfaces, RoomStudio } from './room-studio';
import { geometryForDerivedImage, surfacesMatch } from '../geometry/model';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:room-preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockMaterialPhotoCrop() {
  vi.stubGlobal('Image', class {
    naturalWidth = 1200;
    naturalHeight = 800;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['sample'], { type: 'image/png' })));
}

function mockPointerCapture(target: Element) {
  let capturedPointer: number | null = null;
  const setPointerCapture = vi.fn((pointerId: number) => { capturedPointer = pointerId; });
  const hasPointerCapture = vi.fn((pointerId: number) => capturedPointer === pointerId);
  const releasePointerCapture = vi.fn((pointerId: number) => {
    if (capturedPointer === pointerId) capturedPointer = null;
  });
  Object.defineProperties(target, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: hasPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  return { setPointerCapture, releasePointerCapture };
}

function continueWithOriginalPhoto() {
  fireEvent.click(screen.getByRole('button', { name: 'Usa foto originale →' }));
}

function continueToProducts() {
  fireEvent.click(screen.getByRole('button', { name: 'Continua ai prodotti' }));
}

function loadDemoAndContinue() {
  fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
  continueWithOriginalPhoto();
}

function loadDemoAndOpenProducts() {
  loadDemoAndContinue();
  continueToProducts();
}

function clickStatusBar(name: string) {
  const bar = document.querySelector('.status-bar') as HTMLElement;
  fireEvent.click(within(bar).getByRole('button', { name }));
}

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

  it('keeps room measurements tied to the approved original geometry after cleanup', () => {
    const previous = [
      { id: 'wall', name: 'Muro 1', kind: 'wall' as const, frozen: false, points: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .62 }, { x: .1, y: .62 }] },
      { id: 'floor', name: 'Pavimento', kind: 'floor' as const, frozen: false, points: [{ x: .1, y: .62 }, { x: .9, y: .62 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];

    const afterCleanup = geometryForDerivedImage(previous);

    expect(afterCleanup).toEqual(previous);
    expect(afterCleanup).not.toBe(previous);
  });

  it('remaps an opening parent when a detected wall inherits the approved id', () => {
    const previous = [{
      id: 'approved-wall', name: 'Muro sinistro', kind: 'wall' as const, frozen: false,
      points: [{ x: 0, y: 0 }, { x: .4, y: 0 }, { x: .4, y: .7 }, { x: 0, y: .7 }],
    }];
    const detected = [
      { id: 'wall:left:0', name: 'Muro sinistro', kind: 'wall' as const, frozen: false, points: previous[0].points },
      { id: 'window:left', name: 'Finestra', kind: 'window' as const, frozen: false, parentId: 'wall:left:0', points: [{ x: .05, y: .1 }, { x: .3, y: .1 }, { x: .3, y: .45 }, { x: .05, y: .45 }] },
    ];
    const merged = mergeDetectedSurfaces(detected, previous);
    expect(merged.find((surface) => surface.kind === 'window')?.parentId).toBe('approved-wall');
  });

  it('shows the product-specific import flow', () => {
    render(<RoomStudio />);
    expect(screen.getByRole('heading', { name: 'Cosa vuoi caricare?' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Passaggi del progetto' })).toHaveTextContent('Foto');
    expect(screen.queryByLabelText('Superfici della stanza')).not.toBeInTheDocument();
  });

  it('uses the lower skirting-floor contact in the example room', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));

    const floor = document.querySelector('.surface-kind-floor polygon') as SVGPolygonElement;
    const points = String(floor.getAttribute('points')).split(' ').map((point) => point.split(',').map(Number));
    expect(points.slice(0, 4)).toEqual([
      [218, 446.25], [785, 446.25], [1000, 555.3125], [1000, 625],
    ]);
    const sharedWallPoints = Array.from(document.querySelectorAll('.surface-kind-wall polygon'))
      .flatMap((polygon) => String(polygon.getAttribute('points')).split(' ').map((point) => point.split(',').map(Number)));
    expect(sharedWallPoints).toContainEqual([218, 446.25]);
    expect(sharedWallPoints).toContainEqual([785, 446.25]);
    expect(sharedWallPoints).toContainEqual([0, 555.3125]);
    expect(sharedWallPoints).toContainEqual([1000, 555.3125]);

    const leftSlope = (446.25 - 555.3125) / 218;
    const rightSlope = (555.3125 - 446.25) / (1000 - 785);
    expect(Math.abs(Math.abs(leftSlope) - Math.abs(rightSlope))).toBeLessThan(.008);
  });

  it('translates the iOS network error without losing the project', () => {
    expect(friendlyRequestError(new Error('The network connection was lost.')).message)
      .toBe('Connessione interrotta. La stanza resta aperta: controlla la rete e riprova l’operazione.');
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
    expect(screen.getByText('Vuoi svuotare la stanza?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '⌂ Svuota la stanza' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usa foto originale →' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continua ai prodotti' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Porta' })).not.toBeInTheDocument();
  });

  it('lets the original photo leave Prepara even when the opening audit rejects the geometry', async () => {
    mockMaterialPhotoCrop();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok', auditorReady: true }), { status: 200 });
      }
      if (url.includes('/api/detect-surfaces')) {
        return new Response(JSON.stringify({
          surfaces: [
            { name: 'Muro', kind: 'wall', confidence: .9, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
            { name: 'Pavimento', kind: 'floor', confidence: .94, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
          ],
          openingAuditStatus: 'geometry-invalid',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/detect-object')) {
        return new Response(JSON.stringify({ regions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    fireEvent.change(document.querySelector('#room-file') as HTMLInputElement, {
      target: { files: [new File(['room'], 'cucina-con-arco.jpg', { type: 'image/jpeg' })] },
    });
    const image = screen.getByAltText('Originale importato: cucina-con-arco.jpg') as HTMLImageElement;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1200 },
      naturalHeight: { configurable: true, value: 800 },
    });
    fireEvent.load(image);

    expect(await screen.findAllByText(/Riconoscimento completato|soglia o stipiti/)).not.toHaveLength(0);
    expect(screen.queryByText('Apertura da confermare')).not.toBeInTheDocument();
    expect(screen.queryByText('Apertura non sicura')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Porta' })).not.toBeInTheDocument();
    const original = screen.getByRole('button', { name: 'Usa foto originale →' });
    const empty = screen.getByRole('button', { name: '⌂ Svuota la stanza' });
    expect(original).toBeEnabled();
    expect(empty).toBeEnabled();

    fireEvent.click(empty);
    expect(screen.getByRole('alert')).toHaveTextContent(/apertura più sicura/);
    expect(original).toBeEnabled();

    fireEvent.click(original);
    expect(screen.getByRole('button', { name: /Controlla/ })).toHaveClass('is-active');
    expect(screen.getByText('Apertura da confermare')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '＋ Arco' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    [
      [700, 560], [700, 260], [820, 130], [940, 260], [940, 560],
    ].forEach(([clientX, clientY]) => fireEvent.pointerDown(overlay, { clientX, clientY }));
    fireEvent.click(screen.getByRole('button', { name: '✓ Conferma arco' }));

    expect(screen.queryByText('Apertura da confermare')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Prepara/ }));
    fireEvent.click(screen.getByRole('button', { name: '⌂ Svuota la stanza' }));
    expect(screen.queryByText(/apertura più sicura/)).not.toBeInTheDocument();
  });

  it('shows inferred arch edges separately and keeps shell blocking after a manual arch correction', async () => {
    mockMaterialPhotoCrop();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok', auditorReady: true }), { status: 200 });
      }
      if (url.includes('/api/detect-surfaces')) {
        return new Response(JSON.stringify({
          surfaces: [
            { name: 'Muro', kind: 'wall', confidence: .9, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
            { name: 'Pavimento', kind: 'floor', confidence: .94, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
            {
              name: 'Arco', kind: 'door', confidence: .94, audited: true, thresholdInferred: true,
              points: [{ x: .7, y: .3 }, { x: .74, y: .18 }, { x: .84, y: .1 }, { x: .94, y: .18 }, { x: .98, y: .3 }, { x: .98, y: .72 }, { x: .7, y: .72 }],
            },
          ],
          openingAuditStatus: 'geometry-invalid',
          shellGeometryStatus: 'geometry-invalid',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    fireEvent.change(document.querySelector('#room-file') as HTMLInputElement, {
      target: { files: [new File(['room'], 'cucina-arco-occluso.jpg', { type: 'image/jpeg' })] },
    });
    const image = screen.getByAltText('Originale importato: cucina-arco-occluso.jpg') as HTMLImageElement;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1200 },
      naturalHeight: { configurable: true, value: 800 },
    });
    fireEvent.load(image);

    expect(await screen.findAllByText(/Riconoscimento completato|soglia o stipiti/)).not.toHaveLength(0);
    expect(screen.queryByText('Apertura da confermare')).not.toBeInTheDocument();
    expect(screen.queryByText('Apertura non sicura')).not.toBeInTheDocument();
    expect(screen.queryByText('Geometria stanza non sicura')).not.toBeInTheDocument();
    const inferredArch = document.querySelector('.surface-kind-door[data-threshold="inferred"]') as SVGGElement;
    expect(inferredArch.querySelector('.surface-opening-verified')).toBeInTheDocument();
    expect(inferredArch.querySelector('.surface-opening-inferred')).toBeInTheDocument();
    const original = screen.getByRole('button', { name: 'Usa foto originale →' });
    expect(original).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '⌂ Svuota la stanza' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/apertura più sicura|contorni devono coincidere/);

    fireEvent.click(original);
    expect(screen.getByRole('button', { name: /Controlla/ })).toHaveClass('is-active');
    expect(screen.getByText('Apertura da confermare')).toBeInTheDocument();
    expect(screen.getByText('Contorni da rivedere')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^ArcoTocca per selezionare/ }));
    fireEvent.click(screen.getByRole('button', { name: '✓ Conferma soglia stimata' }));

    expect(screen.queryByText('Apertura da confermare')).not.toBeInTheDocument();
    expect(screen.getByText('Contorni da rivedere')).toBeInTheDocument();
    expect(document.querySelector('.surface-kind-door[data-threshold="verified"]')).toBeInTheDocument();
    expect(document.querySelector('.surface-opening-inferred')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '＋ Arco' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    [[700, 560], [700, 260], [820, 130], [940, 260], [940, 560]]
      .forEach(([clientX, clientY]) => fireEvent.pointerDown(overlay, { clientX, clientY }));
    fireEvent.click(screen.getByRole('button', { name: '✓ Conferma arco' }));

    expect(screen.queryByText('Apertura da confermare')).not.toBeInTheDocument();
    expect(screen.getByText('Contorni da rivedere')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Prepara/ }));
    fireEvent.click(screen.getByRole('button', { name: '⌂ Svuota la stanza' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/contorni devono coincidere/);
  });

  it('describes an inferred arch as awaiting confirmation instead of rejected', async () => {
    mockMaterialPhotoCrop();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok', auditorReady: true }), { status: 200 });
      }
      if (url.includes('/api/detect-surfaces')) {
        return new Response(JSON.stringify({
          surfaces: [
            { name: 'Muro', kind: 'wall', confidence: .9, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
            { name: 'Pavimento', kind: 'floor', confidence: .94, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
            {
              name: 'Arco', kind: 'door', confidence: .94, audited: true, thresholdInferred: true,
              points: [{ x: .7, y: .3 }, { x: .74, y: .18 }, { x: .84, y: .1 }, { x: .94, y: .18 }, { x: .98, y: .3 }, { x: .98, y: .72 }, { x: .7, y: .72 }],
            },
          ],
          openingAuditStatus: 'geometry-invalid',
          shellGeometryStatus: 'verified',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    fireEvent.change(document.querySelector('#room-file') as HTMLInputElement, {
      target: { files: [new File(['room'], 'cucina-arco-occluso.jpg', { type: 'image/jpeg' })] },
    });
    const image = screen.getByAltText('Originale importato: cucina-arco-occluso.jpg') as HTMLImageElement;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1200 },
      naturalHeight: { configurable: true, value: 800 },
    });
    fireEvent.load(image);

    expect(await screen.findByText(/Arco: soglia o stipiti sono stimati dietro i mobili/)).toBeInTheDocument();
    expect(screen.queryByText(/l’apertura è stata rifiutata/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usa foto originale →' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '⌂ Svuota la stanza' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/apertura più sicura/);
  });

  it('skips optional cleanup immediately while automatic geometry is still pending', () => {
    render(<RoomStudio />);
    fireEvent.change(document.querySelector('#room-file') as HTMLInputElement, {
      target: { files: [new File(['room'], 'camera.jpg', { type: 'image/jpeg' })] },
    });

    const skip = screen.getByRole('button', { name: 'Usa foto originale →' });
    expect(skip).toBeEnabled();
    fireEvent.click(skip);

    expect(screen.getByRole('button', { name: /Controlla/ })).toHaveClass('is-active');
    expect(screen.getByText('Foto originale mantenuta. Controlla i contorni, poi continua ai prodotti.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Modalità inserimento prodotto')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continua ai prodotti' })).toBeInTheDocument();
    continueToProducts();
    expect(screen.getByRole('button', { name: /Prodotti/ })).toHaveClass('is-active');
    expect(screen.getByLabelText('Modalità inserimento prodotto')).toBeInTheDocument();
  });

  it('keeps Prepara limited to emptying or the original photo', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    expect(screen.getByRole('button', { name: '⌂ Svuota la stanza' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usa foto originale →' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '◎ Indica un mobile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Porta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Arco' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continua ai prodotti' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correggi i bordi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '↔ Sposta linee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '✓ Fine correzione' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Correzione attiva/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Superfici della stanza')).not.toBeInTheDocument();
    continueWithOriginalPhoto();
    expect(screen.getByRole('button', { name: /Controlla/ })).toHaveClass('is-active');
    expect(screen.getByLabelText('Superfici della stanza')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continua ai prodotti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ Porta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '↔ Sposta linee' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Modalità inserimento prodotto')).not.toBeInTheDocument();
    continueToProducts();
    expect(screen.getByRole('button', { name: /Prodotti/ })).toHaveClass('is-active');
    expect(screen.getByLabelText('Modalità inserimento prodotto')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Porta' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Superfici della stanza')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continua ai prodotti' })).not.toBeInTheDocument();
  });

  it('keeps cleanup usable when automatic detection finds no movable objects', async () => {
    mockMaterialPhotoCrop();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok' }), { status: 200 });
      }
      if (url.includes('/api/detect-object')) {
        return new Response(JSON.stringify({ regions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: '⌂ Svuota la stanza' }));

    expect(await screen.findByText(/non ha individuato con sufficiente certezza zone da rimuovere/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla selezione' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the original untouched when Terra confirms that the room is already empty', async () => {
    mockMaterialPhotoCrop();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok', auditorReady: true }), { status: 200 });
      }
      if (url.includes('/api/detect-object')) {
        return new Response(JSON.stringify({
          regions: [{ label: 'Ombra', points: [{ x: .2, y: .2 }, { x: .3, y: .2 }, { x: .3, y: .3 }, { x: .2, y: .3 }] }],
          roomAudit: {
            needsEmptying: false,
            removableObjectCount: 0,
            majorCategories: [],
            confidence: .94,
            reason: 'sono visibili soltanto superfici architettoniche',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: '⌂ Svuota la stanza' }));

    expect(await screen.findByText(/Terra conferma che la stanza è già vuota/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Controlla/ })).toHaveClass('is-active');
    expect(screen.getByText('Originale intatto')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks for a manual target when Terra sees furniture but Grok has no safe polygon', async () => {
    mockMaterialPhotoCrop();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok', auditorReady: true }), { status: 200 });
      }
      if (url.includes('/api/detect-object')) {
        return new Response(JSON.stringify({
          regions: [],
          roomAudit: {
            needsEmptying: true,
            removableObjectCount: 5,
            majorCategories: ['letto', 'armadio'],
            confidence: .96,
            reason: 'sono presenti arredi',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: '⌂ Svuota la stanza' }));

    expect(await screen.findByText(/Terra vede elementi da rimuovere \(letto, armadio\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla selezione' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('imports a floorplan, starts automatic room creation and keeps manual correction available', () => {
    render(<RoomStudio />);
    fireEvent.change(document.querySelector('#floorplan-file') as HTMLInputElement, { target: { files: [new File(['plan'], 'casa.png', { type: 'image/png' })] } });
    expect(screen.getAllByText('Perimetro planimetria').length).toBeGreaterThan(0);
    expect(screen.getByText(/Creo automaticamente la stanza vuota/)).toBeInTheDocument();
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
    const polygons = document.querySelectorAll('.surface-overlay polygon');
    expect(polygons[1]).toHaveAttribute('points', expect.stringContaining('0,0'));
    expect(polygons[2]).toHaveAttribute('points', expect.stringContaining('1000,0'));
    expect(polygons[3]).toHaveAttribute('points', expect.stringContaining('1000,625 0,625'));
    expect(polygons).toHaveLength(6);
    expect(polygons[5]).toHaveAttribute('points', expect.stringContaining('334,112.5 667,112.5 667,345'));
    continueWithOriginalPhoto();
    expect(screen.getAllByText('Muro 1').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Finestra/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Soffitto/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Mantieni identico Muro 1' }));
    expect(screen.getByRole('button', { name: 'Consenti modifiche a Muro 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Muro 1.*Freeze attivo/ })).toBeInTheDocument();
  });

  it('keeps correction handles hidden until the user asks to edit the borders', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    expect(document.querySelector('.surface-vertex-hit')).not.toBeInTheDocument();
    continueWithOriginalPhoto();
    clickStatusBar('↔ Sposta linee');
    expect(document.querySelectorAll('.surface-vertex-hit')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '✓ Fine correzione' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '✓ Fine correzione' }));
    expect(document.querySelector('.surface-vertex-hit')).not.toBeInTheDocument();
  });

  it('keeps midpoint touch targets fully inside clipped iOS edges', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    continueWithOriginalPhoto();
    clickStatusBar('↔ Sposta linee');
    const midpoint = screen.getByTestId('edge-grip-hit-0');
    expect(midpoint.style.left).toContain('clamp(26px');
    expect(midpoint.style.top).toContain('clamp(26px');
    expect(midpoint).toHaveStyle({ touchAction: 'none' });
  });

  it('creates and drags a new vertex from the visible centre circle', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    continueWithOriginalPhoto();
    clickStatusBar('↔ Sposta linee');
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    const polygon = document.querySelector('.is-selected-surface polygon') as SVGPolygonElement;
    const before = (polygon.getAttribute('points') as string).split(' ');
    const circle = document.querySelector('.surface-correction-controls .surface-edge-grip') as SVGCircleElement;
    const x = Number(circle.getAttribute('cx'));
    const y = Number(circle.getAttribute('cy'));
    const capture = mockPointerCapture(circle);

    fireEvent.pointerDown(circle, { pointerId: 23, pointerType: 'touch', clientX: x, clientY: y });
    fireEvent.pointerMove(circle, { pointerId: 23, pointerType: 'touch', clientX: x, clientY: y + 35 });
    fireEvent.pointerUp(circle, { pointerId: 23, pointerType: 'touch' });

    expect(capture.setPointerCapture).toHaveBeenCalledWith(23);
    const after = (polygon.getAttribute('points') as string).split(' ');
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    expect(Number(after[1].split(',')[1])).toBeGreaterThan(Number(before[0].split(',')[1]));
    expect(screen.getByText('Nuovo punto creato: trascinalo per formare una punta.')).toBeInTheDocument();
  });

  it('captures touch on the real vertex handle, moves it and restores it with undo', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    continueWithOriginalPhoto();
    clickStatusBar('↔ Sposta linee');
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    const selectedPolygon = document.querySelector('.is-selected-surface polygon') as SVGPolygonElement;
    const before = selectedPolygon.getAttribute('points');
    const handle = document.querySelector('.surface-vertex-hit') as SVGCircleElement;
    const capture = mockPointerCapture(handle);
    fireEvent.pointerDown(handle, { pointerId: 9, pointerType: 'touch', clientX: 218, clientY: 81 });
    fireEvent.pointerMove(handle, { pointerId: 9, pointerType: 'touch', clientX: 300, clientY: 125 });
    fireEvent.pointerUp(handle, { pointerId: 9, pointerType: 'touch' });
    expect(capture.setPointerCapture).toHaveBeenCalledWith(9);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(9);
    expect(selectedPolygon.getAttribute('points')).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla ultima modifica' }));
    expect(selectedPolygon).toHaveAttribute('points', before);
  });

  it('keeps every shared corner linked across repeated pointer moves', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    continueWithOriginalPhoto();
    clickStatusBar('↔ Sposta linee');
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
    loadDemoAndOpenProducts();
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
    continueWithOriginalPhoto();
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

  it('creates a door with four Apple Pencil taps', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    continueWithOriginalPhoto();
    fireEvent.click(screen.getByRole('button', { name: '＋ Porta' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    expect(overlay).toHaveClass('is-drawing');
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 220 });
    fireEvent.pointerDown(overlay, { clientX: 220, clientY: 220 });
    fireEvent.pointerDown(overlay, { clientX: 220, clientY: 560 });
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 560 });
    expect(screen.getAllByText('Porta 1').length).toBeGreaterThan(0);
    expect(overlay).not.toHaveClass('is-drawing');
    const door = document.querySelector('.surface-kind-door') as SVGGElement;
    expect(door.getAttribute('data-parent-id')).toMatch(/^demo-.*-1$/);
    expect(door).toHaveAttribute('data-source', 'manual');
    expect(door.querySelector('polygon')).toHaveAttribute('points', expect.stringContaining('0,220'));
    expect(door.querySelector('polygon')).toHaveAttribute('points', expect.stringContaining('220,220'));
    expect(document.querySelectorAll('.surface-kind-window')).toHaveLength(1);
    expect(document.querySelector('.surface-correction-controls')).toBeInTheDocument();
    expect(document.querySelectorAll('.surface-correction-controls .surface-vertex-hit')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '✓ Fine correzione' })).toBeInTheDocument();
  });

  it('orders four door points and immediately exposes the real editable contour', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    continueWithOriginalPhoto();
    fireEvent.click(screen.getByRole('button', { name: '＋ Porta' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 550 });
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 200 });
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 550 });
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 200 });

    const polygon = document.querySelector('.surface-kind-door.is-selected-surface polygon') as SVGPolygonElement;
    expect(polygon).toHaveAttribute('points', '100,200 300,200 300,550 100,550');
    expect(document.querySelectorAll('.surface-correction-controls .surface-edge-hit')).toHaveLength(4);
  });

  it('draws a masonry arch with several points and confirms it explicitly', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    continueWithOriginalPhoto();
    fireEvent.click(screen.getByRole('button', { name: '＋ Arco' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    [
      [700, 560], [700, 260], [740, 180], [820, 130], [900, 180], [940, 260], [940, 560],
    ].forEach(([clientX, clientY]) => fireEvent.pointerDown(overlay, { clientX, clientY }));

    expect(screen.getByRole('toolbar', { name: 'Correggi disegno Arco' })).toHaveTextContent('7 punti · minimo 5');
    fireEvent.click(screen.getByRole('button', { name: '✓ Conferma arco' }));
    expect(screen.getAllByText('Arco 1').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.surface-kind-door.is-selected-surface .surface-name')).toHaveLength(1);
    expect(document.querySelectorAll('.surface-correction-controls .surface-vertex-hit')).toHaveLength(7);
  });

  it('lets iPhone users remove a wrong point or cancel a door drawing', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    continueWithOriginalPhoto();
    fireEvent.click(screen.getByRole('button', { name: '＋ Porta' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 200 });
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 200 });
    expect(screen.getByRole('toolbar', { name: 'Correggi disegno Porta' })).toHaveTextContent('2/4 punti');
    fireEvent.click(screen.getByRole('button', { name: 'Cancella ultimo punto' }));
    expect(screen.getByRole('toolbar', { name: 'Correggi disegno Porta' })).toHaveTextContent('1/4 punti');
    expect(screen.getByRole('button', { name: '✕ Cancella porta' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancella tutto il disegno Porta' }));
    expect(overlay).not.toHaveClass('is-drawing');
    expect(screen.queryByRole('toolbar', { name: 'Correggi disegno Porta' })).not.toBeInTheDocument();
  });

  it('keeps undo and delete visible after a door is created', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    continueWithOriginalPhoto();
    fireEvent.click(screen.getByRole('button', { name: '＋ Porta' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 200 });
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 200 });
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 550 });
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 550 });
    expect(screen.getByRole('toolbar', { name: 'Azioni per Porta 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '⌫ Elimina Porta 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Elimina Porta 1' }));
    expect(document.querySelector('.surface-kind-door')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Azioni per Porta 1' })).not.toBeInTheDocument();
  });

  it('keeps invisible wall hit areas selectable outside correction mode', () => {
    render(<RoomStudio />);
    loadDemoAndContinue();
    const secondWall = document.querySelectorAll('.surface-kind-wall polygon')[1] as SVGPolygonElement;
    fireEvent.pointerDown(secondWall);
    expect(screen.getByRole('button', { name: 'Mantieni identico Muro 2' })).toBeInTheDocument();
  });

  it('renames an internal wall and supports undo and redo', () => {
    render(<RoomStudio />);
    loadDemoAndOpenProducts();
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
    loadDemoAndContinue();
    fireEvent.click(screen.getByRole('button', { name: 'Mantieni tutto tranne questa' }));
    fireEvent.click(screen.getByRole('button', { name: /Muro 2Freeze attivo/ }));
    expect(screen.getByRole('button', { name: 'Consenti modifiche a Muro 2' })).toBeInTheDocument();
  });

  it('searches demo materials and prepares an honest render summary', () => {
    render(<RoomStudio />);
    loadDemoAndOpenProducts();
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

  it('offers enlarge and save controls when the render is ready', async () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: /Render$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Prova flusso render' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crea render reale con IA' }));

    expect(await screen.findByRole('button', { name: '⛶ Ingrandisci' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '↓ Salva render' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '⛶ Ingrandisci' }));
    expect(screen.getByRole('dialog', { name: 'Render Materia' })).toBeInTheDocument();
    expect(screen.getByAltText('Render Materia ingrandito')).toBeInTheDocument();
  });

  it('does not enter Render while a furniture photo still needs a floor position', () => {
    render(<RoomStudio />);
    loadDemoAndOpenProducts();
    fireEvent.change(screen.getByLabelText('Cerca materiali, colori o mobili'), { target: { value: 'divano' } });
    fireEvent.click(screen.getByRole('button', { name: /Divano chiaro/ }));
    fireEvent.click(screen.getByRole('button', { name: /Render/ }));

    expect(screen.getByRole('button', { name: /Prodotti/ })).toHaveClass('is-active');
    expect(screen.getByRole('button', { name: /Render/ })).not.toHaveClass('is-active');
    expect(screen.getByRole('alert')).toHaveTextContent('Prima posiziona “Divano chiaro”');
    expect(screen.getByText('Tocca il punto sul pavimento')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Torna ai prodotti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Render/ }));
    expect(screen.getByRole('button', { name: /Render/ })).toHaveClass('is-active');
    expect(screen.getByRole('dialog', { name: 'Crea il render reale' })).toBeInTheDocument();
  });

  it('anchors initial furniture to the front wall and exposes undo and delete', () => {
    render(<RoomStudio />);
    loadDemoAndOpenProducts();
    const search = screen.getByLabelText('Cerca materiali, colori o mobili');
    fireEvent.change(search, { target: { value: 'divano' } });
    const canvas = document.querySelector('.canvas') as HTMLDivElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });

    fireEvent.click(screen.getByRole('button', { name: /Divano chiaro/ }));
    fireEvent.click(canvas, { clientX: 500, clientY: 280 });
    const first = screen.getByRole('button', { name: 'Sposta Divano chiaro' });
    const anchoredTop = Number.parseFloat((first as HTMLElement).style.top);
    expect(screen.getByRole('button', { name: 'Torna indietro di una modifica del mobile' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Elimina Divano chiaro' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Larghezza reale del mobile'), { target: { value: '360' } });
    fireEvent.click(screen.getByRole('button', { name: 'Applica misura' }));
    expect(screen.getByText(/larghezza reale 360 cm/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Elimina Divano chiaro' }));
    expect(screen.queryByRole('button', { name: 'Sposta Divano chiaro' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Divano chiaro/ }));
    fireEvent.click(canvas, { clientX: 500, clientY: 590 });
    const second = screen.getByRole('button', { name: 'Sposta Divano chiaro' });
    expect(Number.parseFloat((second as HTMLElement).style.top)).toBeCloseTo(anchoredTop, 5);

    const leftBefore = Number.parseFloat((second as HTMLElement).style.left);
    fireEvent.click(screen.getByRole('button', { name: 'Sposta Divano chiaro a destra' }));
    expect(Number.parseFloat((second as HTMLElement).style.left)).toBeGreaterThan(leftBefore);
    fireEvent.click(screen.getByRole('button', { name: 'Torna indietro di una modifica del mobile' }));
    expect(Number.parseFloat((second as HTMLElement).style.left)).toBeCloseTo(leftBefore, 5);
  });

  it('uses one search for furniture and accepts a free-form render request', () => {
    render(<RoomStudio />);
    loadDemoAndOpenProducts();
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
    loadDemoAndOpenProducts();
    fireEvent.change(screen.getByLabelText('Cerca materiali, colori o mobili'), { target: { value: 'divano' } });
    fireEvent.click(screen.getByRole('button', { name: /Divano chiaro/ }));
    const canvas = document.querySelector('.canvas') as HTMLDivElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.click(canvas, { clientX: 500, clientY: 500 });
    expect(screen.getByRole('button', { name: '↑ Frontale' })).toHaveClass('is-active');
    const initiallyFront = screen.getByRole('button', { name: 'Sposta Divano chiaro' });
    expect(initiallyFront.querySelector('img')).toHaveAttribute('src', '/demo-sofa.png');
    expect(Number.parseFloat((initiallyFront as HTMLElement).style.width)).toBeGreaterThan(30);
    expect(screen.getByRole('group', { name: 'Comandi Apple Pencil per il mobile' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Scegli il muro del mobile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Misura automatica' })).toBeDisabled();
    const automaticWidth = Number.parseFloat((initiallyFront as HTMLElement).style.width);
    fireEvent.click(screen.getByRole('button', { name: 'Ingrandisci Divano chiaro' }));
    expect(Number.parseFloat((initiallyFront as HTMLElement).style.width)).toBeGreaterThan(automaticWidth);
    for (let step = 0; step < 7; step += 1) fireEvent.click(screen.getByRole('button', { name: 'Ingrandisci Divano chiaro' }));
    expect(Number.parseFloat((initiallyFront as HTMLElement).style.width)).toBeGreaterThan(55);
    const restoreAuto = screen.getByRole('button', { name: 'Misura automatica per Divano chiaro' });
    expect(restoreAuto).toBeEnabled();
    fireEvent.click(restoreAuto);
    expect(Number.parseFloat((initiallyFront as HTMLElement).style.width)).toBe(automaticWidth);
    expect(screen.getByRole('button', { name: 'Misura automatica per Divano chiaro' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Orienta Divano chiaro: Muro sinistro' }));
    const furniture = screen.getByRole('button', { name: 'Sposta Divano chiaro' });
    expect(furniture).toHaveClass('facing-left-wall');
    expect(furniture.getAttribute('style')).not.toContain('rotate(');
    expect(furniture.querySelector('img')).toHaveAttribute('src', '/demo-sofa-side.png');
    expect(screen.getByRole('group', { name: 'Comandi Apple Pencil per il mobile' })).toBeInTheDocument();
    const initialLeft = Number.parseFloat((furniture as HTMLElement).style.left);
    fireEvent.click(screen.getByRole('button', { name: 'Sposta Divano chiaro a destra' }));
    expect(Number.parseFloat((furniture as HTMLElement).style.left)).toBeGreaterThan(initialLeft);
    const initialTop = Number.parseFloat((furniture as HTMLElement).style.top);
    fireEvent.click(screen.getByRole('button', { name: 'Sposta Divano chiaro in alto' }));
    expect(Number.parseFloat((furniture as HTMLElement).style.top)).toBeLessThan(initialTop);
    fireEvent.click(screen.getByRole('button', { name: 'Ruota Divano chiaro a destra' }));
    expect(furniture.getAttribute('style')).toContain('rotate(10deg)');
    for (let step = 0; step < 20; step += 1) fireEvent.click(screen.getByRole('button', { name: 'Ruota Divano chiaro a destra' }));
    expect(furniture.getAttribute('style')).toContain('rotate(60deg)');
    fireEvent.click(screen.getByRole('button', { name: 'Raddrizza Divano chiaro' }));
    expect(furniture.getAttribute('style')).not.toContain('rotate(');
    expect(furniture).toHaveClass('facing-front-wall');
    expect(furniture.querySelector('img')).toHaveAttribute('src', '/demo-sofa.png');
    fireEvent.click(screen.getByRole('button', { name: 'Orienta Divano chiaro: Muro destro' }));
    expect(furniture).toHaveClass('facing-right-wall');
    fireEvent.click(screen.getByRole('button', { name: 'Blocca Divano chiaro' }));
    expect(screen.getByRole('group', { name: 'Comandi Apple Pencil per il mobile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sblocca Divano chiaro' })).toBeInTheDocument();
  });

  it('keeps the grabbed point stable while auto-scaling furniture in depth', () => {
    render(<RoomStudio />);
    loadDemoAndOpenProducts();
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

  it('shows parquet examples despite a common typo and keeps them after an empty online search', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok' }), { status: 200 });
      }
      if (url.includes('/api/search-products')) {
        return new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    loadDemoAndOpenProducts();
    fireEvent.change(screen.getByLabelText('Cerca materiali, colori o mobili'), { target: { value: 'pavimento parquel legno' } });

    expect(screen.getByRole('button', { name: /Rovere naturale/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rovere chiaro/ })).toBeInTheDocument();
    expect(screen.getByText('Esempi compatibili')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca con Grok' }));

    expect(await screen.findByText(/2 esempi compatibili da provare subito/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rovere naturale/ })).toBeInTheDocument();
  });

  it('offers separate brand, model, color and product type criteria', () => {
    render(<RoomStudio />);
    loadDemoAndOpenProducts();

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
    loadDemoAndOpenProducts();
    expect(screen.getByLabelText('Modalità inserimento prodotto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cerca online/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Foto prodotto/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Campione materiale/ })).toBeInTheDocument();
  });

  it('never places the full rectangular product photo when furniture cutout fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok' }), { status: 200 });
      }
      if (url.includes('/api/classify-product')) {
        return new Response(JSON.stringify({
          kind: 'furniture', category: 'Arredi', confidence: .96, usableSample: false,
          sampleBounds: { left: 0, top: 0, right: 0, bottom: 0 }, label: 'Divano chiaro', reason: 'Mobile riconoscibile.',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/clean-product')) {
        return new Response(JSON.stringify({ message: 'Scontorno non disponibile.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    loadDemoAndOpenProducts();
    fireEvent.change(document.querySelector('#furniture-file') as HTMLInputElement, {
      target: { files: [new File(['photo'], 'divano.jpg', { type: 'image/jpeg' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Non inserisco la foto intera');
    expect(screen.queryByText('Tocca il punto sul pavimento')).not.toBeInTheDocument();
    expect(document.querySelector('.placed-furniture')).not.toBeInTheDocument();
  });

  it('keeps Products active while a product photo is still being recognized', async () => {
    let completeClassification: ((response: Response) => void) | undefined;
    const classification = new Promise<Response>((resolve) => { completeClassification = resolve; });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok' }), { status: 200 });
      }
      if (url.includes('/api/classify-product')) return classification;
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    loadDemoAndOpenProducts();
    fireEvent.change(document.querySelector('#furniture-file') as HTMLInputElement, {
      target: { files: [new File(['photo'], 'prodotto.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Render/ }));

    expect(screen.getByRole('button', { name: /Prodotti/ })).toHaveClass('is-active');
    expect(screen.getByRole('alert')).toHaveTextContent('Attendi il riconoscimento');

    completeClassification?.(new Response(JSON.stringify({
      kind: 'unknown', category: 'Arredi', confidence: .4, usableSample: false,
      sampleBounds: { left: 0, top: 0, right: 0, bottom: 0 }, label: 'Prodotto', reason: 'Incerto',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riconosco con sicurezza');
  });

  it('clears the wait error when classification finishes with an applied floor material', async () => {
    mockMaterialPhotoCrop();
    let completeClassification: ((response: Response) => void) | undefined;
    const classification = new Promise<Response>((resolve) => { completeClassification = resolve; });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok' }), { status: 200 });
      }
      if (url.includes('/api/classify-product')) return classification;
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    loadDemoAndOpenProducts();
    fireEvent.change(document.querySelector('#furniture-file') as HTMLInputElement, {
      target: { files: [new File(['photo'], 'travertino.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Render/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Attendi il riconoscimento');

    completeClassification?.(new Response(JSON.stringify({
      kind: 'surface-material', category: 'Pavimenti', confidence: .96, usableSample: true,
      sampleBounds: { left: .1, top: .1, right: .8, bottom: .8 }, label: 'Travertino chiaro', reason: 'Campione pulito',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    expect(await screen.findByText('Travertino chiaro riconosciuto e applicato automaticamente a Pavimento.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('never falls back to a wall when a floor material has no available floor', async () => {
    mockMaterialPhotoCrop();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok' }), { status: 200 });
      }
      if (url.includes('/api/classify-product')) {
        return new Response(JSON.stringify({
          kind: 'surface-material', category: 'Pavimenti', confidence: .97, usableSample: true,
          sampleBounds: { left: .1, top: .1, right: .85, bottom: .85 }, label: 'Pietra per pavimento', reason: 'Campione pulito',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    loadDemoAndContinue();
    fireEvent.pointerDown(document.querySelector('.surface-kind-floor polygon') as SVGPolygonElement);
    fireEvent.click(screen.getByRole('button', { name: 'Mantieni identico Pavimento' }));
    continueToProducts();
    fireEvent.change(document.querySelector('#furniture-file') as HTMLInputElement, {
      target: { files: [new File(['photo'], 'pietra.jpg', { type: 'image/jpeg' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Pavimento non è disponibile o è bloccato');
    for (const wall of document.querySelectorAll('.surface-kind-wall polygon')) {
      expect(wall.getAttribute('fill')).not.toContain('uploaded-material');
    }
    expect(screen.queryByText(/applicato automaticamente a Muro/)).not.toBeInTheDocument();
  });

  it('makes the product target and geometry recovery controls explicit', () => {
    render(<RoomStudio />);
    loadDemoAndContinue();
    expect(screen.getByRole('button', { name: '＋ Porta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ Arco' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ Finestra' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '↔ Sposta linee' })).toBeInTheDocument();
    continueToProducts();

    expect(screen.getByText('Dove vuoi applicarlo?')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Scegli superficie da modificare' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pavimento' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Porta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Arco' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Finestra' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '↶ Annulla ultima modifica' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '◎ Nascondi linee' }));
    expect(document.querySelector('.surface-overlay')).toHaveClass('hide-product-guides');
    fireEvent.click(screen.getByRole('button', { name: '◎ Mostra linee' }));
    expect(document.querySelector('.surface-overlay')).not.toHaveClass('hide-product-guides');
  });

  it('moves a complete shared edge with Apple Pencil in Controlla and restores it with undo', () => {
    render(<RoomStudio />);
    loadDemoAndContinue();

    clickStatusBar('↔ Sposta linee');

    expect(screen.getByLabelText('Sposta linea 3 di Muro 1')).toBeInTheDocument();
    expect(document.querySelectorAll('.surface-correction-controls .surface-edge-hit')).toHaveLength(4);
    expect(document.querySelectorAll('.surface-correction-controls .surface-vertex-hit')).toHaveLength(4);

    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    const selectedPolygon = document.querySelector('.is-selected-surface polygon') as SVGPolygonElement;
    const floorPolygon = document.querySelector('.surface-kind-floor polygon') as SVGPolygonElement;
    const edge = screen.getByLabelText('Sposta linea 3 di Muro 1') as unknown as SVGLineElement;
    const selectedBefore = selectedPolygon.getAttribute('points') as string;
    const floorBefore = floorPolygon.getAttribute('points') as string;
    const parsePoints = (value: string) => value.split(' ').map((point) => point.split(',').map(Number));
    const edgeMidpoint = {
      x: (Number(edge.getAttribute('x1')) + Number(edge.getAttribute('x2'))) / 2,
      y: (Number(edge.getAttribute('y1')) + Number(edge.getAttribute('y2'))) / 2,
    };
    const capture = mockPointerCapture(edge);

    fireEvent.pointerDown(edge, { pointerId: 41, pointerType: 'pen', clientX: edgeMidpoint.x, clientY: edgeMidpoint.y });
    fireEvent.pointerMove(edge, { pointerId: 41, pointerType: 'pen', clientX: edgeMidpoint.x, clientY: edgeMidpoint.y + 35 });
    fireEvent.pointerUp(edge, { pointerId: 41, pointerType: 'pen' });
    expect(capture.setPointerCapture).toHaveBeenCalledWith(41);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(41);

    const selectedAfter = parsePoints(selectedPolygon.getAttribute('points') as string);
    const selectedOriginal = parsePoints(selectedBefore);
    expect(selectedAfter[2][1]).toBeGreaterThan(selectedOriginal[2][1]);
    expect(selectedAfter[3][1]).toBeGreaterThan(selectedOriginal[3][1]);
    expect(selectedAfter[2][1] - selectedOriginal[2][1]).toBe(selectedAfter[3][1] - selectedOriginal[3][1]);

    const movedEndpoints = [selectedAfter[2], selectedAfter[3]];
    const floorAfter = parsePoints(floorPolygon.getAttribute('points') as string);
    const adjacentWallPoints = Array.from(document.querySelectorAll('.surface-kind-wall:not(.is-selected-surface) polygon'))
      .flatMap((polygon) => parsePoints((polygon as SVGPolygonElement).getAttribute('points') as string));
    for (const endpoint of movedEndpoints) {
      expect(floorAfter).toContainEqual(endpoint);
      expect(adjacentWallPoints).toContainEqual(endpoint);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Annulla ultima modifica' }));
    expect(selectedPolygon).toHaveAttribute('points', selectedBefore);
    expect(floorPolygon).toHaveAttribute('points', floorBefore);
  });

  it('creates a floor vertex from its small midpoint handle with Apple Pencil', () => {
    render(<RoomStudio />);
    loadDemoAndContinue();
    fireEvent.click(screen.getByRole('button', { name: /^Pavimento/ }));
    clickStatusBar('↔ Sposta linee');
    const midpoint = screen.getByLabelText('Crea e sposta un nuovo punto sulla linea 1 di Pavimento') as HTMLButtonElement;
    expect(midpoint).toHaveClass('surface-edge-grip-hit');
    expect(midpoint).toHaveStyle({ touchAction: 'none' });
    expect(midpoint.style.left).toContain('clamp(26px');
    expect(midpoint.style.top).toContain('clamp(26px');
    expect(midpoint).toHaveAttribute('data-testid', 'edge-grip-hit-0');
    expect(midpoint).toHaveAttribute('type', 'button');

    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    const floorPolygon = document.querySelector('.is-selected-surface polygon') as SVGPolygonElement;
    const floorBefore = floorPolygon.getAttribute('points') as string;
    const wallPolygons = Array.from(document.querySelectorAll('.surface-kind-wall polygon')) as SVGPolygonElement[];
    const wallsBefore = wallPolygons.map((polygon) => polygon.getAttribute('points'));
    const parsePoints = (value: string) => value.split(' ').map((point) => point.split(',').map(Number));
    const visibleMidpoint = document.querySelector('.surface-correction-controls .surface-edge-grip') as SVGCircleElement;
    const midpointX = Number(visibleMidpoint.getAttribute('cx'));
    const midpointY = Number(visibleMidpoint.getAttribute('cy'));
    const capture = mockPointerCapture(midpoint);

    fireEvent.pointerDown(midpoint, { pointerId: 52, pointerType: 'pen', clientX: midpointX, clientY: midpointY });
    fireEvent.pointerMove(midpoint, { pointerId: 52, pointerType: 'pen', clientX: midpointX, clientY: midpointY + 30 });
    fireEvent.pointerUp(midpoint, { pointerId: 52, pointerType: 'pen' });
    expect(capture.setPointerCapture).toHaveBeenCalledWith(52);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(52);

    const floorAfter = parsePoints(floorPolygon.getAttribute('points') as string);
    const floorOriginal = parsePoints(floorBefore);
    expect(floorAfter).toHaveLength(floorOriginal.length + 1);
    expect(floorAfter[0]).toEqual(floorOriginal[0]);
    expect(floorAfter[2]).toEqual(floorOriginal[1]);
    expect(floorAfter[1][1]).toBeGreaterThan(floorOriginal[0][1]);

    const sharedWallPoints = wallPolygons.flatMap((polygon) => parsePoints(polygon.getAttribute('points') as string));
    expect(sharedWallPoints).toContainEqual(floorAfter[0]);
    expect(sharedWallPoints).toContainEqual(floorAfter[1]);

    fireEvent.click(screen.getByRole('button', { name: 'Annulla ultima modifica' }));
    expect(floorPolygon).toHaveAttribute('points', floorBefore);
    wallPolygons.forEach((polygon, index) => expect(polygon).toHaveAttribute('points', wallsBefore[index] as string));
  });

  it('shows automatic room measurements and accepts one real reference', () => {
    render(<RoomStudio />);
    loadDemoAndOpenProducts();

    expect(screen.getByText('Misure della stanza')).toBeInTheDocument();
    expect(screen.getByText('Automatiche')).toBeInTheDocument();
    expect(screen.getByText(/Calcolate da/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '✎ Correggi una misura' }));
    fireEvent.change(screen.getByLabelText('Larghezza reale parete principale'), { target: { value: '5,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));

    expect(screen.getByText('Confermate')).toBeInTheDocument();
    expect(screen.getByText('5,5 m')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '↻ Torna automatico' })).toBeInTheDocument();
  });

  it('requires a material sample when a linked surface product has no clean texture', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ aiReady: true, providerLabel: 'Grok' }), { status: 200 });
      }
      if (url.includes('/api/search-products')) {
        return new Response(JSON.stringify({ products: [{
          name: 'Impronta Limestone Beige', brand: 'Impronta', collection: 'Limestone', category: 'Pavimenti', color: 'Beige', effect: 'Pietra', format: '60x60', finish: 'Matt',
          description: 'Piastrella in gres beige', sourceUrl: 'https://example.com/limestone', productImageUrl: 'https://example.com/room.jpg', textureImageUrl: '', roomImageUrls: [],
          confidence: .9, official: true, correction: '',
        }] }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RoomStudio />);
    loadDemoAndOpenProducts();
    fireEvent.change(screen.getByLabelText('Link prodotto'), { target: { value: 'https://example.com/limestone' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca con Grok' }));
    fireEvent.click(await screen.findByRole('button', { name: /Impronta · Impronta Limestone Beige/ }));

    expect(screen.getByText('Serve un campione prima della prova.')).toBeInTheDocument();
    expect(document.querySelector('.auto-apply-product-button')).toBeEnabled();
    const sampleButtons = screen.getAllByRole('button', { name: 'Aggiungi campione per provarlo' });
    expect(sampleButtons.length).toBeGreaterThan(0);
    fireEvent.click(sampleButtons[0]);
    expect(screen.getByText(/non inventerò il disegno dal solo nome/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/apply-product'))).toBe(false);
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
    loadDemoAndOpenProducts();
    fireEvent.change(screen.getByLabelText('Tipo prodotto'), { target: { value: 'Arredi' } });
    fireEvent.change(screen.getByLabelText('Cerca materiali, colori o mobili'), { target: { value: 'divano beige' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca con Grok' }));

    const unavailable = await screen.findByRole('button', { name: /divani\.store · Divano Dorian.*Foto prodotto non disponibile/ });
    expect(unavailable).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Fonte' })).toHaveAttribute('href', 'https://divani.store/products/dorian');
    expect(document.querySelector('.placed-furniture-placeholder')).not.toBeInTheDocument();
  });

  it('starts with a five-step workflow and only exposes the simple mode', () => {
    render(<RoomStudio />);
    expect(screen.getByRole('navigation', { name: 'Passaggi del progetto' })).toHaveTextContent('1Foto2Prepara3Controlla4Prodotti5Render');
    expect(screen.queryByText(/Modalità (semplice|avanzata)/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Strumenti avanzati' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prepara/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    expect(screen.getByRole('button', { name: /Prepara/ })).toBeEnabled();
  });
});
