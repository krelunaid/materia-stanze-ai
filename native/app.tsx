import React from 'react';
import { RoomStudio } from '../app/components/room-studio';
import { ProjectsList } from '../app/projects/projects-list';
import { navigateApp } from '../app/lib/app-navigation';

export function NativeApp() {
  const [route, setRoute] = React.useState(window.location.pathname + window.location.search);
  React.useEffect(() => {
    const update = () => setRoute(window.location.pathname + window.location.search);
    const navigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!event.defaultPrevented && anchor && anchor.origin === window.location.origin && (anchor.pathname === '/projects' || anchor.pathname === '/')) {
        event.preventDefault();
        navigateApp(anchor.pathname + anchor.search);
      }
    };
    window.addEventListener('popstate', update);
    document.addEventListener('click', navigate);
    return () => { window.removeEventListener('popstate', update); document.removeEventListener('click', navigate); };
  }, []);
  if (route.startsWith('/projects')) return <main className="projects-page">
    <header className="projects-hero"><div><p className="eyebrow">Materia</p><h1>I tuoi progetti</h1><p>Salvati su questo dispositivo. L’app e Safari hanno archivi separati.</p></div><a className="primary-button" href="/">Nuova stanza</a></header>
    <section className="project-grid" aria-label="Elenco progetti"><ProjectsList /></section>
  </main>;
  return <RoomStudio key={route} />;
}
