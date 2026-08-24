import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ServiceWorkerRegister } from './components/service-worker-register';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Materia — Configuratore stanze',
  description: 'Editor tecnico per riconoscere superfici e provare materiali mantenendo intatta la stanza originale.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Materia',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Materia' },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#17201f',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><head><meta name="apple-mobile-web-app-capable" content="yes" /><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" /><meta name="apple-mobile-web-app-title" content="Materia" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" /></head><body className={`${geistSans.variable} ${geistMono.variable}`}><ServiceWorkerRegister />{children}</body></html>;
}
