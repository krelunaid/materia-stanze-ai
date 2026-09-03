import { ProjectsScreen } from './projects-screen';

export const metadata = {
  title: 'Progetti — Materia',
  description: 'I progetti locali del configuratore Materia.',
  openGraph: { images: [] },
  twitter: { images: [] },
};

export default function ProjectsPage() {
  return <ProjectsScreen />;
}
