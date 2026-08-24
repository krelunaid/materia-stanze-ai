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
    expect(screen.getByRole('heading', { name: 'Carica la stanza' })).toBeInTheDocument();
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
    expect(screen.getByText('Disegna la prima superficie')).toBeInTheDocument();
  });

  it('creates guided surfaces and freezes the selected wall', () => {
    render(<RoomStudio />);
    const input = document.querySelector('#room-file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['room'], 'studio.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Inserisci tracciatura guidata' }));
    expect(screen.getAllByText('Muro 1').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Freeze superficie' }));
    expect(screen.getByText('Frozen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elimina superficie' })).toBeDisabled();
  });

  it('loads a local material and applies it to one surface', () => {
    render(<RoomStudio />);
    fireEvent.change(document.querySelector('#room-file') as HTMLInputElement, { target: { files: [new File(['room'], 'studio.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Inserisci tracciatura guidata' }));
    fireEvent.change(document.querySelector('#material-file') as HTMLInputElement, { target: { files: [new File(['tile'], 'travertino.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Applica a Muro 1' }));
    expect(screen.getByText(/travertino applicato a Muro 1/i)).toBeInTheDocument();
  });

  it('records pointer coordinates before closing a manually drawn surface', () => {
    render(<RoomStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Prova con la stanza esempio' }));
    fireEvent.click(screen.getByRole('button', { name: /Disegna superficie/ }));
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
});
