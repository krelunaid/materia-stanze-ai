import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PROJECTS_FOOTER_COPY, ProjectsScreen } from './projects-screen';

describe('ProjectsScreen', () => {
  it('tells iPhone users they already have the TestFlight app', () => {
    render(<ProjectsScreen />);
    expect(screen.getByRole('heading', { name: 'Progetti' })).toBeInTheDocument();
    expect(screen.getByText(PROJECTS_FOOTER_COPY, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Aggiungi alla schermata Home')).not.toBeInTheDocument();
  });

  it('opens a saved project in-app when callbacks are provided', () => {
    const onOpenProject = vi.fn();
    const onNewProject = vi.fn();
    render(<ProjectsScreen onClose={vi.fn()} onNewProject={onNewProject} onOpenProject={onOpenProject} />);
    fireEvent.click(screen.getByRole('button', { name: 'Crea nuovo progetto' }));
    expect(onNewProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: 'Crea nuovo progetto' })).not.toBeInTheDocument();
  });
});
