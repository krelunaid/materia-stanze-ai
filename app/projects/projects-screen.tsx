'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext 1.0.0-beta.3 genera errori runtime nel prefetch di next/link. */

import { ProjectsList } from './projects-list';

export const PROJECTS_FOOTER_COPY = 'I progetti restano in locale in questa app TestFlight. Non serve aggiungere il sito alla schermata Home da Safari.';

type ProjectsScreenProps = {
  onClose?: () => void;
  onNewProject?: () => void;
  onOpenProject?: (id: string) => void;
};

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /></div>;
}

export function ProjectsScreen({ onClose, onNewProject, onOpenProject }: ProjectsScreenProps) {
  return (
    <main className="projects-page">
      <header className="projects-nav">
        {onClose
          ? (
            <button type="button" className="brand-lockup" aria-label="Torna all’editor" onClick={onClose}>
              <BrandMark />
              <div><p className="eyebrow">Studio materiali</p><p className="brand-name">Materia</p></div>
            </button>
          )
          : (
            <a href="/" className="brand-lockup" aria-label="Apri l’editor">
              <BrandMark />
              <div><p className="eyebrow">Studio materiali</p><p className="brand-name">Materia</p></div>
            </a>
          )}
        <span className="local-badge"><span className="status-dot" />Sessione locale</span>
      </header>

      <section className="projects-hero">
        <div>
          <p className="eyebrow">I tuoi spazi</p>
          <h1 id="projects-title">Progetti</h1>
          <p>Ogni stanza parte da un originale intatto. I contorni approvati restano in questo browser: svuotare o renderizzare non li riscrive.</p>
        </div>
        {onNewProject
          ? <button className="primary-button" type="button" onClick={onNewProject}>Crea nuovo progetto</button>
          : <a className="primary-button" href="/">Crea nuovo progetto</a>}
      </section>

      <section className="project-grid" aria-label="Elenco progetti">
        <article className="new-project-card">
          <div className="new-project-icon" aria-hidden="true">+</div>
          <h2>Nuova stanza</h2>
          <p>Importa una fotografia JPG, PNG o HEIC, oppure una planimetria.</p>
          {onNewProject
            ? <button type="button" className="projects-inline-link" onClick={onNewProject}>Apri l’editor <span aria-hidden="true">→</span></button>
            : <a href="/">Apri l’editor <span aria-hidden="true">→</span></a>}
        </article>
        <ProjectsList onOpenProject={onOpenProject} onOpenEditor={onNewProject} />
      </section>

      <footer className="projects-footer">
        <p><strong>Su iPhone e iPad:</strong> {PROJECTS_FOOTER_COPY}</p>
        <span>Materia · Versione operativa 0.1</span>
      </footer>
    </main>
  );
}
