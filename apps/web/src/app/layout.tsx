import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Toaster } from 'sonner';
import { ErrorBoundary } from '@/components/providers/error-boundary';
import { GlobalErrorSetup } from '@/components/providers/global-error-setup';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DentalEase — Clinic Management Platform',
  description: 'WhatsApp-first dental clinic automation for India',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-surface text-slate-900`}>
        {/* Installs window.onerror + unhandledrejection listeners */}
        <GlobalErrorSetup />

        <Providers>
          {/* Catches React render errors, reports them, shows fallback */}
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
