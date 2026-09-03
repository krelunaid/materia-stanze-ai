'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext 1.0.0-beta.3 genera errori runtime nel prefetch di next/link. */

import { useEffect, useState } from 'react';
import { listProjects, type ProjectSummary } from '../geometry/project-store';

function formatWhen(stamp: number) {
  try {
    return new Intl.DateTimeFormat('it', { dateStyle: 'medium', timeStyle: 'short' }).format(stamp);
  } catch {
    return new Date(stamp).toISOString();
  }
}

type ProjectsListProps = {
  onOpenProject?: (id: string) => void;
  onOpenEditor?: () => void;
};

export function ProjectsList({ onOpenProject, onOpenEditor }: ProjectsListProps) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    void listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  if (projects === null) {
    return <p className="projects-empty">Carico i progetti salvati in questo browser…</p>;
  }

  if (projects.length === 0) {
    return (
      <article className="new-project-card">
        <div className="new-project-icon" aria-hidden="true">+</div>
        <h2>Nessun progetto salvato</h2>
        <p>I contorni approvati restano in questo browser dopo Foto → Prepara.</p>
        {onOpenEditor
          ? <button type="button" className="projects-inline-link" onClick={onOpenEditor}>Apri l’editor <span aria-hidden="true">→</span></button>
          : <a href="/">Apri l’editor <span aria-hidden="true">→</span></a>}
      </article>
    );
  }

  return (
    <>
      {projects.map((project) => (
        <article className="roadmap-card" key={project.id}>
          <div className="roadmap-copy">
            <span className="phase-pill">Locale</span>
            <h2>{project.title}</h2>
            <p>{project.fileName} · {formatWhen(project.updatedAt)}</p>
            {onOpenProject
              ? <button type="button" className="projects-inline-link" onClick={() => onOpenProject(project.id)}>Continua <span aria-hidden="true">→</span></button>
              : <a href={`/?project=${encodeURIComponent(project.id)}`}>Continua <span aria-hidden="true">→</span></a>}
          </div>
        </article>
      ))}
    </>
  );
}
