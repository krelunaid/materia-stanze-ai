/* eslint-disable @next/next/no-html-link-for-pages -- Tests exercise native links, not Next routing. */
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('./room-studio', () => ({ RoomStudio: () => <div><a href="/projects">Progetti</a><span>{window.location.search}</span></div> }));
vi.mock('../projects/projects-list', () => ({ ProjectsList: () => <a href="/?project=saved-room">Continua progetto</a> }));
import { NativeApp } from '../../native/app';

it('opens the project list, reopens a specific project and starts a new room without a web reload', () => {
  window.history.replaceState(null, '', '/');
  render(<NativeApp />);
  fireEvent.click(screen.getByRole('link', { name: 'Progetti' }));
  expect(screen.getByRole('heading', { name: 'I tuoi progetti' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Continua progetto' }));
  expect(screen.getByText('?project=saved-room')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Progetti' }));
  fireEvent.click(screen.getByRole('link', { name: 'Nuova stanza' }));
  expect(window.location.pathname + window.location.search).toBe('/');
  expect(screen.getByRole('link', { name: 'Progetti' })).toBeInTheDocument();
});
