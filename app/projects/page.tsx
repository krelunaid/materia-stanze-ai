/* eslint-disable @next/next/no-html-link-for-pages -- Vinext 1.0.0-beta.3 genera errori runtime nel prefetch di next/link. */

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
          <p>Ogni stanza parte da un originale intatto. In questa prima fase i progetti vivono soltanto nella sessione del browser.</p>
        </div>
        <a className="primary-button" href="/">Crea nuovo progetto</a>
      </section>

      <section className="project-grid" aria-label="Elenco progetti">
        <article className="new-project-card">
          <div className="new-project-icon" aria-hidden="true">+</div>
          <h2>Nuova stanza</h2>
          <p>Importa una fotografia, un documento PDF o una planimetria.</p>
          <a href="/">Apri l’editor <span aria-hidden="true">→</span></a>
        </article>

        <article className="roadmap-card">
          <div className="roadmap-visual">
            <span className="roadmap-wall one" /><span className="roadmap-wall two" /><span className="roadmap-floor" />
          </div>
          <div className="roadmap-copy">
            <span className="phase-pill">Fase 1</span>
            <h2>Demo dell’editor</h2>
            <p>Interfaccia, selezione dimostrativa e importazione locale controllata.</p>
            <a href="/">Continua <span aria-hidden="true">→</span></a>
          </div>
        </article>
      </section>

      <footer className="projects-footer">
        <p><strong>Privacy prima di tutto.</strong> Nessuna immagine viene inviata a servizi esterni in questa fase.</p>
        <span>Materia · Baseline prodotto 01</span>
      </footer>
    </main>
  );
}
