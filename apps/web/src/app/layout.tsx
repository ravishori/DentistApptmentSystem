import type { Metadata } from 'next';
import { Inter, Fraunces } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { ThemedToaster } from '@/components/providers/themed-toaster';
import { ErrorBoundary } from '@/components/providers/error-boundary';
import { GlobalErrorSetup } from '@/components/providers/global-error-setup';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Editorial display face: headings only (never dense clinical records or tables). Self-hosted by next/font.
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  title: 'DentalEase — Clinic Management Platform',
  description: 'WhatsApp-first dental clinic automation for India',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {/* Installs window.onerror + unhandledrejection listeners */}
        <GlobalErrorSetup />

        <Providers>
          {/* Catches React render errors, reports them, shows fallback */}
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
          <ThemedToaster />
        </Providers>
      </body>
    </html>
  );
}
