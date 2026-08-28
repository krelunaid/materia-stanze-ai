/* eslint-disable @next/next/no-html-link-for-pages -- Vinext 1.0.0-beta.3 genera errori runtime nel prefetch di next/link. */

import { ProjectsList } from './projects-list';

export const metadata = {
  title: 'Progetti — Materia',
  description: 'I progetti locali del configuratore Materia.',
  openGraph: { images: [] },
  twitter: { images: [] },
};

export default function ProjectsPage() {
  return (
    <main className="projects-page">
      <header className="projects-nav">
        <a href="/" className="brand-lockup" aria-label="Apri l’editor">
          <div className="brand-mark" aria-hidden="true"><span /><span /></div>
          <div><p className="eyebrow">Studio materiali</p><p className="brand-name">Materia</p></div>
        </a>
        <span className="local-badge"><span className="status-dot" />Sessione locale</span>
      </header>

      <section className="projects-hero">
        <div>
          <p className="eyebrow">I tuoi spazi</p>
          <h1>Progetti</h1>
          <p>Ogni stanza parte da un originale intatto. I contorni approvati restano in questo browser: svuotare o renderizzare non li riscrive.</p>
        </div>
        <a className="primary-button" href="/">Crea nuovo progetto</a>
      </section>

      <section className="project-grid" aria-label="Elenco progetti">
        <article className="new-project-card">
          <div className="new-project-icon" aria-hidden="true">+</div>
          <h2>Nuova stanza</h2>
          <p>Importa una fotografia JPG, PNG o HEIC, oppure una planimetria.</p>
          <a href="/">Apri l’editor <span aria-hidden="true">→</span></a>
        </article>
        <ProjectsList />
      </section>

      <footer className="projects-footer">
        <p><strong>Su iPhone e iPad:</strong> apri in Safari, tocca Condividi e scegli “Aggiungi alla schermata Home”.</p>
        <span>Materia · Versione operativa 0.1</span>
      </footer>
    </main>
  );
}
