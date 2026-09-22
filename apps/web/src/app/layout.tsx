import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Eternal Forge',
  description: 'A browser-first idle action RPG with deep, effectively unlimited progression.',
  applicationName: 'Eternal Forge',
};

/**
 * The primary design viewport is 390x844. `viewportFit: 'cover'` combined with
 * the safe-area padding in the design tokens keeps primary actions reachable in
 * standalone mode (docs/UI_SYSTEM.md — "Mobile first").
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0d14',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
