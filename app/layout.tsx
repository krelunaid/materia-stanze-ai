import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Materia — Configuratore stanze',
  description: 'Editor tecnico per riconoscere superfici e provare materiali mantenendo intatta la stanza originale.',
  openGraph: {
    title: 'Materia — Configuratore stanze',
    description: 'Configura la stanza. Proteggi l’originale.',
    images: [{ url: '/og.png', width: 1728, height: 972, alt: 'Materia, configuratore tecnico di stanze' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Materia — Configuratore stanze',
    description: 'Configura la stanza. Proteggi l’originale.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
