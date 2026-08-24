import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RoomStudio } from './room-studio';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:room-preview');
  URL.revokeObjectURL = vi.fn();
});

describe('RoomStudio', () => {
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

  it('imports a valid image locally and updates the project title', () => {
    render(<RoomStudio />);
    const input = document.querySelector('#room-file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['room'], 'soggiorno-verde.jpg', { type: 'image/jpeg' })] } });
    expect(screen.getByText('Soggiorno verde')).toBeInTheDocument();
    expect(screen.getByText('Originale intatto')).toBeInTheDocument();
    expect(screen.getByText('Partenza semplice')).toBeInTheDocument();
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
    const input = document.querySelector('#room-file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['room'], 'studio.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea 3 muri + pavimento' }));
    expect(screen.getAllByText('Muro 1').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Freeze superficie' }));
    expect(screen.getByText('Frozen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elimina superficie' })).toBeDisabled();
  });

  it('loads a local material and applies it to one surface', () => {
    render(<RoomStudio />);
    fireEvent.change(document.querySelector('#room-file') as HTMLInputElement, { target: { files: [new File(['room'], 'studio.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea 3 muri + pavimento' }));
    fireEvent.change(document.querySelector('#material-file') as HTMLInputElement, { target: { files: [new File(['tile'], 'travertino.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Applica a Muro 1' }));
    expect(screen.getByText(/travertino applicato a Muro 1/i)).toBeInTheDocument();
  });

  it('records pointer coordinates before closing a manually drawn surface', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avanzato' }));
    const overlay = document.querySelector('.surface-overlay') as SVGSVGElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, toJSON: () => ({}) });
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 200 });
    fireEvent.pointerDown(overlay, { clientX: 700, clientY: 200 });
    fireEvent.pointerDown(overlay, { clientX: 700, clientY: 500 });
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 500 });
    expect(screen.getByRole('button', { name: 'Chiudi superficie' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi superficie' }));
    expect(screen.getAllByText('Muro 4').length).toBeGreaterThan(0);
  });

  it('closes an easy wall automatically after four taps', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi muro facile/ }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Blocca tutto tranne Muro 1' }));
    fireEvent.click(screen.getByRole('button', { name: /^Muro 2/ }));
    expect(screen.getByText('Frozen')).toBeInTheDocument();
  });

  it('searches demo materials and prepares an honest render summary', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continua: cerca materiali' }));
    const search = screen.getByLabelText('Cerca materiali, colori o mobili');
    fireEvent.change(search, { target: { value: 'salvia' } });
    fireEvent.click(screen.getByRole('button', { name: /Verde salvia/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Applica a Muro 1' }));
    fireEvent.change(search, { target: { value: 'divano' } });
    fireEvent.click(screen.getByRole('button', { name: /Divano chiaro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Prova flusso render' }));
    expect(screen.getByRole('dialog', { name: 'Prima del render reale' })).toHaveTextContent('Muro 1: Verde salvia');
    expect(screen.getByRole('dialog', { name: 'Prima del render reale' })).toHaveTextContent('Da inserire: Divano chiaro');
    expect(screen.getByRole('dialog', { name: 'Prima del render reale' })).toHaveTextContent('Render fotografico non ancora collegato');
  });

  it('uses one search for furniture and accepts a free-form render request', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    const search = screen.getByLabelText('Cerca materiali, colori o mobili');
    fireEvent.change(search, { target: { value: 'cucina' } });
    fireEvent.click(screen.getByRole('button', { name: /Cucina/ }));
    expect(screen.getByText('Cucina', { selector: '.selected-assets button' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'pianoforte nero a coda' } });
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi “pianoforte nero a coda” al render/ }));
    expect(screen.getByText('pianoforte nero a coda', { selector: '.selected-assets button' })).toBeInTheDocument();
  });

  it('starts with a four-step simple workflow and keeps advanced tools optional', () => {
    render(<RoomStudio />);
    expect(screen.getByRole('navigation', { name: 'Passaggi del progetto' })).toHaveTextContent('1Foto2Superfici3Cerca4Render');
    expect(screen.getByRole('button', { name: 'Strumenti avanzati' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Superfici/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    expect(screen.getByRole('button', { name: /Superfici/ })).toBeEnabled();
  });
});
