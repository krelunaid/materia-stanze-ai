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
    expect(screen.getByText('Originale importato')).toBeInTheDocument();
    expect(screen.getByText('Nessuna superficie')).toBeInTheDocument();
  });
});
