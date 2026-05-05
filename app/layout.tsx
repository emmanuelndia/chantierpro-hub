import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ServiceWorkerDevReset } from '@/components/service-worker-dev-reset';
import './globals.css';

export const metadata: Metadata = {
  title: 'ChantierPro Hub',
  description: 'Infrastructure web et mobile PWA pour la gestion de chantiers BTP.',
  manifest: '/manifest.json',
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'default',
    'apple-mobile-web-app-title': 'ChantierPro',
    'application-name': 'ChantierPro',
    'msapplication-TileColor': '#ea580c',
    'theme-color': '#ea580c',
  },
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="fr">
      <body>
        <ServiceWorkerDevReset />
        {children}
      </body>
    </html>
  );
}
