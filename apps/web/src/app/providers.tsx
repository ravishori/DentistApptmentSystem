'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { A11yEnhancer } from '@/components/providers/a11y-enhancer';
import { shouldRetryQuery } from '@/lib/api-error';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    // Retry only transient failures (network, timeout, 5xx, 429), at most twice; never 4xx. Mutations are NEVER retried
    // automatically: a repeated POST could duplicate a booking or a payment.
    defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetryQuery, refetchOnWindowFocus: false }, mutations: { retry: false } },
  }));

  return (
    <QueryClientProvider client={client}>
      <A11yEnhancer />
      {children}
    </QueryClientProvider>
  );
}
