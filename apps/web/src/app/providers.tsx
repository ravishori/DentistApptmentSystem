'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { A11yEnhancer } from '@/components/providers/a11y-enhancer';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }));

  return (
    <QueryClientProvider client={client}>
      <A11yEnhancer />
      {children}
    </QueryClientProvider>
  );
}
