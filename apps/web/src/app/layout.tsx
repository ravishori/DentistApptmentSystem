import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Toaster } from 'sonner';
import { ErrorBoundary } from '@/components/providers/error-boundary';
import { GlobalErrorSetup } from '@/components/providers/global-error-setup';
import { THEME_INIT_SCRIPT } from '@/components/layout/theme-toggle';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'DentalEase — Clinic Management Platform',
  description: 'WhatsApp-first dental clinic automation for India',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
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
          <Toaster position="top-right" richColors closeButton theme="system" />
        </Providers>
      </body>
    </html>
  );
}
